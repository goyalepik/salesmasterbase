import OpenAI from "openai";
import { log } from "@/lib/log";
import { rulesAnswer, rulesBriefing } from "@/lib/ai/fallback";
import { BRIEFING_REQUEST, systemPrompt, type DataMode } from "@/lib/ai/prompt";
import { runTool, serialiseResult, ToolError, TOOLS, type ToolContext } from "@/lib/ai/tools";

/**
 * The assistant: a tool-use loop over the read-only ops tools.
 * Order of preference: Anthropic Messages API → OpenAI tool calling → fixed reports (no model).
 * It never returns a blank answer.
 */

export type ChatTurn = { role: "user" | "assistant"; content: string };
export type AgentStep = { tool: string; input: Record<string, unknown>; summary: string; ok: boolean };
export type AgentProvider = "anthropic" | "openai" | "rules";
export type AgentResult = { answer: string; steps: AgentStep[]; model: string; provider: AgentProvider; notice: string | null };

type OpenAiToolCall = { id: string; type: string; function?: { name: string; arguments: string } };
type OpenAiMessage = { role: string; content?: string | null; tool_calls?: OpenAiToolCall[]; tool_call_id?: string };
/** The slice of the OpenAI client the agent uses, so tests can pass a fake. */
export type OpenAiLike = {
  chat: { completions: { create(body: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<{ choices: Array<{ message: OpenAiMessage; finish_reason?: string | null }> }> } };
};

export type AgentConfig = {
  anthropicKey: string | null;
  anthropicModel: string;
  openaiKey: string | null;
  openaiModel: string;
  data: DataMode;
  fetch?: typeof fetch;
  openai?: OpenAiLike;
  maxRounds?: number;
  maxTokens?: number;
  /** Per model request. */
  requestTimeoutMs?: number;
  /** Whole answer, all rounds. */
  deadlineMs?: number;
};

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MAX_ROUNDS = 8;
const MAX_HISTORY_TURNS = 12;
const MAX_TURN_CHARS = 4000;

class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Alternating user/assistant turns that start with the user, ending before the new question. */
export function cleanHistory(history: ChatTurn[] | undefined): ChatTurn[] {
  const out: ChatTurn[] = [];
  for (const turn of (history ?? []).slice(-MAX_HISTORY_TURNS)) {
    if ((turn.role !== "user" && turn.role !== "assistant") || typeof turn.content !== "string") continue;
    const content = turn.content.trim().slice(0, MAX_TURN_CHARS);
    if (!content) continue;
    if (!out.length && turn.role !== "user") continue;
    const last = out[out.length - 1];
    if (last && last.role === turn.role) last.content = `${last.content}\n\n${content}`;
    else out.push({ role: turn.role, content });
  }
  if (out.length && out[out.length - 1].role === "user") out.pop();
  return out;
}

function describeError(error: unknown): string {
  if (error instanceof ProviderError) return error.message;
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return "the request timed out";
  if (error instanceof Error && error.name === "APIConnectionTimeoutError") return "the request timed out";
  if (error && typeof error === "object" && "status" in error) return `HTTP ${(error as { status: unknown }).status}`;
  return "the request failed";
}

async function execute(ctx: ToolContext, name: string, rawInput: unknown): Promise<{ content: string; isError: boolean; step: AgentStep }> {
  const input = rawInput && typeof rawInput === "object" && !Array.isArray(rawInput) ? (rawInput as Record<string, unknown>) : {};
  try {
    const output = await runTool(ctx, name, input);
    return { content: serialiseResult(output), isError: false, step: { tool: name, input, summary: output.summary, ok: true } };
  } catch (error) {
    const message = error instanceof ToolError ? error.message : "The tool could not read the data. Try a narrower query or another tool.";
    if (!(error instanceof ToolError)) log("error", "ai_tool_failed", { tool: name, message: error instanceof Error ? error.message.slice(0, 200) : "unknown" });
    return { content: JSON.stringify({ error: message }), isError: true, step: { tool: name, input, summary: message, ok: false } };
  }
}

function timeLeft(deadline: number): number {
  return deadline - Date.now();
}

function requestSignal(config: AgentConfig, deadline: number): AbortSignal {
  const left = timeLeft(deadline);
  if (left < 2000) throw new ProviderError("the answer took too long");
  return AbortSignal.timeout(Math.min(config.requestTimeoutMs ?? 30_000, left));
}

// ── Anthropic ────────────────────────────────────────────────────────────────

type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: string; [key: string]: unknown };
type AnthropicReply = { content: AnthropicBlock[]; stop_reason: string | null; model?: string };

async function anthropicRequest(config: AgentConfig, body: Record<string, unknown>, signal: AbortSignal): Promise<AnthropicReply> {
  const doFetch = config.fetch ?? fetch;
  const response = await doFetch(ANTHROPIC_URL, {
    method: "POST",
    headers: { "x-api-key": config.anthropicKey!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    let detail = "";
    try {
      const json = (await response.json()) as { error?: { type?: string; message?: string } };
      detail = json.error?.type ?? "";
    } catch {
      detail = "";
    }
    throw new ProviderError(`Anthropic returned HTTP ${response.status}${detail ? ` (${detail})` : ""}`);
  }
  const json = (await response.json()) as AnthropicReply;
  if (!json || !Array.isArray(json.content)) throw new ProviderError("Anthropic returned an unexpected response");
  return json;
}

function textOf(blocks: AnthropicBlock[]): string {
  return blocks
    .filter((b): b is { type: "text"; text: string } => b.type === "text" && typeof (b as { text?: unknown }).text === "string")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

async function viaAnthropic(question: string, history: ChatTurn[], ctx: ToolContext, config: AgentConfig, deadline: number): Promise<AgentResult> {
  const steps: AgentStep[] = [];
  const maxRounds = config.maxRounds ?? MAX_ROUNDS;
  const tools = TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [...history.map((t) => ({ role: t.role, content: t.content })), { role: "user", content: question }];
  const system = systemPrompt(ctx.now(), config.data);
  let model = config.anthropicModel;
  let partial = "";
  for (let round = 1; round <= maxRounds; round += 1) {
    const last = round === maxRounds;
    const reply = await anthropicRequest(
      config,
      { model: config.anthropicModel, max_tokens: config.maxTokens ?? 2048, system, messages, tools, ...(last ? { tool_choice: { type: "none" } } : {}) },
      requestSignal(config, deadline),
    );
    model = reply.model ?? model;
    messages.push({ role: "assistant", content: reply.content });
    const text = textOf(reply.content);
    if (text) partial = text;
    const uses = reply.content.filter((b): b is { type: "tool_use"; id: string; name: string; input: unknown } => b.type === "tool_use");
    if (reply.stop_reason !== "tool_use" || !uses.length) {
      if (!text) throw new ProviderError("Anthropic returned an empty answer");
      const cut = reply.stop_reason === "max_tokens" ? "\n\n_(Answer cut short. Ask a narrower question for the rest.)_" : "";
      return { answer: `${text}${cut}`, steps, model, provider: "anthropic", notice: null };
    }
    const executed = await Promise.all(uses.map((use) => execute(ctx, use.name, use.input)));
    steps.push(...executed.map((r) => r.step));
    const results = executed.map((result, i) => ({ type: "tool_result", tool_use_id: uses[i].id, content: result.content, ...(result.isError ? { is_error: true } : {}) }));
    messages.push({ role: "user", content: results });
  }
  if (partial) return { answer: partial, steps, model, provider: "anthropic", notice: "The assistant hit its step limit; this answer may be incomplete." };
  throw new ProviderError("Anthropic did not finish within the step limit");
}

// ── OpenAI ───────────────────────────────────────────────────────────────────

async function viaOpenAi(question: string, history: ChatTurn[], ctx: ToolContext, config: AgentConfig, deadline: number): Promise<AgentResult> {
  const client: OpenAiLike = config.openai ?? (new OpenAI({ apiKey: config.openaiKey!, timeout: config.requestTimeoutMs ?? 30_000, maxRetries: 0 }) as unknown as OpenAiLike);
  const steps: AgentStep[] = [];
  const maxRounds = config.maxRounds ?? MAX_ROUNDS;
  const tools = TOOLS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
  const messages: OpenAiMessage[] = [
    { role: "system", content: systemPrompt(ctx.now(), config.data) },
    ...history.map((t) => ({ role: t.role, content: t.content })),
    { role: "user", content: question },
  ];
  let partial = "";
  for (let round = 1; round <= maxRounds; round += 1) {
    const last = round === maxRounds;
    const completion = await client.chat.completions.create(
      { model: config.openaiModel, messages, tools, tool_choice: last ? "none" : "auto", max_completion_tokens: config.maxTokens ?? 2048 },
      { signal: requestSignal(config, deadline) },
    );
    const message = completion.choices[0]?.message;
    if (!message) throw new ProviderError("OpenAI returned no message");
    const text = message.content?.trim() ?? "";
    if (text) partial = text;
    const calls = (message.tool_calls ?? []).filter((c) => c.type === "function" && c.function);
    if (!calls.length) {
      if (!text) throw new ProviderError("OpenAI returned an empty answer");
      return { answer: text, steps, model: config.openaiModel, provider: "openai", notice: null };
    }
    messages.push({ role: "assistant", content: message.content ?? null, tool_calls: calls });
    for (const call of calls) {
      let args: unknown = {};
      try {
        args = call.function!.arguments ? JSON.parse(call.function!.arguments) : {};
      } catch {
        args = {};
      }
      const result = await execute(ctx, call.function!.name, args);
      steps.push(result.step);
      messages.push({ role: "tool", tool_call_id: call.id, content: result.content });
    }
  }
  if (partial) return { answer: partial, steps, model: config.openaiModel, provider: "openai", notice: "The assistant hit its step limit; this answer may be incomplete." };
  throw new ProviderError("OpenAI did not finish within the step limit");
}

// ── Entry points ─────────────────────────────────────────────────────────────

async function withFallback(
  question: string,
  history: ChatTurn[],
  ctx: ToolContext,
  config: AgentConfig,
  rules: () => Promise<{ answer: string; steps: AgentStep[] }>,
): Promise<AgentResult> {
  const deadline = Date.now() + (config.deadlineMs ?? 55_000);
  const problems: string[] = [];
  if (config.anthropicKey) {
    try {
      return await viaAnthropic(question, history, ctx, config, deadline);
    } catch (error) {
      problems.push(`Claude was unavailable (${describeError(error)})`);
      log("error", "ai_anthropic_failed", { message: describeError(error) });
    }
  }
  if (config.openaiKey && timeLeft(deadline) > 5000) {
    try {
      const result = await viaOpenAi(question, history, ctx, config, deadline);
      return { ...result, notice: [problems.join(". "), result.notice].filter(Boolean).join(". ") || null };
    } catch (error) {
      problems.push(`OpenAI was unavailable (${describeError(error)})`);
      log("error", "ai_openai_failed", { message: describeError(error) });
    }
  }
  const noKey = !config.anthropicKey && !config.openaiKey;
  try {
    const fixed = await rules();
    const notice = noKey
      ? "No AI key is configured, so this is a fixed report rather than a written analysis."
      : `${problems.join(". ")}. Showing a fixed report instead.`;
    return { answer: fixed.answer, steps: fixed.steps, model: "rules", provider: "rules", notice };
  } catch (error) {
    log("error", "ai_rules_failed", { message: error instanceof Error ? error.message.slice(0, 200) : "unknown" });
    return {
      answer: "I could not read the operations data just now, so I cannot answer this. Check Settings → health, then try again.",
      steps: [],
      model: "rules",
      provider: "rules",
      notice: problems.join(". ") || null,
    };
  }
}

export async function runAgent(input: { question: string; history?: ChatTurn[]; ctx: ToolContext; config: AgentConfig }): Promise<AgentResult> {
  const question = input.question.trim().slice(0, 2000);
  return withFallback(question, cleanHistory(input.history), input.ctx, input.config, () => rulesAnswer(question, input.ctx));
}

export async function runBriefing(input: { ctx: ToolContext; config: AgentConfig }): Promise<AgentResult> {
  return withFallback(BRIEFING_REQUEST, [], input.ctx, { ...input.config, maxTokens: input.config.maxTokens ?? 2048 }, () => rulesBriefing(input.ctx));
}

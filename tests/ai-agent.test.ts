import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanHistory, runAgent, runBriefing, type AgentConfig, type OpenAiLike } from "../src/lib/ai/agent";
import type { ToolContext } from "../src/lib/ai/tools";
import { buildDemoSeed } from "../src/lib/ops/demo-seed";
import { MemoryOpsStore } from "../src/lib/ops/memory-store";
import { loadSeed } from "../src/lib/ops/snapshot";

const SEED_NOW = new Date("2026-10-30T06:30:00Z");

async function context(): Promise<ToolContext> {
  const store = new MemoryOpsStore();
  await loadSeed(store, buildDemoSeed(SEED_NOW));
  return { store, repo: null, now: () => new Date(SEED_NOW.getTime() + 3_600_000) };
}

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

/** A fake fetch that replays scripted Anthropic replies and records each request. */
function scriptedFetch(replies: Array<Record<string, unknown> | ((body: Record<string, unknown>) => Record<string, unknown>)>, status = 200) {
  const calls: Call[] = [];
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url: String(url), headers: init?.headers as Record<string, string>, body: structuredClone(body) });
    const next = replies[Math.min(calls.length - 1, replies.length - 1)];
    const payload = typeof next === "function" ? next(body) : next;
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fake, calls };
}

function config(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return { anthropicKey: "sk-ant-test", anthropicModel: "claude-sonnet-4-5", openaiKey: null, openaiModel: "gpt-test", data: { mode: "demo", seedLabel: "invented sample" }, ...overrides };
}

test("the Anthropic loop runs every tool_use block and returns the final answer with steps", async () => {
  const ctx = await context();
  const { fake, calls } = scriptedFetch([
    {
      model: "claude-sonnet-4-5",
      stop_reason: "tool_use",
      content: [
        { type: "text", text: "Checking." },
        { type: "tool_use", id: "tu_1", name: "stuck_orders", input: {} },
        { type: "tool_use", id: "tu_2", name: "search_orders", input: { stage: "awaiting_payment", limit: 5 } },
      ],
    },
    { model: "claude-sonnet-4-5", stop_reason: "end_turn", content: [{ type: "text", text: "**2 orders are stuck.** EPK-000044 needs RevOps." }] },
  ]);
  const result = await runAgent({ question: "What's stuck right now?", history: [], ctx, config: config({ fetch: fake }) });

  assert.equal(result.provider, "anthropic");
  assert.equal(result.answer, "**2 orders are stuck.** EPK-000044 needs RevOps.");
  assert.equal(result.notice, null);
  assert.deepEqual(result.steps.map((s) => s.tool), ["stuck_orders", "search_orders"]);
  assert.ok(result.steps.every((s) => s.ok && s.summary.length > 0));

  assert.equal(calls.length, 2);
  const first = calls[0];
  assert.equal(first.url, "https://api.anthropic.com/v1/messages");
  assert.equal(first.headers["x-api-key"], "sk-ant-test");
  assert.equal(first.headers["anthropic-version"], "2023-06-01");
  assert.equal(first.body.model, "claude-sonnet-4-5");
  assert.match(String(first.body.system), /Offered price/);
  assert.match(String(first.body.system), /2026-10-30/);
  const tools = first.body.tools as Array<{ name: string; input_schema: { type: string } }>;
  assert.ok(tools.some((t) => t.name === "get_order" && t.input_schema.type === "object"));

  const second = calls[1].body.messages as Array<{ role: string; content: unknown }>;
  const toolTurn = second[second.length - 1];
  assert.equal(toolTurn.role, "user");
  const results = toolTurn.content as Array<{ type: string; tool_use_id: string; content: string; is_error?: boolean }>;
  assert.deepEqual(results.map((r) => r.tool_use_id), ["tu_1", "tu_2"]);
  assert.ok(results.every((r) => r.type === "tool_result" && !r.is_error));
  assert.equal(JSON.parse(results[1].content).total, 3);
  assert.equal(second[second.length - 2].role, "assistant");
});

test("prior turns are sent as conversation history", async () => {
  const ctx = await context();
  const { fake, calls } = scriptedFetch([{ stop_reason: "end_turn", content: [{ type: "text", text: "Harish, with 5 orders." }] }]);
  await runAgent({
    question: "And who sold most?",
    history: [
      { role: "assistant", content: "orphan greeting" },
      { role: "user", content: "Today's sales by hub" },
      { role: "assistant", content: "HQ leads." },
    ],
    ctx,
    config: config({ fetch: fake }),
  });
  const messages = calls[0].body.messages as Array<{ role: string; content: string }>;
  assert.deepEqual(messages.map((m) => m.role), ["user", "assistant", "user"]);
  assert.equal(messages[2].content, "And who sold most?");
  assert.deepEqual(cleanHistory([{ role: "user", content: "a" }, { role: "user", content: "b" }, { role: "assistant", content: "c" }, { role: "user", content: "dangling" }]), [
    { role: "user", content: "a\n\nb" },
    { role: "assistant", content: "c" },
  ]);
});

test("a bad tool input goes back to the model as an error result, not a crash", async () => {
  const ctx = await context();
  const { fake, calls } = scriptedFetch([
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu_bad", name: "sales_summary", input: { from: "yesterday" } }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "I need a date." }] },
  ]);
  const result = await runAgent({ question: "Sales yesterday", ctx, config: config({ fetch: fake }) });
  assert.equal(result.steps[0].ok, false);
  const turn = (calls[1].body.messages as Array<{ content: unknown }>).at(-1)!.content as Array<{ is_error?: boolean; content: string }>;
  assert.equal(turn[0].is_error, true);
  assert.match(turn[0].content, /IST calendar date/);
});

test("the last allowed round forbids tools so the loop always ends with text", async () => {
  const ctx = await context();
  const { fake, calls } = scriptedFetch([
    (body) =>
      body.tool_choice
        ? { stop_reason: "end_turn", content: [{ type: "text", text: "Final answer." }] }
        : { stop_reason: "tool_use", content: [{ type: "tool_use", id: `tu_${Math.random()}`, name: "pipeline_summary", input: {} }] },
  ]);
  const result = await runAgent({ question: "Loop forever", ctx, config: config({ fetch: fake, maxRounds: 3 }) });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2].body.tool_choice, { type: "none" });
  assert.equal(result.answer, "Final answer.");
  assert.equal(result.steps.length, 2);
});

test("an Anthropic failure falls back to OpenAI tool calling with the same tools", async () => {
  const ctx = await context();
  const { fake } = scriptedFetch([{ type: "error", error: { type: "overloaded_error", message: "busy" } }], 529);
  const requests: Array<Record<string, unknown>> = [];
  const openai: OpenAiLike = {
    chat: {
      completions: {
        async create(body) {
          requests.push(structuredClone(body));
          if (requests.length === 1) {
            return { choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "dispatch_queue", arguments: "{}" } }] } }] };
          }
          return { choices: [{ message: { role: "assistant", content: "COD to collect today is shown above." } }] };
        },
      },
    },
  };
  const result = await runAgent({ question: "COD to collect today", ctx, config: config({ fetch: fake, openaiKey: "sk-test", openai }) });
  assert.equal(result.provider, "openai");
  assert.equal(result.answer, "COD to collect today is shown above.");
  assert.match(result.notice ?? "", /Claude was unavailable \(Anthropic returned HTTP 529 \(overloaded_error\)\)/);
  assert.deepEqual(result.steps.map((s) => s.tool), ["dispatch_queue"]);
  const tools = requests[0].tools as Array<{ type: string; function: { name: string } }>;
  assert.equal(tools.length, 13);
  const msgs = requests[1].messages as Array<{ role: string; tool_call_id?: string }>;
  assert.equal(msgs.at(-1)?.role, "tool");
  assert.equal(msgs.at(-1)?.tool_call_id, "call_1");
});

test("with no key, or every provider failing, the answer comes from fixed reports", async () => {
  const ctx = await context();
  const keyless = await runAgent({ question: "What's stuck right now?", ctx, config: config({ anthropicKey: null }) });
  assert.equal(keyless.provider, "rules");
  assert.match(keyless.answer, /stuck/i);
  assert.match(keyless.notice ?? "", /No AI key/);
  assert.equal(keyless.steps[0].tool, "stuck_orders");

  const failing = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
  const failed = await runAgent({ question: "COD to collect today", ctx, config: config({ fetch: failing }) });
  assert.equal(failed.provider, "rules");
  assert.ok(failed.answer.length > 20);
  assert.match(failed.notice ?? "", /Claude was unavailable/);

  const briefing = await runBriefing({ ctx, config: config({ anthropicKey: null }) });
  assert.equal(briefing.provider, "rules");
  assert.match(briefing.answer, /Headline/);
});

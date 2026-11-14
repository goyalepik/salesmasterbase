import "server-only";

import { readEnv } from "@/lib/env";
import type { SaleModel } from "@/lib/ai/sale-reader";

const TIMEOUT_MS = 25_000;

/** Claude with one forced tool whose input is the schema. */
function anthropicModel(key: string, modelName: string): SaleModel {
  return async ({ name, system, user, schema }) => {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: modelName,
        max_tokens: 1500,
        system,
        messages: [{ role: "user", content: user }],
        tools: [{ name, description: "Return the fields.", input_schema: schema }],
        tool_choice: { type: "tool", name },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Claude answered ${response.status}`);
    const body = (await response.json()) as { content?: Array<{ type: string; input?: unknown }> };
    const call = body.content?.find((part) => part.type === "tool_use");
    if (!call) throw new Error("Claude gave no fields.");
    return call.input;
  };
}

/** OpenAI with strict JSON output. */
function openaiModel(key: string, modelName: string): SaleModel {
  return async ({ name, system, user, schema }) => {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
        max_completion_tokens: 1500,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`OpenAI answered ${response.status}`);
    const body = (await response.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenAI gave no fields.");
    return JSON.parse(content) as unknown;
  };
}

/** Claude when its key is set, else OpenAI, else null (the reader stays off). */
export function saleModelFromEnv(): SaleModel | null {
  const env = readEnv();
  const anthropic = process.env.ANTHROPIC_API_KEY?.trim();
  if (anthropic) return anthropicModel(anthropic, env.anthropicModel);
  const openai = process.env.OPENAI_API_KEY?.trim();
  if (openai) return openaiModel(openai, env.openaiModel);
  return null;
}

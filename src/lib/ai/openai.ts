import "server-only";

import OpenAI from "openai";
import { readEnv } from "@/lib/env";
import { log } from "@/lib/log";
import type { GroundedFacts } from "@/lib/ai/ground";

export class AiUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUnavailable";
  }
}

export async function summariseFacts(facts: GroundedFacts): Promise<string> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new AiUnavailable("OPENAI_API_KEY is not configured.");
  const model = readEnv().openaiModel;
  const client = new OpenAI({ apiKey: key, timeout: 20_000, maxRetries: 0 });
  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.1,
      max_completion_tokens: 450,
      messages: [
        {
          role: "system",
          content:
            "Summarise internal operations records for EPIK. Use only the supplied counts, notes, and source paths. Do not invent numbers, revenue, conversion, or verified payments. Say when a fact is absent. Payment mentions are unverified claims from Slack text.",
        },
        {
          role: "user",
          content: JSON.stringify({
            question: facts.question,
            range: facts.rangeLabel,
            counts: facts.counts,
            notes: facts.notes,
            sources: facts.sources.map((source) => ({ href: source.href, label: source.label })),
          }),
        },
      ],
    });
    return completion.choices[0]?.message?.content?.trim() ?? "";
  } catch (error) {
    log("error", "openai_request_failed", { message: error instanceof Error ? error.name : "unknown" });
    throw new AiUnavailable("The model request failed.");
  }
}

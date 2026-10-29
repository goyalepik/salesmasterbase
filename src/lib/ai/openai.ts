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
            "You speak to the EPIK founder. Answer in at most three short sentences. Start with what you found. If names, customers, or amounts are missing, say that it is not organized and name the one thing you need. Use only the supplied counts. Do not invent revenue or verified payments. Do not list every count.",
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

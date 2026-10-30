import "server-only";

import { readEnv } from "@/lib/env";
import { quickHealth } from "@/lib/health";
import { demoSeedLabel, getOpsStore } from "@/lib/ops";
import type { AgentConfig } from "@/lib/ai/agent";
import type { ToolContext } from "@/lib/ai/tools";

/** Tools over this process's operations store, plus the legacy Slack repository when present. */
export async function toolContext(): Promise<ToolContext | null> {
  const store = await getOpsStore();
  if (!store) return null;
  const { repo } = quickHealth();
  return { store, repo, now: () => new Date() };
}

export function agentConfig(): AgentConfig {
  const env = readEnv();
  const mode = env.mode.ok ? env.mode.mode : "demo";
  return {
    anthropicKey: process.env.ANTHROPIC_API_KEY?.trim() || null,
    anthropicModel: env.anthropicModel,
    openaiKey: process.env.OPENAI_API_KEY?.trim() || null,
    openaiModel: env.openaiModel,
    data: { mode, seedLabel: mode === "demo" ? demoSeedLabel() : null },
  };
}

export type AssistantStatus = { provider: "anthropic" | "openai" | "rules"; model: string };

export function assistantStatus(): AssistantStatus {
  const env = readEnv();
  if (env.anthropicKeyPresent) return { provider: "anthropic", model: env.anthropicModel };
  if (env.openaiKeyPresent) return { provider: "openai", model: env.openaiModel };
  return { provider: "rules", model: "fixed reports" };
}

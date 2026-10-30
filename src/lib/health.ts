import "server-only";

import { getDemoRepository } from "@/lib/demo/repository";
import { getLiveRepository } from "@/lib/db/supabase-repository";
import { chooseDataSource, missingLiveRequirements, readEnv, type ServerEnv } from "@/lib/env";
import type { HealthFacts } from "@/lib/types";
import type { OpsRepository } from "@/lib/repository";

export type IntegrationState = "not_configured" | "configured" | "reachable" | "unreachable" | "disabled";

export type HealthReport = {
  modeLabel: "Demo" | "Live" | "Invalid";
  source: "demo" | "live" | "misconfigured" | "unavailable";
  missing: string[];
  slackSigning: IntegrationState;
  slackBotToken: boolean;
  slackChannelId: string | null;
  slackChannelName: string | null;
  accessCode: "missing" | "set" | "not_required";
  database: IntegrationState;
  databaseDetail: string;
  ingestion: "disabled" | "ready" | "missing_secret";
  openaiConfigured: boolean;
  openaiModel: string;
  anonKeyPresent: boolean;
  facts: HealthFacts | null;
  checkedAt: string;
};

function base(env: ServerEnv, source: HealthReport["source"]): HealthReport {
  const modeLabel = !env.mode.ok ? "Invalid" : env.mode.mode === "live" ? "Live" : "Demo";
  return {
    modeLabel,
    source,
    missing: source === "demo" ? [] : missingLiveRequirements(env),
    slackSigning: env.slackSigningSecret ? "configured" : "not_configured",
    slackBotToken: Boolean(env.slackBotToken),
    slackChannelId: env.slackChannelId,
    slackChannelName: env.slackChannelName,
    accessCode: env.mode.ok && env.mode.mode === "demo"
      ? "not_required"
      : env.dashboardAccessCode && env.dashboardAccessCode.length >= 8
        ? "set"
        : "missing",
    database: "not_configured",
    databaseDetail: "Not checked.",
    ingestion: env.mode.ok && env.mode.mode === "live" ? (env.slackSigningSecret ? "ready" : "missing_secret") : "disabled",
    openaiConfigured: env.openaiKeyPresent,
    openaiModel: env.openaiModel,
    anonKeyPresent: env.supabaseAnonKeyPresent,
    facts: null,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Configuration-only check used on every page. It does not touch the database, so navigation
 * never waits on a health query. A real read happens on Settings and /api/health.
 */
export function quickHealth(env: ServerEnv = readEnv()): { report: HealthReport; repo: OpsRepository | null } {
  const choice = chooseDataSource(env);
  if (choice === "demo") {
    return { repo: getDemoRepository(), report: { ...base(env, "demo"), database: "disabled", databaseDetail: "Demo mode does not open a database connection." } };
  }
  if (choice === "misconfigured") {
    return {
      repo: null,
      report: { ...base(env, "misconfigured"), database: env.supabaseUrl && env.serviceRoleKey ? "configured" : "not_configured", databaseDetail: "Live mode is missing required configuration, so no messages were loaded." },
    };
  }
  return { repo: getLiveRepository(), report: { ...base(env, "live"), database: "configured", databaseDetail: "Not checked on this page. Settings runs a database read." } };
}

export async function inspectHealth(env: ServerEnv = readEnv()): Promise<{ report: HealthReport; repo: OpsRepository | null }> {
  const choice = chooseDataSource(env);
  if (choice === "demo") {
    const repo = getDemoRepository();
    const facts = await repo.healthFacts();
    return {
      repo,
      report: {
        ...base(env, "demo"),
        database: "disabled",
        databaseDetail: "Demo mode does not open a database connection.",
        facts,
      },
    };
  }
  if (choice === "misconfigured") {
    return {
      repo: null,
      report: {
        ...base(env, "misconfigured"),
        database: env.supabaseUrl && env.serviceRoleKey ? "configured" : "not_configured",
        databaseDetail: "Live mode is missing required configuration, so no messages were loaded.",
      },
    };
  }

  const repo = getLiveRepository();
  try {
    const facts = await repo.healthFacts();
    return {
      repo,
      report: {
        ...base(env, "live"),
        database: "reachable",
        databaseDetail: "A read against slack_messages succeeded.",
        facts,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The database request failed.";
    return {
      repo: null,
      report: {
        ...base(env, "unavailable"),
        database: "unreachable",
        databaseDetail: message,
        missing: [],
      },
    };
  }
}

export type AppMode = "demo" | "live";

export type ModeResult = { ok: true; mode: AppMode } | { ok: false; reason: string };

export type ServerEnv = {
  mode: ModeResult;
  supabaseUrl: string | null;
  supabaseAnonKeyPresent: boolean;
  serviceRoleKey: string | null;
  slackBotToken: string | null;
  slackSigningSecret: string | null;
  slackChannelId: string | null;
  slackChannelName: string | null;
  dashboardAccessCode: string | null;
  openaiKeyPresent: boolean;
  openaiModel: string;
  anthropicKeyPresent: boolean;
  anthropicModel: string;
  mcpToken: string | null;
};

function blank(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function resolveMode(raw: string | null): ModeResult {
  const value = raw ?? "demo";
  if (value === "demo" || value === "live") return { ok: true, mode: value };
  return { ok: false, reason: `APP_MODE must be demo or live. Received "${value}".` };
}

export function readEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  return {
    mode: resolveMode(blank(source.APP_MODE)),
    supabaseUrl: blank(source.SUPABASE_URL) ?? blank(source.NEXT_PUBLIC_SUPABASE_URL),
    supabaseAnonKeyPresent: Boolean(blank(source.NEXT_PUBLIC_SUPABASE_ANON_KEY)),
    serviceRoleKey: blank(source.SUPABASE_SERVICE_ROLE_KEY),
    slackBotToken: blank(source.SLACK_BOT_TOKEN),
    slackSigningSecret: blank(source.SLACK_SIGNING_SECRET),
    slackChannelId: blank(source.SLACK_CHANNEL_ID),
    slackChannelName: blank(source.SLACK_CHANNEL_NAME),
    dashboardAccessCode: blank(source.DASHBOARD_ACCESS_CODE),
    openaiKeyPresent: Boolean(blank(source.OPENAI_API_KEY)),
    openaiModel: blank(source.OPENAI_MODEL) ?? "gpt-4o-mini",
    anthropicKeyPresent: Boolean(blank(source.ANTHROPIC_API_KEY)),
    anthropicModel: blank(source.ANTHROPIC_MODEL) ?? "claude-sonnet-4-5",
    mcpToken: blank(source.MCP_TOKEN),
  };
}

export function missingLiveRequirements(env: ServerEnv): string[] {
  const missing: string[] = [];
  if (!env.mode.ok) missing.push("APP_MODE");
  if (env.mode.ok && env.mode.mode !== "live") return missing;
  if (!env.supabaseUrl) missing.push("SUPABASE_URL");
  if (!env.serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!env.slackSigningSecret) missing.push("SLACK_SIGNING_SECRET");
  if (!env.dashboardAccessCode || env.dashboardAccessCode.length < 8) missing.push("DASHBOARD_ACCESS_CODE");
  return missing;
}

export function liveRequirementsMet(env: ServerEnv): boolean {
  return env.mode.ok && env.mode.mode === "live" && missingLiveRequirements(env).length === 0;
}

/**
 * Demo data is allowed only when the operator explicitly asked for demo mode.
 * A broken live setup must not fall through to sample messages.
 */
export function chooseDataSource(env: ServerEnv): "demo" | "live" | "misconfigured" {
  if (!env.mode.ok) return "misconfigured";
  if (env.mode.mode === "demo") return "demo";
  if (!liveRequirementsMet(env)) return "misconfigured";
  return "live";
}

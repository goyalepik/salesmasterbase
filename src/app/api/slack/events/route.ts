import { after } from "next/server";
import { liveRequirementsMet, readEnv } from "@/lib/env";
import { log } from "@/lib/log";
import { getLiveRepository } from "@/lib/db/supabase-repository";
import { handleSlackEvent } from "@/lib/slack/handle-event";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const rawBody = await request.text();
  const env = readEnv();
  const mode = env.mode.ok ? env.mode.mode : "demo";
  const handlerEnv = {
    mode,
    signingSecret: env.slackSigningSecret,
    monitoredChannelId: env.slackChannelId,
    channelName: env.slackChannelName,
  } as const;

  if (!env.mode.ok) {
    return Response.json({ error: "APP_MODE must be demo or live." }, { status: 503 });
  }
  if (mode !== "live" || !liveRequirementsMet(env)) {
    return Response.json(
      { error: mode === "live" ? "Live ingestion is missing required configuration." : "Slack ingestion is disabled while APP_MODE=demo." },
      { status: 503 },
    );
  }

  return handleSlackEvent({
    rawBody,
    timestamp: request.headers.get("x-slack-request-timestamp"),
    signature: request.headers.get("x-slack-signature"),
    retryNum: request.headers.get("x-slack-retry-num"),
    retryReason: request.headers.get("x-slack-retry-reason"),
    env: handlerEnv,
    repo: getLiveRepository(),
    schedule(task) {
      after(async () => {
        try {
          await task();
        } catch (error) {
          log("error", "slack_processing_failed", { message: error instanceof Error ? error.message : "unknown" });
        }
      });
    },
  });
}

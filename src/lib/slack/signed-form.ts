import { liveRequirementsMet, readEnv } from "@/lib/env";
import { verifySlackSignature } from "@/lib/slack/signature";

export async function readSignedSlackForm(request: Request): Promise<
  | { ok: true; params: URLSearchParams; token: string; channelId: string | null; channelName: string | null }
  | { ok: false; response: Response }
> {
  const rawBody = await request.text();
  const env = readEnv();
  const mode = env.mode.ok ? env.mode.mode : "demo";
  if (mode !== "live" || !liveRequirementsMet(env) || !env.slackSigningSecret || !env.slackBotToken) {
    return { ok: false, response: new Response("Slack form is not ready.", { status: 503 }) };
  }
  const verified = verifySlackSignature({
    signingSecret: env.slackSigningSecret,
    rawBody,
    timestamp: request.headers.get("x-slack-request-timestamp"),
    signature: request.headers.get("x-slack-signature"),
  });
  if (!verified.ok) return { ok: false, response: new Response("invalid signature", { status: 401 }) };
  return {
    ok: true,
    params: new URLSearchParams(rawBody),
    token: env.slackBotToken,
    channelId: env.slackChannelId,
    channelName: env.slackChannelName,
  };
}

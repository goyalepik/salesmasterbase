import { NextResponse } from "next/server";
import { readEnv } from "@/lib/env";
import { isSameOrigin } from "@/lib/same-origin";
import { saleButtonMessage } from "@/lib/slack/sale-form";
import { loadWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response("Cross-origin request refused.", { status: 403 });
  const back = new URL("/settings", request.url);
  const workspace = await loadWorkspace();
  const env = readEnv();
  if (workspace.kind !== "ready" || workspace.mode !== "live" || !env.slackBotToken || !env.slackChannelId) {
    back.searchParams.set("button", "not_ready");
    return NextResponse.redirect(back);
  }
  const posted = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.slackBotToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ channel: env.slackChannelId, ...saleButtonMessage() }),
    signal: AbortSignal.timeout(8000),
  });
  const body = (await posted.json()) as { ok?: boolean; error?: string };
  back.searchParams.set("button", body.ok ? "posted" : body.error === "missing_scope" ? "missing_scope" : "failed");
  return NextResponse.redirect(back);
}

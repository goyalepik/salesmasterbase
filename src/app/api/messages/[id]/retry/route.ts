import { NextResponse } from "next/server";
import { readEnv } from "@/lib/env";
import { processStoredMessage } from "@/lib/process-message";
import { isSameOrigin } from "@/lib/same-origin";
import { MAX_PROCESSING_ATTEMPTS } from "@/lib/types";
import { loadWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return new Response("Cross-origin request refused.", { status: 403 });
  const { id } = await context.params;
  const workspace = await loadWorkspace();
  const back = new URL(`/inbox/${id}`, request.url);
  if (workspace.kind !== "ready") return NextResponse.redirect(new URL("/settings", request.url));
  const message = await workspace.repo.getMessage(id);
  if (!message) return NextResponse.redirect(new URL("/inbox", request.url));
  if (message.processingStatus !== "failed" || message.retryCount >= MAX_PROCESSING_ATTEMPTS) {
    return NextResponse.redirect(back);
  }
  await workspace.repo.appendAudit({
    action: "retry_performed",
    entityType: "slack_message",
    entityId: id,
    outcome: "success",
    actor: "Dashboard user",
    summary: "Manual retry requested.",
  });
  await processStoredMessage(workspace.repo, id, { monitoredChannelId: readEnv().slackChannelId });
  return NextResponse.redirect(back);
}

import { NextResponse } from "next/server";
import { readEnv } from "@/lib/env";
import { isSameOrigin } from "@/lib/same-origin";
import { refreshSenderNames } from "@/lib/slack/refresh-names";
import { loadWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response("Cross-origin request refused.", { status: 403 });
  const url = new URL("/settings", request.url);
  const workspace = await loadWorkspace();
  if (workspace.kind !== "ready") {
    url.searchParams.set("names", "unavailable");
    return NextResponse.redirect(url);
  }
  const result = await refreshSenderNames(workspace.repo, readEnv().slackBotToken);
  url.searchParams.set("names", result.status);
  if (result.updated > 0) url.searchParams.set("count", String(result.updated));
  return NextResponse.redirect(url);
}

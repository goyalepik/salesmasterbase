import { NextResponse } from "next/server";
import { readEnv } from "@/lib/env";
import { processStoredMessage } from "@/lib/process-message";
import { isSameOrigin } from "@/lib/same-origin";
import { formatDeskOrder, readOrderFields } from "@/lib/slack/sale-form";
import { slackPermalink } from "@/lib/slack/schema";
import { STUCK_PROCESSING_MS } from "@/lib/types";
import { loadWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function errorCode(errors: Record<string, string>): string {
  return Object.keys(errors)[0] ?? "customer";
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response("Cross-origin request refused.", { status: 403 });
  const back = new URL("/orders/new", request.url);
  const workspace = await loadWorkspace();
  if (workspace.kind !== "ready") return NextResponse.redirect(back);
  const form = await request.formData();
  const read = readOrderFields({
    customer: String(form.get("customer") ?? ""),
    product: String(form.get("product") ?? ""),
    email: String(form.get("email") ?? ""),
    shippingAddress: String(form.get("shipping_address") ?? ""),
    pincode: String(form.get("pincode") ?? ""),
    billingAddress: String(form.get("billing_address") ?? ""),
    hub: String(form.get("hub") ?? ""),
    cxType: String(form.get("cx_type") ?? ""),
    poc: String(form.get("poc") ?? ""),
    saleSource: String(form.get("sale_source") ?? ""),
    saleType: String(form.get("sale_type") ?? ""),
    listPrice: String(form.get("list_price") ?? ""),
    offeredPrice: String(form.get("offered_price") ?? ""),
    paymentStatus: String(form.get("payment_status") ?? ""),
    paymentMode: String(form.get("payment_mode") ?? ""),
    gst: String(form.get("gst") ?? ""),
    notes: String(form.get("notes") ?? ""),
  });
  if (!read.ok) {
    back.searchParams.set("error", errorCode(read.errors));
    return NextResponse.redirect(back);
  }

  const text = formatDeskOrder(read.fields);
  const env = readEnv();
  const channels = await workspace.repo.channels();
  const channelId = (workspace.mode === "live" ? env.slackChannelId : null) || channels[0]?.id || "CLOCAL";
  const channelName = channels.find((channel) => channel.id === channelId)?.name ?? (channelId === env.slackChannelId ? env.slackChannelName : null);
  let messageTs = `desk.${Date.now()}`;
  if (workspace.mode === "live" && env.slackBotToken && env.slackChannelId) {
    try {
      const posted = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.slackBotToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ channel: env.slackChannelId, text }),
        signal: AbortSignal.timeout(8000),
      });
      const body = (await posted.json()) as { ok?: boolean; ts?: string };
      if (body.ok && body.ts) messageTs = body.ts;
    } catch {
      messageTs = `desk.${Date.now()}`;
    }
  }

  const inserted = await workspace.repo.insertInbound({
    slackTeamId: null,
    slackChannelId: channelId,
    slackChannelName: channelName,
    slackMessageTs: messageTs,
    slackEventId: null,
    senderId: null,
    senderName: read.fields.poc,
    text,
    threadTs: messageTs,
    permalink: messageTs.startsWith("desk.") ? null : slackPermalink(channelId, messageTs),
    subtype: null,
    botId: null,
    eventReceivedAt: new Date().toISOString(),
    sourceMetadata: { source: "epik_sale_form" },
  });
  if (!inserted.ok) {
    back.searchParams.set("error", "save");
    return NextResponse.redirect(back);
  }
  if (!inserted.duplicate) {
    await workspace.repo.reclaimStuck(STUCK_PROCESSING_MS);
    await processStoredMessage(workspace.repo, inserted.message.id, { monitoredChannelId: channelId });
  }
  const inbox = new URL("/inbox", request.url);
  inbox.searchParams.set("saved", "1");
  return NextResponse.redirect(inbox);
}

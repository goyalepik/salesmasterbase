import { after } from "next/server";
import { getLiveRepository } from "@/lib/db/supabase-repository";
import { log } from "@/lib/log";
import { processStoredMessage } from "@/lib/process-message";
import { channelFromMetadata, formatSale, readSaleSubmission, saleModal, SALE_BUTTON_ACTION, SALE_CALLBACK_ID } from "@/lib/slack/sale-form";
import { slackPermalink } from "@/lib/slack/schema";
import { readSignedSlackForm } from "@/lib/slack/signed-form";
import { STUCK_PROCESSING_MS } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Submission = {
  type?: string;
  trigger_id?: string;
  response_url?: string;
  team?: { id?: string };
  channel?: { id?: string };
  actions?: Array<{ action_id?: string }>;
  view?: { callback_id?: string; private_metadata?: string; state?: { values?: unknown } };
  user?: { id?: string };
};

export async function POST(request: Request) {
  const signed = await readSignedSlackForm(request);
  if (!signed.ok) return signed.response;
  let payload: Submission;
  try {
    payload = JSON.parse(signed.params.get("payload") ?? "") as Submission;
  } catch {
    return new Response("invalid request", { status: 400 });
  }
  if (payload.type === "block_actions" && payload.actions?.some((action) => action.action_id === SALE_BUTTON_ACTION)) {
    const channelId = signed.channelId || payload.channel?.id;
    if (!payload.trigger_id || !channelId) return new Response(null, { status: 200 });
    const opened = await fetch("https://slack.com/api/views.open", {
      method: "POST",
      headers: { Authorization: `Bearer ${signed.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ trigger_id: payload.trigger_id, view: saleModal(channelId) }),
      signal: AbortSignal.timeout(8000),
    });
    const openedBody = (await opened.json()) as { ok?: boolean };
    if (!openedBody.ok && payload.response_url) {
      await fetch(payload.response_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response_type: "ephemeral", text: "The sale form could not open. Try the New sale button again." }),
      });
    }
    return new Response(null, { status: 200 });
  }

  if (payload.type !== "view_submission" || payload.view?.callback_id !== SALE_CALLBACK_ID) {
    return new Response(null, { status: 200 });
  }

  const salespersonId = payload.user?.id ?? "";
  const read = readSaleSubmission(payload.view.state?.values, salespersonId);
  if (!read.ok) return Response.json({ response_action: "errors", errors: read.errors });

  const channel = channelFromMetadata(payload.view.private_metadata ?? "", signed.channelId);
  if (!channel) return Response.json({ response_action: "errors", errors: { customer: "The sales channel is not set." } });

  const text = formatSale(read.fields);
  const posted = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${signed.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ channel, text }),
    signal: AbortSignal.timeout(8000),
  });
  const body = (await posted.json()) as { ok?: boolean; error?: string; ts?: string };
  if (!body.ok || !body.ts) {
    const hint = body.error === "missing_scope" || body.error === "not_in_channel"
      ? "Add chat:write, invite the app to the channel, and reinstall."
      : "Slack did not accept the order. Try again.";
    return Response.json({ response_action: "errors", errors: { customer: hint } });
  }

  const messageTs = body.ts;
  const teamId = payload.team?.id ?? null;
  const channelName = channel === signed.channelId ? signed.channelName : null;
  after(async () => {
    try {
      const repo = getLiveRepository();
      const senderName = read.fields.poc;
      const inserted = await repo.insertInbound({
        slackTeamId: teamId,
        slackChannelId: channel,
        slackChannelName: channelName,
        slackMessageTs: messageTs,
        slackEventId: null,
        senderId: salespersonId,
        senderName,
        text,
        threadTs: null,
        permalink: slackPermalink(channel, messageTs),
        subtype: null,
        botId: null,
        eventReceivedAt: new Date().toISOString(),
        sourceMetadata: { source: "epik_sale_form" },
      });
      if (!inserted.ok || inserted.duplicate) return;
      await repo.reclaimStuck(STUCK_PROCESSING_MS);
      await processStoredMessage(repo, inserted.message.id, { monitoredChannelId: signed.channelId });
    } catch (error) {
      log("error", "sale_form_store_failed", { message: error instanceof Error ? error.message : "unknown" });
    }
  });

  return new Response(null, { status: 200 });
}

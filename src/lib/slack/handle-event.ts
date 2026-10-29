import { log } from "@/lib/log";
import { processStoredMessage } from "@/lib/process-message";
import { slackDisplayName } from "@/lib/slack/profiles";
import type { OpsRepository } from "@/lib/repository";
import { formSalesperson } from "@/lib/slack/sale-form";
import { slackEnvelopeSchema, slackPermalink, sourceMetadata } from "@/lib/slack/schema";
import { verifySlackSignature } from "@/lib/slack/signature";
import { STUCK_PROCESSING_MS } from "@/lib/types";

export type SlackHandlerEnv = {
  mode: "demo" | "live";
  signingSecret: string | null;
  monitoredChannelId: string | null;
  channelName: string | null;
  botToken?: string | null;
};

export async function handleSlackEvent(input: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  retryNum: string | null;
  retryReason: string | null;
  env: SlackHandlerEnv;
  repo: OpsRepository;
  schedule: (task: () => Promise<void>) => void;
  nowSeconds?: number;
}): Promise<Response> {
  if (input.env.mode !== "live") {
    return Response.json({ error: "Slack ingestion is disabled while APP_MODE=demo." }, { status: 503 });
  }
  if (!input.env.signingSecret) {
    return Response.json({ error: "SLACK_SIGNING_SECRET is not configured." }, { status: 503 });
  }

  const verified = verifySlackSignature({
    signingSecret: input.env.signingSecret,
    rawBody: input.rawBody,
    timestamp: input.timestamp,
    signature: input.signature,
    nowSeconds: input.nowSeconds,
  });
  if (!verified.ok) {
    log("error", "slack_signature_rejected", { reason: verified.reason, retryNum: input.retryNum });
    return new Response("invalid signature", { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(input.rawBody);
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const parsed = slackEnvelopeSchema.safeParse(json);
  if (!parsed.success) return new Response("invalid request", { status: 400 });
  const envelope = parsed.data;

  if (envelope.type === "url_verification") {
    if (!envelope.challenge) return new Response("missing challenge", { status: 400 });
    return Response.json({ challenge: envelope.challenge });
  }

  if (envelope.type !== "event_callback") {
    await input.repo.appendAudit({
      action: "event_received",
      entityType: "slack_event",
      entityId: envelope.event_id ?? "unknown",
      outcome: "success",
      actor: "slack",
      summary: `Ignored unsupported envelope type ${envelope.type}.`,
    });
    return new Response(null, { status: 200, headers: { "x-slack-no-retry": "1" } });
  }

  const event = envelope.event;
  if (!event || event.type !== "message") {
    await input.repo.appendAudit({
      action: "event_received",
      entityType: "slack_event",
      entityId: envelope.event_id ?? "unknown",
      outcome: "success",
      actor: "slack",
      summary: `Ignored unsupported event ${event?.type ?? "unknown"}.`,
    });
    return new Response(null, { status: 200, headers: { "x-slack-no-retry": "1" } });
  }

  const channel = event.channel;
  const ts = event.ts ?? event.message?.ts;
  if (!channel || !ts) return new Response("missing message identity", { status: 400 });

  const text = event.text ?? event.message?.text ?? "";
  const formUser = formSalesperson(text);
  const senderId = formUser ?? event.user ?? event.message?.user ?? null;
  let senderName: string | null = null;
  if (senderId && input.env.botToken) {
    try {
      senderName = await slackDisplayName(input.env.botToken, senderId);
      if (senderName) await input.repo.rememberSender(senderId, senderName);
    } catch (error) {
      log("error", "slack_profile_lookup_failed", { message: error instanceof Error ? error.message : "unknown" });
    }
  }
  const receivedAt = envelope.event_time ? new Date(envelope.event_time * 1000).toISOString() : new Date().toISOString();
  const inserted = await input.repo.insertInbound({
    slackTeamId: envelope.team_id ?? null,
    slackChannelId: channel,
    slackChannelName: channel === input.env.monitoredChannelId ? input.env.channelName : null,
    slackMessageTs: ts,
    slackEventId: envelope.event_id ?? null,
    senderId,
    senderName,
    text,
    threadTs: event.thread_ts ?? null,
    permalink: slackPermalink(channel, ts),
    subtype: formUser ? null : event.subtype ?? null,
    botId: formUser ? null : event.bot_id ?? null,
    eventReceivedAt: receivedAt,
    sourceMetadata: sourceMetadata(envelope),
  });

  if (!inserted.ok) {
    log("error", "slack_persist_failed", { error: inserted.error, eventId: envelope.event_id ?? null, retryNum: input.retryNum });
    return new Response("failed to persist event", { status: 500 });
  }

  if (!inserted.duplicate) {
    await input.repo.appendAudit({
      action: "event_received",
      entityType: "slack_message",
      entityId: inserted.message.id,
      outcome: "success",
      actor: "slack",
      summary: input.retryNum ? `Accepted Slack retry ${input.retryNum}.` : "Accepted a Slack event.",
    });
    await input.repo.appendAudit({
      action: "message_persisted",
      entityType: "slack_message",
      entityId: inserted.message.id,
      outcome: "success",
      actor: "slack",
      summary: `Stored ${channel}/${ts}.`,
    });
  }

  const status = inserted.message.processingStatus;
  const shouldProcess = !inserted.duplicate || status === "received" || status === "failed";
  if (!shouldProcess) {
    await input.repo.appendAudit({
      action: "duplicate_ignored",
      entityType: "slack_message",
      entityId: inserted.message.id,
      outcome: "success",
      actor: "slack",
      summary: input.retryReason ? `Duplicate delivery ignored (${input.retryReason}).` : "Duplicate delivery ignored.",
    });
    return new Response(null, { status: 200, headers: { "x-slack-no-retry": "1" } });
  }

  const messageId = inserted.message.id;
  const monitoredChannelId = input.env.monitoredChannelId;
  input.schedule(async () => {
    await input.repo.reclaimStuck(STUCK_PROCESSING_MS);
    if (input.retryNum) {
      await input.repo.appendAudit({
        action: "retry_performed",
        entityType: "slack_message",
        entityId: messageId,
        outcome: "success",
        actor: "slack",
        summary: `Slack retry ${input.retryNum} started processing.`,
      });
    }
    await processStoredMessage(input.repo, messageId, { monitoredChannelId });
  });

  return new Response(null, { status: 200 });
}

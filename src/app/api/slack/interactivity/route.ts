import { after } from "next/server";
import { getLiveRepository } from "@/lib/db/supabase-repository";
import { log } from "@/lib/log";
import { getOpsStore } from "@/lib/ops";
import type { OpsStore } from "@/lib/ops/store";
import { processStoredMessage } from "@/lib/process-message";
import {
  appBaseUrlFromEnv,
  createOpsOrderFromSale,
  handleOpsBlockActions,
  handleOpsViewSubmission,
  hasOpsAction,
  isOpsView,
  opsUnavailable,
  productSuggestions,
  teamChannelsFromEnv,
  type BlockActionsPayload,
  type BlockSuggestionPayload,
  type OpsDeps,
  type Task,
  type ViewSubmissionPayload,
} from "@/lib/slack/ops-actions";
import {
  channelFromMetadata,
  formatSale,
  legacySaleFields,
  PRODUCT_SEARCH_ACTION,
  readOpsSaleSubmission,
  saleModal,
  SALE_BUTTON_ACTION,
  SALE_CALLBACK_ID,
  withCatalogueNames,
} from "@/lib/slack/sale-form";
import { slackPermalink } from "@/lib/slack/schema";
import { readSignedSlackForm } from "@/lib/slack/signed-form";
import { webSlackClient } from "@/lib/slack/slack-client";
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
  view?: { id?: string; callback_id?: string; private_metadata?: string; state?: { values?: unknown } };
  user?: { id?: string; username?: string; name?: string };
};

async function opsStore(): Promise<OpsStore | null> {
  try {
    return await getOpsStore();
  } catch (error) {
    log("error", "ops_store_unavailable", { message: error instanceof Error ? error.message : "unknown" });
    return null;
  }
}

function opsDeps(store: OpsStore, token: string): OpsDeps {
  return {
    store,
    slack: webSlackClient(token),
    appBaseUrl: appBaseUrlFromEnv(process.env),
    teamChannels: teamChannelsFromEnv(process.env),
  };
}

/** Runs each task after the response is sent, so Slack gets its acknowledgement within 3 seconds. */
function later(tasks: Task[], event: string) {
  for (const task of tasks) {
    after(async () => {
      try {
        await task();
      } catch (error) {
        log("error", event, { message: error instanceof Error ? error.message : "unknown" });
      }
    });
  }
}

function reply(body: unknown | null): Response {
  return body ? Response.json(body) : new Response(null, { status: 200 });
}

export async function POST(request: Request) {
  const signed = await readSignedSlackForm(request);
  if (!signed.ok) return signed.response;
  let payload: Submission;
  try {
    payload = JSON.parse(signed.params.get("payload") ?? "") as Submission;
  } catch {
    return new Response("invalid request", { status: 400 });
  }

  // Options for the product pickers (Options Load URL).
  if (payload.type === "block_suggestion") {
    const suggestion = payload as BlockSuggestionPayload;
    if (suggestion.action_id !== PRODUCT_SEARCH_ACTION) return Response.json({ options: [] });
    const store = await opsStore();
    if (!store) return Response.json({ options: [] });
    try {
      return Response.json(await productSuggestions(store, suggestion.value ?? ""));
    } catch (error) {
      log("error", "slack_product_search_failed", { message: error instanceof Error ? error.message : "unknown" });
      return Response.json({ options: [] });
    }
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

  // Buttons on the order card.
  if (payload.type === "block_actions" && hasOpsAction(payload as BlockActionsPayload)) {
    const store = await opsStore();
    if (!store) return new Response(null, { status: 200 });
    const handled = await handleOpsBlockActions(opsDeps(store, signed.token), payload as BlockActionsPayload);
    later(handled.later, "slack_ops_action_failed");
    return reply(handled.body);
  }

  // Forms opened from the order card.
  if (payload.type === "view_submission" && isOpsView(payload as ViewSubmissionPayload)) {
    const store = await opsStore();
    if (!store) return Response.json(opsUnavailable(payload as ViewSubmissionPayload));
    const handled = await handleOpsViewSubmission(opsDeps(store, signed.token), payload as ViewSubmissionPayload);
    later(handled.later, "slack_ops_submission_failed");
    return reply(handled.body);
  }

  if (payload.type !== "view_submission" || payload.view?.callback_id !== SALE_CALLBACK_ID) {
    return new Response(null, { status: 200 });
  }

  const salespersonId = payload.user?.id ?? "";
  const read = readOpsSaleSubmission(payload.view.state?.values, salespersonId);
  if (!read.ok) return Response.json({ response_action: "errors", errors: read.errors });

  const channel = channelFromMetadata(payload.view.private_metadata ?? "", signed.channelId);
  if (!channel) return Response.json({ response_action: "errors", errors: { customer: "The sales channel is not set." } });

  const store = await opsStore();
  const sale = store ? await withCatalogueNames(read.sale, async (sku) => (await store.getProduct(sku))?.name ?? null) : read.sale;
  // The legacy text is posted and stored exactly as before: the old dashboard parses it.
  const text = formatSale(legacySaleFields(sale));
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
  const user = payload.user ?? {};

  // New operations order: create it, then turn the posted message into the live card.
  if (store) {
    const deps = opsDeps(store, signed.token);
    later([async () => void (await createOpsOrderFromSale(deps, { sale, channel, ts: messageTs, user }))], "ops_order_from_sale_failed");
  }

  after(async () => {
    try {
      const repo = getLiveRepository();
      const senderName = sale.fields.poc;
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

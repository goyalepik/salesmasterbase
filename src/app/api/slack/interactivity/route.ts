import { after } from "next/server";
import { getLiveRepository } from "@/lib/db/supabase-repository";
import { log } from "@/lib/log";
import { getOpsStore } from "@/lib/ops";
import type { OpsStore } from "@/lib/ops/store";
import { processStoredMessage } from "@/lib/process-message";
import { shopifyThreadNote } from "@/lib/shopify/drafts";
import { autoShopifyForSale, syncShopify } from "@/lib/shopify/run";
import {
  appBaseUrlFromEnv,
  createOpsOrderFromSale,
  refreshCardWithNote,
  handleOpsBlockActions,
  handleOpsViewSubmission,
  hasOpsAction,
  isOpsView,
  opsUnavailable,
  productSuggestions,
  teamChannelsFromEnv,
  warmProductCatalogue,
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
  formatWebSale,
  formForChoice,
  FULL_SALE_BUTTON_ACTION,
  openerView,
  readOpsSaleSubmission,
  readWebSaleSubmission,
  saleModal,
  SALE_SHORTCUTS,
  SALE_BUTTON_ACTION,
  SALE_CALLBACK_ID,
  SALE_CHOICE_CALLBACK_ID,
  WEB_SALE_BUTTON_ACTION,
  WEB_SALE_CALLBACK_ID,
  withCatalogue,
} from "@/lib/slack/sale-form";
import { recordWebSale } from "@/lib/ops/service";
import { slackPermalink } from "@/lib/slack/schema";
import { readSignedSlackForm } from "@/lib/slack/signed-form";
import { webSlackClient } from "@/lib/slack/slack-client";
import { STUCK_PROCESSING_MS } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Submission = {
  type?: string;
  callback_id?: string;
  trigger_id?: string;
  response_url?: string;
  team?: { id?: string };
  channel?: { id?: string };
  actions?: Array<{ action_id?: string; block_id?: string; selected_option?: { value?: string } }>;
  view?: { id?: string; hash?: string; callback_id?: string; private_metadata?: string; state?: { values?: unknown } };
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

  // The pinned buttons, the Home tab buttons and the lightning-menu shortcuts: open the choice, the long form or the website form.
  // The sale is always posted in the sales channel, wherever the form was opened from.
  const button = payload.type === "block_actions" ? payload.actions?.find((a) => a.action_id === SALE_BUTTON_ACTION || a.action_id === FULL_SALE_BUTTON_ACTION || a.action_id === WEB_SALE_BUTTON_ACTION) : undefined;
  const kind = button
    ? button.action_id === FULL_SALE_BUTTON_ACTION ? "full" : button.action_id === WEB_SALE_BUTTON_ACTION ? "web" : "choice"
    : payload.type === "shortcut" ? SALE_SHORTCUTS[payload.callback_id ?? ""] : undefined;
  if (kind) {
    const channelId = signed.channelId || payload.channel?.id;
    if (!payload.trigger_id || !channelId) return new Response(null, { status: 200 });
    // Load the product list into memory while the person reads the form, so the product search answers at once.
    later([async () => {
      const store = await opsStore();
      if (store) await warmProductCatalogue(store);
    }], "product_catalogue_warm_failed");
    const opened = await webSlackClient(signed.token).viewsOpen({ trigger_id: payload.trigger_id, view: openerView(kind, channelId) });
    if (!opened.ok) {
      log("error", "sale_form_open_failed", { error: opened.error ?? "unknown", from: payload.type ?? "unknown" });
      if (payload.response_url) {
        await fetch(payload.response_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ response_type: "ephemeral", text: "The sale form could not open. Try the button again." }),
        });
      }
    }
    return new Response(null, { status: 200 });
  }

  // Long form: picking a payment status redraws the payment questions under it (what was typed stays).
  if (payload.type === "block_actions" && payload.view?.callback_id === SALE_CALLBACK_ID && payload.view.id) {
    const pick = payload.actions?.find((a) => a.block_id === "payment_status");
    if (pick) {
      const channelId = channelFromMetadata(payload.view.private_metadata ?? "", signed.channelId) ?? "";
      const updated = await webSlackClient(signed.token).viewsUpdate?.({ view_id: payload.view.id, hash: payload.view.hash, view: saleModal(channelId, { paymentStatus: pick.selected_option?.value ?? null }) });
      if (updated && !updated.ok) log("error", "sale_form_update_failed", { error: updated.error ?? "unknown" });
    }
    return new Response(null, { status: 200 });
  }

  // First screen: how is the customer buying? Swap in the chosen form.
  if (payload.type === "view_submission" && payload.view?.callback_id === SALE_CHOICE_CALLBACK_ID) {
    const channelId = channelFromMetadata(payload.view.private_metadata ?? "", signed.channelId) ?? "";
    const next = formForChoice(payload.view.state?.values, channelId);
    if (!next) return Response.json({ response_action: "errors", errors: { sale_kind: "Pick one." } });
    return Response.json({ response_action: "update", view: next });
  }

  // Short form: the customer orders on the website. Post it, save it to match the website order later.
  if (payload.type === "view_submission" && payload.view?.callback_id === WEB_SALE_CALLBACK_ID) {
    return webSale(payload, signed);
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
  if (!read.ok && read.showPayment) {
    // The payment questions did not appear (the redraw was missed): show them now; nothing typed is lost.
    const channelId = channelFromMetadata(payload.view.private_metadata ?? "", signed.channelId) ?? "";
    return Response.json({ response_action: "update", view: saleModal(channelId, { paymentStatus: read.showPayment }) });
  }
  if (!read.ok) return Response.json({ response_action: "errors", errors: read.errors });

  const channel = channelFromMetadata(payload.view.private_metadata ?? "", signed.channelId);
  if (!channel) return Response.json({ response_action: "errors", errors: { customer: "The sales channel is not set." } });

  const store = await opsStore();
  // Full product names and list prices come from the product list (Shopify), not from the CDE.
  const sale = store
    ? await withCatalogue(read.sale, async (sku) => {
        const product = await store.getProduct(sku);
        return product ? { name: product.name, listPriceMinor: product.listPriceMinor } : null;
      })
    : read.sale;
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

  // New operations order: create it, turn the posted message into the live card, then (when switched on) send it
  // to Shopify. The #PIK number then shows on the card and in the thread.
  if (store) {
    const deps = opsDeps(store, signed.token);
    later([async () => {
      const order = await createOpsOrderFromSale(deps, { sale, channel, ts: messageTs, user });
      if (!order) return;
      const shopify = await autoShopifyForSale(store, order.id);
      if (shopify) await refreshCardWithNote(deps, order.id, shopifyThreadNote(shopify));
      // Every sale also checks Shopify (at most every 5 minutes): website orders and #PIK links come in
      // even when nobody has the dashboard open.
      await syncShopify(store);
    }], "ops_order_from_sale_failed");
  }

  storeLegacyText({ text, channel, channelName, messageTs, teamId, salespersonId, senderName: sale.fields.poc, monitoredChannelId: signed.channelId });

  return new Response(null, { status: 200 });
}

/** The old dashboard reads every sale text in the channel: store and process it exactly as before. */
function storeLegacyText(input: { text: string; channel: string; channelName: string | null; messageTs: string; teamId: string | null; salespersonId: string; senderName: string; monitoredChannelId: string | null }) {
  after(async () => {
    try {
      const repo = getLiveRepository();
      const inserted = await repo.insertInbound({
        slackTeamId: input.teamId,
        slackChannelId: input.channel,
        slackChannelName: input.channelName,
        slackMessageTs: input.messageTs,
        slackEventId: null,
        senderId: input.salespersonId,
        senderName: input.senderName,
        text: input.text,
        threadTs: null,
        permalink: slackPermalink(input.channel, input.messageTs),
        subtype: null,
        botId: null,
        eventReceivedAt: new Date().toISOString(),
        sourceMetadata: { source: "epik_sale_form" },
      });
      if (!inserted.ok || inserted.duplicate) return;
      await repo.reclaimStuck(STUCK_PROCESSING_MS);
      await processStoredMessage(repo, inserted.message.id, { monitoredChannelId: input.monitoredChannelId });
    } catch (error) {
      log("error", "sale_form_store_failed", { message: error instanceof Error ? error.message : "unknown" });
    }
  });
}

type Signed = { token: string; channelId: string | null; channelName: string | null };

/** The short website form: post the sale text, then save it so the website order is credited to this CDE. */
async function webSale(payload: Submission, signed: Signed): Promise<Response> {
  const salespersonId = payload.user?.id ?? "";
  const read = readWebSaleSubmission(payload.view?.state?.values, salespersonId);
  if (!read.ok) return Response.json({ response_action: "errors", errors: read.errors });
  const channel = channelFromMetadata(payload.view?.private_metadata ?? "", signed.channelId);
  if (!channel) return Response.json({ response_action: "errors", errors: { customer: "The sales channel is not set." } });
  const store = await opsStore();
  const product = store ? await store.getProduct(read.sale.sku).catch(() => null) : null;
  const sale = { ...read.sale, productName: product?.name ?? read.sale.productName, listMinor: product?.listPriceMinor ?? null };
  const text = formatWebSale(sale);
  const posted = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${signed.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ channel, text }),
    signal: AbortSignal.timeout(8000),
  });
  const body = (await posted.json()) as { ok?: boolean; error?: string; ts?: string };
  if (!body.ok || !body.ts) {
    return Response.json({ response_action: "errors", errors: { customer: "Slack did not accept the sale. Try again." } });
  }
  const messageTs = body.ts;
  if (store) {
    later([async () => {
      const saved = await recordWebSale(store, {
        customerName: sale.customer, phone: sale.phone, sku: sale.sku, productName: sale.productName, poc: sale.poc, saleSource: sale.saleSource,
        notes: sale.notes || null, slackChannelId: channel, slackMessageTs: messageTs, createdBy: salespersonId,
      });
      const slack = webSlackClient(signed.token);
      const note = saved.ok
        ? "Saved. When the customer orders on the website with this phone number, the order is credited to you here."
        : `Not saved: ${saved.error}`;
      await slack.postMessage({ channel, thread_ts: messageTs, text: note });
    }], "web_sale_save_failed");
  }
  storeLegacyText({ text, channel, channelName: channel === signed.channelId ? signed.channelName : null, messageTs, teamId: payload.team?.id ?? null, salespersonId, senderName: sale.poc, monitoredChannelId: signed.channelId });
  return new Response(null, { status: 200 });
}

import "server-only";

import { saleModelFromEnv } from "@/lib/ai/sale-model";
import { getLiveRepository } from "@/lib/db/supabase-repository";
import { getOpsStore } from "@/lib/ops";
import { log } from "@/lib/log";
import { isTestName, isTestSaleText } from "@/lib/ops/test-mode";
import type { OrderDetail, Product } from "@/lib/ops/types";
import { processStoredMessage } from "@/lib/process-message";
import { syncOrderToSalesSheet } from "@/lib/sheets/sales-sheet-run";
import { shopifyThreadNote } from "@/lib/shopify/drafts";
import { autoShopifyForSale, syncShopify } from "@/lib/shopify/run";
import { handleAiSaleMessage, type AiSaleDeps, type AiSaleMessage, type AiSaleOutcome } from "@/lib/slack/ai-sale";
import { appBaseUrlFromEnv, refreshCardWithNote, teamChannelsFromEnv, warmProductCatalogue, type OpsDeps } from "@/lib/slack/ops-actions";
import { slackDisplayName } from "@/lib/slack/profiles";
import { webSlackClient } from "@/lib/slack/slack-client";
import { slackPermalink } from "@/lib/slack/schema";
import { STUCK_PROCESSING_MS } from "@/lib/types";

// What happens after a Slack sale becomes an order, the same for the long form and the AI sale reader.

/** Test note or Shopify order (#PIK on the card), then the SMB sheet, then a Shopify check for website orders. */
export async function finishSlackSaleOrder(deps: OpsDeps, order: OrderDetail): Promise<void> {
  if (isTestName(order.customerName)) {
    await refreshCardWithNote(deps, order.id, "Test order: no Shopify order made, and it is not counted anywhere. Settings → Clear test orders removes it.");
  } else {
    const shopify = await autoShopifyForSale(deps.store, order.id);
    if (shopify) await refreshCardWithNote(deps, order.id, shopifyThreadNote(shopify));
  }
  await syncOrderToSalesSheet(deps.store, order.id);
  // Every sale also checks Shopify (at most every 5 minutes): website orders and #PIK links come in
  // even when nobody has the dashboard open.
  await syncShopify(deps.store);
}

export type LegacySaleText = {
  text: string;
  channel: string;
  channelName: string | null;
  messageTs: string;
  teamId: string | null;
  salespersonId: string;
  senderName: string;
  monitoredChannelId: string | null;
  source?: string;
};

/** The old dashboard reads every sale text in the channel: store and process it exactly as before. */
export async function storeLegacySaleText(input: LegacySaleText): Promise<void> {
  // Test sales stay out of Sales Records, so they never reach the POC page or incentives.
  if (isTestSaleText(input.text)) return;
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
      sourceMetadata: { source: input.source ?? "epik_sale_form" },
    });
    if (!inserted.ok || inserted.duplicate) return;
    await repo.reclaimStuck(STUCK_PROCESSING_MS);
    await processStoredMessage(repo, inserted.message.id, { monitoredChannelId: input.monitoredChannelId });
  } catch (error) {
    log("error", "sale_form_store_failed", { message: error instanceof Error ? error.message : "unknown" });
  }
}

// ── The AI sale reader, wired to the live store, Slack and the AI ────────────

/** On when SLACK_AI_SALES=on and an AI key is set. Off by default, so nothing changes until it is switched on. */
export function aiSalesSwitch(): "on" | "off" | "no_key" {
  if ((process.env.SLACK_AI_SALES ?? "").trim().toLowerCase() !== "on") return "off";
  return saleModelFromEnv() ? "on" : "no_key";
}

/** The reader's deps, or null when it is off. */
export async function aiSaleDeps(token: string, monitoredChannelId: string | null, channelName: string | null): Promise<AiSaleDeps | null> {
  const model = aiSalesSwitch() === "on" ? saleModelFromEnv() : null;
  if (!model) return null;
  const store = await getOpsStore();
  if (!store) return null;
  const ops: OpsDeps = { store, slack: webSlackClient(token), appBaseUrl: appBaseUrlFromEnv(process.env), teamChannels: teamChannelsFromEnv(process.env) };
  return {
    ops,
    model,
    now: () => new Date(),
    catalogue: () => warmProductCatalogue(store).catch(() => [] as Product[]),
    searchAll: (q) => store.searchProducts(q, 10),
    displayName: (id) => slackDisplayName(token, id),
    async afterOrder(order, info) {
      await Promise.all([
        finishSlackSaleOrder(ops, order),
        storeLegacySaleText({
          text: info.text,
          channel: info.channel,
          channelName: info.channel === monitoredChannelId ? channelName : null,
          messageTs: info.ts,
          teamId: null,
          salespersonId: info.posterId,
          senderName: info.sale.fields.poc,
          monitoredChannelId,
          source: "epik_ai_sale",
        }),
      ]);
    },
  };
}

/** The handler the Slack events route passes on, or undefined when the reader is off. */
export async function aiSaleHandler(token: string | null, monitoredChannelId: string | null, channelName: string | null): Promise<((message: AiSaleMessage) => Promise<AiSaleOutcome>) | undefined> {
  if (!token || aiSalesSwitch() !== "on") return undefined;
  return async (message) => {
    const deps = await aiSaleDeps(token, monitoredChannelId, channelName);
    return deps ? handleAiSaleMessage(deps, message) : "not_sale";
  };
}

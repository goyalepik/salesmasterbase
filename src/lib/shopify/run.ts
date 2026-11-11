import "server-only";

import { readEnv } from "@/lib/env";
import { log } from "@/lib/log";
import { webSlackClient } from "@/lib/slack/slack-client";
import type { OpsStore } from "@/lib/ops/store";
import type { CatalogResult } from "@/lib/ops/types";
import { catalogItems, fetchShopifyVariants } from "./catalog";
import { shopifyConfigFromEnv, shopifyGraphql, type SlackSalesMode } from "./client";
import { linkCompletedDrafts, pushOrderToShopify, SHOPIFY_ACTOR, type DraftOutcome } from "./drafts";
import { fetchRecentOrders, importShopifyOrders, practiceOrderNode } from "./orders";
import { pushPaymentState } from "./payments";
import { PAYMENT_STATE_LABELS, paymentState } from "@/lib/ops/payment-status";
import { recordShopifyEvent } from "@/lib/ops/service";
import { isTestName } from "@/lib/ops/test-mode";
import { isoDateInIst } from "@/lib/format";

export function shopifyStatus(): { connected: boolean; slackSales: SlackSalesMode; domain: string | null } {
  const cfg = shopifyConfigFromEnv();
  return { connected: Boolean(cfg), slackSales: cfg?.slackSales ?? "off", domain: cfg?.domain ?? null };
}

/**
 * After a CDE's Slack sale becomes an order: send it to Shopify as SHOPIFY_SLACK_SALES says (a real order with
 * payment pending, or a draft). Null when switched off. Never throws.
 */
export async function autoShopifyForSale(store: OpsStore, orderId: string): Promise<DraftOutcome | null> {
  const cfg = shopifyConfigFromEnv();
  if (!cfg || cfg.slackSales === "off") return null;
  try {
    const outcome = await pushOrderToShopify(store, shopifyGraphql(cfg), orderId, cfg.slackSales);
    log(outcome.ok ? "info" : "error", "shopify_auto_sale", { orderId, message: outcome.message });
    return outcome;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    log("error", "shopify_auto_sale_failed", { orderId, message });
    return { ok: false, message };
  }
}

/** Tells the CDE's website-sale thread in Slack that the website order arrived and is credited to them. Never throws. */
async function noteWebSaleMatches(matches: Array<{ orderId: string; shopifyName: string; poc: string; slackChannelId: string | null; slackMessageTs: string | null }>) {
  const token = readEnv().slackBotToken;
  if (!token || !matches.length) return;
  const slack = webSlackClient(token);
  for (const m of matches) {
    if (!m.slackChannelId || !m.slackMessageTs) continue;
    const posted = await slack.postMessage({ channel: m.slackChannelId, thread_ts: m.slackMessageTs, text: `Website order ${m.shopifyName} arrived. It is ${m.orderId} on the dashboard, credited to ${m.poc}.` }).catch(() => ({ ok: false }));
    if (!posted.ok) log("error", "web_sale_note_failed", { orderId: m.orderId });
  }
}

export type CatalogOutcome = (CatalogResult & { ran: true; total: number }) | { ran: false; error?: string };

/**
 * Copies the Shopify catalogue into the product list the Slack form searches. Runs at most once every 6 hours
 * across all servers unless `force`. Never throws.
 */
export async function refreshShopifyCatalog(store: OpsStore, force = false, now = new Date()): Promise<CatalogOutcome> {
  const cfg = shopifyConfigFromEnv();
  if (!cfg) return { ran: false };
  const key = `shopify-catalog:${Math.floor(now.getTime() / 21_600_000)}`;
  if (!(await store.claimAction(key)) && !force) return { ran: false };
  try {
    const items = catalogItems(await fetchShopifyVariants(shopifyGraphql(cfg)));
    // An empty answer would unmark every product: treat it as a failure instead.
    if (items.length < 50) throw new Error(`Shopify returned only ${items.length} products.`);
    const result = await store.applyShopifyCatalog(items);
    log("info", "shopify_catalog_refreshed", { total: items.length, ...result });
    return { ran: true, total: items.length, ...result };
  } catch (error) {
    // The claim is kept: the next automatic try is in 6 hours ("Check Shopify now" tries again at once).
    const message = error instanceof Error ? error.message : "unknown";
    log("error", "shopify_catalog_failed", { message });
    return { ran: false, error: message };
  }
}

export type SyncOutcome = { ran: boolean; created: string[]; linked: string[]; flagged: string[]; cancelled?: number; paymentUpdated?: number; matched?: number; error?: string };

/**
 * One Shopify pass: links #PIK numbers of completed drafts, and (when SHOPIFY_IMPORT_FROM is set) brings in
 * new website orders. Runs at most once every 5 minutes across all servers unless `force`. Never throws.
 */
export async function syncShopify(store: OpsStore, force = false, now = new Date()): Promise<SyncOutcome> {
  const cfg = shopifyConfigFromEnv();
  const none: SyncOutcome = { ran: false, created: [], linked: [], flagged: [] };
  if (!cfg) return none;
  if (!force && !(await store.claimAction(`shopify-sync:${Math.floor(now.getTime() / 300_000)}`))) return none;
  try {
    // The product list for the Slack form first (at most every 6 hours), so a long import can never hold it up.
    // "Check Shopify now" (force) refreshes it separately, after answering.
    if (!force) await refreshShopifyCatalog(store, false, now);
    const gql = shopifyGraphql(cfg);
    const drafts = await linkCompletedDrafts(store, gql, now);
    const out: SyncOutcome = { ran: true, created: [], linked: drafts.linked, flagged: [] };
    if (cfg.importFrom) {
      // Look back 10 days for changes (so a quiet weekend with nobody on the dashboard misses nothing),
      // but never before the start date.
      const start = new Date(`${cfg.importFrom}T00:00:00+05:30`).getTime();
      const since = new Date(Math.max(start, now.getTime() - 10 * 86_400_000)).toISOString();
      const imported = await importShopifyOrders(store, await fetchRecentOrders(gql, since), { importFrom: cfg.importFrom, maxNew: 15 });
      out.created = imported.created;
      out.linked.push(...imported.linked);
      out.flagged = imported.flagged;
      out.cancelled = imported.cancelled.length;
      out.paymentUpdated = imported.paymentUpdated.length;
      out.matched = imported.matched.length;
      await noteWebSaleMatches(imported.matched);
    }
    if (out.created.length || out.linked.length || out.flagged.length) log("info", "shopify_synced", { created: out.created.length, linked: out.linked.length, flagged: out.flagged.length });
    // "Shopify checked 3 min ago" on RevOps reads these marks.
    await store.claimAction(`shopify-sync-ok:${now.toISOString()}`).catch(() => false);
    return out;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    log("error", "shopify_sync_failed", { message });
    await store.claimAction(`shopify-sync-error:${now.toISOString()}`).catch(() => false);
    return { ...none, ran: true, error: message };
  }
}

/**
 * Settings → Practice website order: what happens when a customer orders on the website, without a real order.
 * Runs the real import and CDE matching (with the Slack thread note) on a #TEST order that exists only here.
 */
export async function practiceWebsiteOrder(
  store: OpsStore,
  input: { phone: string; sku: string | null; productName: string; priceMinor: number },
  now = new Date(),
): Promise<{ ok: true; orderId: string; practiceName: string; creditedTo: string | null } | { ok: false; error: string }> {
  const phone = input.phone.replace(/\D/g, "").slice(-10);
  if (!/^[6-9]\d{9}$/.test(phone)) return { ok: false, error: "Enter the 10 digit phone used on the website form." };
  if (input.productName.trim().length < 2) return { ok: false, error: "Enter a product." };
  if (!Number.isFinite(input.priceMinor) || input.priceMinor <= 0) return { ok: false, error: "Enter a price." };
  const node = practiceOrderNode(phone, { sku: input.sku, name: input.productName.trim(), priceMinor: input.priceMinor }, now);
  const result = await importShopifyOrders(store, [node], { importFrom: isoDateInIst(now) });
  const order = await store.findOrderByShopify(node.name);
  if (!order) return { ok: false, error: "The practice order could not be made. Try again." };
  await noteWebSaleMatches(result.matched);
  return { ok: true, orderId: order.id, practiceName: node.name, creditedTo: result.matched[0]?.poc ?? null };
}

/**
 * After a payment change on an order EPIK made in Shopify (#PIK from Slack): make Shopify say the same
 * (Paid → marked paid; Partially paid → tag). Only with SHOPIFY_PAYMENT_SYNC=on. Never throws; never touches
 * website orders or test orders. Posts a one-line note in the order's Slack thread when Shopify changed.
 */
export async function syncShopifyPayment(store: OpsStore, orderId: string): Promise<void> {
  const cfg = shopifyConfigFromEnv();
  if (!cfg?.paymentSync) return;
  try {
    const order = await store.getOrder(orderId);
    if (!order?.shopifyOrderId || order.createdBy === "Shopify" || order.stage === "cancelled" || isTestName(order.customerName)) return;
    const state = paymentState(order);
    const label = PAYMENT_STATE_LABELS[state];
    const last = [...order.events].reverse().find((e) => e.type === "shopify_payment");
    if (last ? last.summary.endsWith(`shows ${label}.`) : state === "pending") return;
    const pushed = await pushPaymentState(shopifyGraphql(cfg), order.shopifyOrderId, state);
    await recordShopifyEvent(store, orderId, pushed.ok ? "shopify_payment" : "shopify_error", pushed.message, SHOPIFY_ACTOR);
    const token = readEnv().slackBotToken;
    if (pushed.ok && pushed.changed && token && order.slackChannelId && order.slackMessageTs) {
      await webSlackClient(token).postMessage({ channel: order.slackChannelId, thread_ts: order.slackMessageTs, text: pushed.message }).catch(() => null);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    log("error", "shopify_payment_sync_failed", { orderId, message });
    await recordShopifyEvent(store, orderId, "shopify_error", `Shopify payment status not updated: ${message.slice(0, 200)}`, SHOPIFY_ACTOR).catch(() => null);
  }
}

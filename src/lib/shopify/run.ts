import "server-only";

import { readEnv } from "@/lib/env";
import { log } from "@/lib/log";
import { webSlackClient } from "@/lib/slack/slack-client";
import type { OpsStore } from "@/lib/ops/store";
import type { CatalogResult } from "@/lib/ops/types";
import { catalogItems, fetchShopifyVariants } from "./catalog";
import { shopifyConfigFromEnv, shopifyGraphql, type SlackSalesMode } from "./client";
import { linkCompletedDrafts, pushOrderToShopify, type DraftOutcome } from "./drafts";
import { fetchRecentOrders, importShopifyOrders } from "./orders";

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

export type SyncOutcome = { ran: boolean; created: string[]; linked: string[]; flagged: string[]; matched?: number; error?: string };

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
      out.matched = imported.matched.length;
      await noteWebSaleMatches(imported.matched);
    }
    if (out.created.length || out.linked.length || out.flagged.length) log("info", "shopify_synced", { created: out.created.length, linked: out.linked.length, flagged: out.flagged.length });
    return out;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    log("error", "shopify_sync_failed", { message });
    return { ...none, ran: true, error: message };
  }
}

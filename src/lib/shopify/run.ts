import "server-only";

import { log } from "@/lib/log";
import type { OpsStore } from "@/lib/ops/store";
import { shopifyConfigFromEnv, shopifyGraphql } from "./client";
import { createShopifyDraft, linkCompletedDrafts } from "./drafts";
import { fetchRecentOrders, importShopifyOrders } from "./orders";

export function shopifyStatus(): { connected: boolean; autoDrafts: boolean; domain: string | null } {
  const cfg = shopifyConfigFromEnv();
  return { connected: Boolean(cfg), autoDrafts: Boolean(cfg?.autoDrafts), domain: cfg?.domain ?? null };
}

/** After a CDE's Slack sale becomes an order: make its Shopify draft, if the switch is on. Never throws. */
export async function autoShopifyDraft(store: OpsStore, orderId: string): Promise<void> {
  const cfg = shopifyConfigFromEnv();
  if (!cfg?.autoDrafts) return;
  try {
    const outcome = await createShopifyDraft(store, shopifyGraphql(cfg), orderId);
    log(outcome.ok ? "info" : "error", "shopify_auto_draft", { orderId, message: outcome.message });
  } catch (error) {
    log("error", "shopify_auto_draft_failed", { orderId, message: error instanceof Error ? error.message : "unknown" });
  }
}

export type SyncOutcome = { ran: boolean; created: string[]; linked: string[]; flagged: string[]; error?: string };

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
    const gql = shopifyGraphql(cfg);
    const drafts = await linkCompletedDrafts(store, gql, now);
    const out: SyncOutcome = { ran: true, created: [], linked: drafts.linked, flagged: [] };
    if (cfg.importFrom) {
      // Look back 3 days for changes, but never before the start date.
      const start = new Date(`${cfg.importFrom}T00:00:00+05:30`).getTime();
      const since = new Date(Math.max(start, now.getTime() - 3 * 86_400_000)).toISOString();
      const imported = await importShopifyOrders(store, await fetchRecentOrders(gql, since), { importFrom: cfg.importFrom });
      out.created = imported.created;
      out.linked.push(...imported.linked);
      out.flagged = imported.flagged;
    }
    if (out.created.length || out.linked.length || out.flagged.length) log("info", "shopify_synced", { created: out.created.length, linked: out.linked.length, flagged: out.flagged.length });
    return out;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    log("error", "shopify_sync_failed", { message });
    return { ...none, ran: true, error: message };
  }
}

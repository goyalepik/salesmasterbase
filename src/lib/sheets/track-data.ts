import "server-only";

import { matchPocNames } from "@/lib/ai/track-ai";
import { getOpsStore } from "@/lib/ops";
import { statusFromIso } from "@/lib/ops/delivery-status";
import { followSheetStatus } from "@/lib/ops/service";
import type { OpsStore } from "@/lib/ops/store";
import type { OrderSummary } from "@/lib/ops/types";
import { boardOrders } from "@/lib/ops-ui/delivery-board";
import { mergeOrders, pocKey, WEBSITE_POC, type TrackOrder } from "@/lib/sheets/smb-orders";
import { loadSmbOrders, type SmbLoad } from "@/lib/sheets/smb-source";

// What the CD tracking page shows: the app's orders (Shopify and Slack) with the live status from the Sales
// Masterbase, plus SMB orders the app doesn't have. Each order once, each person once.

export type TrackData = {
  orders: TrackOrder[];
  /** pocKey → pocKey for spellings OpenAI matched to a Sales Masterbase name. */
  aliases: Record<string, string>;
  smb: SmbLoad;
  /** When the data was put together (ms). */
  at: number;
};

async function appOrders(store: OpsStore | null): Promise<OrderSummary[]> {
  if (!store) return [];
  try {
    const from = statusFromIso();
    const { items } = await store.listOrders({ stage: "all", from, limit: 5000 });
    return boardOrders(items, from);
  } catch {
    return [];
  }
}

export async function loadTrackData(): Promise<TrackData> {
  const [store, smb] = await Promise.all([getOpsStore(), loadSmbOrders()]);
  const app = await appOrders(store);
  const orders = mergeOrders(smb.ok ? smb.orders : [], app);
  // Names: the SMB's people are the list. App spellings that match none are matched by OpenAI (saved, asked once).
  const known = new Map<string, string>();
  const unknown = new Map<string, string>();
  for (const o of orders) {
    const key = pocKey(o.poc);
    if (!key || key === WEBSITE_POC) continue;
    if (o.source !== "app") known.set(key, o.poc!);
  }
  for (const o of orders) {
    const key = pocKey(o.poc);
    if (key && key !== WEBSITE_POC && o.source === "app" && !known.has(key)) unknown.set(key, o.poc!);
  }
  const aliases = smb.ok && unknown.size
    ? await matchPocNames([...known].map(([key, name]) => ({ key, name })), [...unknown].map(([key, name]) => ({ key, name })))
    : {};
  return { orders, aliases, smb, at: smb.ok ? smb.at : Date.now() };
}

/**
 * Copy the Sales Masterbase status onto the app's orders. Runs after page visits (Logistics, Sales, the CD and
 * salespeople's pages), at most once every 2 minutes across all servers.
 */
export async function followSmb(now = new Date()): Promise<void> {
  try {
    const store = await getOpsStore();
    if (!store) return;
    if (!(await store.claimAction(`smb-follow:${Math.floor(now.getTime() / 120_000)}`))) return;
    const smb = await loadSmbOrders();
    if (!smb.ok) return;
    await followSheetStatus(store, smb.orders, statusFromIso(), now);
  } catch (error) {
    console.error(JSON.stringify({ level: "error", event: "smb_follow_failed", message: error instanceof Error ? error.message : String(error) }));
  }
}

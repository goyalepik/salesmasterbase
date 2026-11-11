import "server-only";

import type { OpsStore } from "@/lib/ops/store";
import { sheetSyncConfigFromEnv } from "./sheet-sync";
import { sheetUrl } from "./live-stock";

export type SheetStatus = { connected: boolean; url: string | null; from: string | null; lastOk: string | null; lastError: string | null };

/** For the Inventory view: is the team sheet linked, and when did it last check in. */
export async function sheetSyncStatus(store: OpsStore): Promise<SheetStatus> {
  const cfg = sheetSyncConfigFromEnv();
  if (!cfg) return { connected: false, url: null, from: null, lastOk: null, lastError: null };
  const [lastOk, lastError] = await (async () => Promise.all([store.lastClaimAt("sheet-sync-ok:"), store.lastClaimAt("sheet-sync-error:")]))().catch(() => [null, null]);
  return { connected: true, url: cfg.sheetId ? sheetUrl(cfg.sheetId) : null, from: cfg.from, lastOk, lastError };
}

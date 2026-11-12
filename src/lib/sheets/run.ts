import "server-only";

import { log } from "@/lib/log";
import { applySheetRows, type SheetApplyResult } from "@/lib/ops/service";
import type { OpsStore } from "@/lib/ops/store";
import { readPullMark, readSheet, sheetSyncConfigFromEnv, stockCheck, type SheetCheck } from "./sheet-sync";

const SHEET_ACTOR = { name: "Team sheet", slackUserId: null };

export type PullOutcome =
  | { ran: false; reason: "off" | "throttled" }
  | { ran: true; ok: true; rows: number; total: number; applied: SheetApplyResult; check: SheetCheck[] }
  | { ran: true; ok: false; error: string };

/**
 * Reads the team sheet and applies new rows (dated on or after SHEET_SYNC_FROM) to the stock ledger.
 * Without `force`, at most once every 5 minutes across all servers. Safe to repeat: each row is applied once.
 * Never throws.
 */
export async function pullTeamSheet(store: OpsStore, opts: { force?: boolean; now?: Date } = {}): Promise<PullOutcome> {
  const cfg = sheetSyncConfigFromEnv();
  if (!cfg) return { ran: false, reason: "off" };
  const now = opts.now ?? new Date();
  if (!opts.force && !(await store.claimAction(`sheet-pull:${Math.floor(now.getTime() / 300_000)}`).catch(() => false))) return { ran: false, reason: "throttled" };
  try {
    const response = await fetch(cfg.csvUrl, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(25_000) });
    const text = await response.text();
    if (!response.ok || /^\s*<!doctype html|<html/i.test(text.slice(0, 200))) {
      throw new Error(response.ok ? "Google asked for a sign-in: the sheet is not readable by link any more." : `Google answered ${response.status}.`);
    }
    const sheet = readSheet(text, cfg.from);
    const [levels, done] = await Promise.all([store.stockLevels({ only: "all", limit: 10_000 }), store.claimsWithPrefix("sheet:")]);
    const applied = await applySheetRows(store, sheet.rows, cfg.from, SHEET_ACTOR, { known: new Set(levels.map((l) => l.sku)), done });
    const after = applied.inward || applied.dispatched || applied.returned ? await store.stockLevels({ only: "all", limit: 10_000 }) : levels;
    const mark = `sheet-pull-ok:${now.toISOString()}|in${applied.inward}|out${applied.dispatched}|rtv${applied.returned}|p${applied.problems.length}|rows${sheet.total}`;
    await store.claimAction(mark).catch(() => false);
    if (applied.inward || applied.dispatched || applied.returned) log("info", "sheet_pull_applied", { inward: applied.inward, dispatched: applied.dispatched, returned: applied.returned });
    return { ran: true, ok: true, rows: sheet.rows.length, total: sheet.total, applied, check: stockCheck(after, sheet.counts) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    log("error", "sheet_pull_failed", { message });
    await store.claimAction(`sheet-pull-error:${now.toISOString()}`).catch(() => false);
    return { ran: true, ok: false, error: message };
  }
}

export type SheetStatus = {
  on: boolean;
  from: string | null;
  sheetUrl: string | null;
  feedReady: boolean;
  last: ReturnType<typeof readPullMark>;
  lastError: string | null;
};

/** For the Inventory screens: is the sync on, and what did the last pull do. */
export async function sheetSyncStatus(store: OpsStore): Promise<SheetStatus> {
  const cfg = sheetSyncConfigFromEnv();
  if (!cfg) return { on: false, from: null, sheetUrl: null, feedReady: false, last: null, lastError: null };
  const [okKey, lastError] = await (async () => Promise.all([store.lastClaimKey("sheet-pull-ok:"), store.lastClaimAt("sheet-pull-error:")]))().catch(() => [null, null] as const);
  return { on: true, from: cfg.from, sheetUrl: cfg.sheetUrl, feedReady: !!cfg.feedKey, last: readPullMark(okKey), lastError };
}

import "server-only";

import { log } from "@/lib/log";
import { statusFromIso } from "@/lib/ops/delivery-status";
import type { OpsStore } from "@/lib/ops/store";
import { isTestName } from "@/lib/ops/test-mode";
import type { OrderSummary } from "@/lib/ops/types";
import { appsScriptClient, scriptUrlFromEnv } from "./apps-script-sheets";
import { credentialsFromEnv, googleSheetsClient, serviceAccountEmail } from "./google-sheets";
import { writeOrdersToSheet, type WriteResult } from "./sales-sheet";

// Sales → the sales sheet. Connected by the small script inside the sheet (SALES_SHEET_SCRIPT_URL, see
// docs/sales-sheet-apps-script.gs), or by a Google service account (SALES_SHEET_ID + GOOGLE_SERVICE_ACCOUNT_JSON).
// Off until one of them is set, so nothing changes for anyone before the sheet is connected. Each change writes its order at once; a sweep every few minutes (page
// visits and the 10-minute cron) catches anything a write missed (Google down, a Slack button). Never throws.

export type SalesSheetConfig =
  | { via: "script"; scriptUrl: string; tab: string | null; sheetUrl: string | null }
  | { via: "service_account"; spreadsheetId: string; tab: string | null; sheetUrl: string };

export function salesSheetConfig(env: Record<string, string | undefined> = process.env): SalesSheetConfig | null {
  const raw = env.SALES_SHEET_ID?.trim() ?? "";
  const spreadsheetId = /\/d\/([\w-]{20,})/.exec(raw)?.[1] ?? (/^[\w-]{20,}$/.test(raw) ? raw : null);
  const sheetUrl = spreadsheetId ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` : null;
  const tab = env.SALES_SHEET_TAB?.trim() || null;
  const scriptUrl = scriptUrlFromEnv(env);
  if (scriptUrl) return { via: "script", scriptUrl, tab, sheetUrl };
  if (spreadsheetId && sheetUrl && credentialsFromEnv(env)) return { via: "service_account", spreadsheetId, tab, sheetUrl };
  return null;
}

/** Orders that belong in the sheet: made on or after the start day, and not TEST orders. */
export function belongsInSheet(order: Pick<OrderSummary, "createdAt" | "customerName">, fromIso = statusFromIso()): boolean {
  return order.createdAt >= fromIso && !isTestName(order.customerName);
}

async function write(store: OpsStore, orders: OrderSummary[]): Promise<WriteResult | null> {
  const cfg = salesSheetConfig();
  if (!cfg) return null;
  if (cfg.via === "script") {
    const client = appsScriptClient(cfg.scriptUrl);
    const tab = cfg.tab ?? (await client.info()).tab;
    return writeOrdersToSheet(store, client, tab, orders);
  }
  const creds = credentialsFromEnv();
  if (!creds) return null;
  const client = googleSheetsClient(creds, cfg.spreadsheetId);
  const tab = cfg.tab ?? (await client.firstTab());
  return writeOrdersToSheet(store, client, tab, orders);
}

async function noteError(store: OpsStore, error: unknown, where: string): Promise<string> {
  const message = (error instanceof Error ? error.message : "unknown").replace(/[|\n]/g, " ").slice(0, 180);
  log("error", "sales_sheet_failed", { where, message });
  await store.claimAction(`sales-sheet-error:${new Date().toISOString()}|${message}`).catch(() => false);
  return message;
}

/** Writes one order to the sheet now (after a sale or a status change). */
export async function syncOrderToSalesSheet(store: OpsStore, orderId: string): Promise<void> {
  if (!salesSheetConfig()) return;
  try {
    const order = await store.getOrder(orderId);
    if (!order || !belongsInSheet(order)) return;
    const result = await write(store, [order]);
    if (result) await store.claimAction(`sales-sheet-ok:${new Date().toISOString()}|a${result.added}|u${result.updated}|${orderId}`).catch(() => false);
  } catch (error) {
    await noteError(store, error, orderId);
  }
}

export type SweepOutcome =
  | { ran: false; reason: "off" | "throttled" }
  | { ran: true; ok: true; orders: number; added: number; updated: number; addedColumns: string[]; unknownColumns: string[]; matched: string[] }
  | { ran: true; ok: false; error: string };

/**
 * Puts every order changed since the last sweep (all orders since the start day with `force`) in the sheet.
 * Without `force`, at most once every 2 minutes across all servers.
 */
export async function sweepSalesSheet(store: OpsStore, opts: { force?: boolean; now?: Date } = {}): Promise<SweepOutcome> {
  if (!salesSheetConfig()) return { ran: false, reason: "off" };
  const now = opts.now ?? new Date();
  if (!opts.force && !(await store.claimAction(`sales-sheet-sweep-lock:${Math.floor(now.getTime() / 120_000)}`).catch(() => false))) return { ran: false, reason: "throttled" };
  try {
    const from = statusFromIso();
    const last = opts.force ? null : await store.lastClaimAt("sales-sheet-sweep:").catch(() => null);
    // Ten minutes of overlap: a change saved while the last sweep was running is not missed.
    const since = last ? new Date(Date.parse(last) - 600_000).toISOString() : from;
    const { items } = await store.listOrders({ stage: "all", from, limit: 5000 });
    const orders = items.filter((o) => belongsInSheet(o, from) && (o.updatedAt >= since || o.createdAt >= since));
    const result = orders.length ? await write(store, orders) : null;
    await store.claimAction(`sales-sheet-sweep:${now.toISOString()}|o${orders.length}|a${result?.added ?? 0}|u${result?.updated ?? 0}`).catch(() => false);
    return {
      ran: true,
      ok: true,
      orders: orders.length,
      added: result?.added ?? 0,
      updated: result?.updated ?? 0,
      addedColumns: result?.addedColumns ?? [],
      unknownColumns: result?.layout.unknown ?? [],
      matched: result?.layout.columns.map((c) => c.header) ?? [],
    };
  } catch (error) {
    return { ran: true, ok: false, error: await noteError(store, error, "sweep") };
  }
}

export type SalesSheetStatus = {
  on: boolean;
  sheetUrl: string | null;
  robotEmail: string | null;
  needs: string[];
  lastOkAt: string | null;
  lastError: { at: string; message: string } | null;
};

/** For the Order status page and the System page: is the sheet connected, and did the last write work. */
export async function salesSheetStatus(store: OpsStore, env: Record<string, string | undefined> = process.env): Promise<SalesSheetStatus> {
  const cfg = salesSheetConfig(env);
  const needs: string[] = cfg ? [] : ["SALES_SHEET_SCRIPT_URL"];
  const [okA, okB, errKey] = cfg
    ? await Promise.all([store.lastClaimAt("sales-sheet-ok:"), store.lastClaimAt("sales-sheet-sweep:"), store.lastClaimKey("sales-sheet-error:")]).catch(() => [null, null, null] as const)
    : [null, null, null];
  const lastOkAt = [okA, okB].filter((x): x is string => !!x).sort().pop() ?? null;
  const err = errKey ? /^sales-sheet-error:([^|]+)\|(.*)$/.exec(errKey) : null;
  const lastError = err && (!lastOkAt || err[1] > lastOkAt) ? { at: err[1], message: err[2] } : null;
  return { on: !!cfg, sheetUrl: cfg?.sheetUrl ?? null, robotEmail: cfg?.via === "service_account" ? serviceAccountEmail(env) : null, needs, lastOkAt, lastError };
}

// The two-way link between the app and the team's sheet (a copy of Inventory Masterbase, owned by EPIK).
// A small Apps Script inside that sheet calls /api/sheet/sync every few minutes:
//   sheet → app: unit rows dated on or after SHEET_SYNC_FROM (new stock, dispatches typed in the sheet, returns to vendor)
//   app → sheet: the live stock tab, the app's own dispatches (to fill those serial rows), stock the app took in,
//                and a check list of SKUs where the sheet and the app disagree.

import { isoDateInIst } from "@/lib/format";
import type { SheetRowInput } from "@/lib/ops/service";
import type { OpsStore } from "@/lib/ops/store";
import type { StockLevel } from "@/lib/ops/types";
import { liveStockRows } from "./live-stock";

export type SheetSyncConfig = { token: string; from: string; sheetId: string | null };

/** On only when SHEET_SYNC_TOKEN (16+ characters) and SHEET_SYNC_FROM (YYYY-MM-DD) are set. */
export function sheetSyncConfigFromEnv(env: Record<string, string | undefined> = process.env): SheetSyncConfig | null {
  const token = env.SHEET_SYNC_TOKEN?.trim() ?? "";
  const from = env.SHEET_SYNC_FROM?.trim() ?? "";
  if (token.length < 16 || !/^\d{4}-\d{2}-\d{2}$/.test(from)) return null;
  const raw = env.INVENTORY_SHEET_ID?.trim() ?? "";
  const sheetId = /\/d\/([\w-]{20,})/.exec(raw)?.[1] ?? (/^[\w-]{20,}$/.test(raw) ? raw : null);
  return { token, from, sheetId };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : typeof v === "number" ? String(v) : "");
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : null;
};

/** Checks what the sheet sent. Anything malformed is dropped, never guessed. Pure: unit-tested. */
export function parseSheetPayload(body: unknown): { rows: SheetRowInput[]; counts: Record<string, number> } {
  const input = (body ?? {}) as { rows?: unknown; counts?: unknown };
  const rows: SheetRowInput[] = [];
  for (const raw of Array.isArray(input.rows) ? input.rows.slice(0, 20_000) : []) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const key = str(r.key, 160);
    const sku = str(r.sku, 60).toLowerCase();
    if (!key || !/^[a-z0-9][a-z0-9-]{1,59}$/.test(sku)) continue;
    const inwardDate = DATE.test(str(r.inwardDate)) ? str(r.inwardDate) : null;
    const dispatchDate = DATE.test(str(r.dispatchDate)) ? str(r.dispatchDate) : null;
    const qty = num(r.qty);
    rows.push({
      key,
      serial: str(r.serial, 80) || null,
      sku,
      productName: str(r.productName, 300) || sku,
      qty: qty != null && Number.isInteger(qty) && qty > 0 ? qty : 1,
      inwardDate,
      vendor: str(r.vendor, 80) || null,
      invoice: str(r.invoice, 60) || null,
      unitCostRupees: num(r.unitCost),
      dispatchDate,
      customer: str(r.customer, 80) || null,
      returnedToVendor: /^y(es)?$/i.test(str(r.returnedToVendor)),
    });
  }
  const counts: Record<string, number> = {};
  if (input.counts && typeof input.counts === "object") {
    for (const [sku, value] of Object.entries(input.counts as Record<string, unknown>).slice(0, 20_000)) {
      const n = num(value);
      if (n != null && /^[a-z0-9][a-z0-9-]{1,59}$/.test(sku.toLowerCase())) counts[sku.toLowerCase()] = (counts[sku.toLowerCase()] ?? 0) + n;
    }
  }
  return { rows, counts };
}

export type SheetDispatch = { serial: string; date: string; customer: string; poc: string; priceRupees: number | null; orderId: string };
export type SheetInward = { id: string; sku: string; product: string; brand: string; qty: number; serial: string; date: string; unitCostRupees: number | null; note: string; by: string };
export type SheetCheck = { sku: string; product: string; app: number; sheet: number };

/** Where the sheet and the app disagree on units in stock, biggest gap first. Pure: unit-tested. */
export function stockCheck(levels: StockLevel[], counts: Record<string, number>): SheetCheck[] {
  const bySku = new Map(levels.map((l) => [l.sku, l]));
  const skus = new Set([...Object.keys(counts), ...levels.filter((l) => l.onHand > 0).map((l) => l.sku)]);
  return [...skus]
    .map((sku) => ({ sku, product: bySku.get(sku)?.name ?? sku, app: Math.max(0, bySku.get(sku)?.onHand ?? 0), sheet: Math.max(0, counts[sku] ?? 0) }))
    .filter((c) => c.app !== c.sheet)
    .sort((a, b) => Math.abs(b.app - b.sheet) - Math.abs(a.app - a.sheet) || a.sku.localeCompare(b.sku))
    .slice(0, 500);
}

/** What the app sends back to the sheet after applying its rows. */
export async function sheetReply(store: OpsStore, from: string, counts: Record<string, number>, now = new Date()) {
  const fromIso = new Date(`${from}T00:00:00+05:30`).toISOString();
  const [levels, moves] = await Promise.all([
    store.stockLevels({ only: "all", limit: 10_000 }),
    store.movementsSince(fromIso, ["dispatch", "inward", "return"], 5000),
  ]);
  const orders = new Map<string, Awaited<ReturnType<OpsStore["getOrder"]>>>();
  const dispatches: SheetDispatch[] = [];
  for (const m of moves) {
    if (m.kind !== "dispatch" || m.refType !== "order" || !m.serialNo || !m.refId) continue;
    if (!orders.has(m.refId)) orders.set(m.refId, await store.getOrder(m.refId));
    const order = orders.get(m.refId);
    if (!order) continue;
    const line = order.lines.find((l) => l.serialNo === m.serialNo) ?? order.lines.find((l) => l.sku === m.sku);
    dispatches.push({
      serial: m.serialNo,
      date: isoDateInIst(new Date(m.createdAt)),
      customer: order.customerName,
      poc: order.poc ?? "",
      priceRupees: line ? Math.round(line.offeredPriceMinor / Math.max(1, line.qty)) / 100 : null,
      orderId: order.id,
    });
  }
  const names = new Map(levels.map((l) => [l.sku, l]));
  const inwards: SheetInward[] = moves
    .filter((m) => (m.kind === "inward" || m.kind === "return") && m.refType !== "sheet")
    .map((m) => ({
      id: m.id,
      sku: m.sku,
      product: names.get(m.sku)?.name ?? m.sku,
      brand: names.get(m.sku)?.brand ?? "",
      qty: m.qty,
      serial: m.serialNo ?? "",
      date: isoDateInIst(new Date(m.createdAt)),
      unitCostRupees: m.unitCostMinor != null ? m.unitCostMinor / 100 : null,
      note: m.note ?? "",
      by: m.actor,
    }));
  return { liveStock: liveStockRows(levels, now), dispatches, inwards, check: stockCheck(levels, counts) };
}

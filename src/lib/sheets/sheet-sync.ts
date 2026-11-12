// Team sheet → app. The app reads Inventory Masterbase (the team's sheet, one row per unit) as CSV every few
// minutes. Reading only: no sheet is ever written by the app. Rows dated on or after SHEET_SYNC_FROM become stock
// movements through service.ts (applySheetRows): new stock, dispatches typed in the sheet, returns to vendor.
// App → sheet goes the other way through /api/sheet/live-stock, pulled into a tab by an IMPORTDATA formula.

import type { SheetRowInput } from "@/lib/ops/service";
import type { StockLevel } from "@/lib/ops/types";

/** Inventory Masterbase (Ritika's sheet), tab "Inventory Masterbase". Readable by anyone with the link. */
export const DEFAULT_SOURCE_CSV = "https://docs.google.com/spreadsheets/d/1MqWjG8H1CO-wtA4zg_m5JgVhh2__A4vqG2yaRBzne4M/export?format=csv&gid=1559545069";

export type SheetSyncConfig = { from: string; csvUrl: string; feedKey: string | null; sheetUrl: string | null };

/**
 * On when SHEET_SYNC_FROM (YYYY-MM-DD) is set. INVENTORY_SOURCE_CSV overrides where rows are read from.
 * SHEET_SYNC_TOKEN (16+ characters) is the key for the live stock feed. INVENTORY_SHEET_ID is the sheet to link to.
 */
export function sheetSyncConfigFromEnv(env: Record<string, string | undefined> = process.env): SheetSyncConfig | null {
  const from = env.SHEET_SYNC_FROM?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return null;
  const csvUrl = env.INVENTORY_SOURCE_CSV?.trim() || DEFAULT_SOURCE_CSV;
  if (!/^https:\/\/docs\.google\.com\/spreadsheets\//.test(csvUrl)) return null;
  const token = env.SHEET_SYNC_TOKEN?.trim() ?? "";
  const raw = env.INVENTORY_SHEET_ID?.trim() ?? "";
  const sheetId = /\/d\/([\w-]{20,})/.exec(raw)?.[1] ?? (/^[\w-]{20,}$/.test(raw) ? raw : null);
  return { from, csvUrl, feedKey: token.length >= 16 ? token : null, sheetUrl: sheetId ? `https://docs.google.com/spreadsheets/d/${sheetId}/edit` : null };
}

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const COLS = {
  serial: "Serial No.", sku: "SKU Code", product: "Product Name", brand: "Brand", qty: "Quantity", inward: "Inward Date", vendor: "Vendor",
  invoice: "Invoice no.", cost: "Unit Cost", dispatch: "Dispatch Date", customer: "Customer Name", rtv: "Returned to Vendor (Y/N)",
} as const;

/** 30/10/2026 or 2026-10-30 → 2026-10-30. Anything else → null. */
export function sheetDate(value: string): string | null {
  const s = value.trim();
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (dmy) {
    const [d, m, y] = [Number(dmy[1]), Number(dmy[2]), dmy[3]];
    if (d < 1 || d > 31 || m < 1 || m > 12) return null;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

const sheetNumber = (value: string) => {
  const s = value.replace(/[₹,\s]/g, "");
  const n = Number(s);
  return s !== "" && Number.isFinite(n) ? n : null;
};

const SKU = /^[a-z0-9][a-z0-9-]{1,59}$/;

export type SheetRead = {
  rows: SheetRowInput[];
  /** Units in stock per SKU as the sheet sees it (no dispatch date, not returned to vendor). */
  counts: Record<string, number>;
  /** Unit rows in the sheet. */
  total: number;
};

/**
 * The sheet's unit rows. Only rows dated on or after `from` are returned for syncing; every row counts for the
 * stock check. Keys: the serial number, or SKU + inward date + invoice + how many identical rows came before.
 * Pure: unit-tested.
 */
export function readSheet(csv: string, from: string): SheetRead {
  const table = parseCsv(csv);
  const header = (table[0] ?? []).map((h) => h.trim());
  if (!header.includes(COLS.sku) || !header.includes(COLS.inward)) throw new Error("This is not the Inventory Masterbase tab (no SKU Code / Inward Date columns).");
  const at = Object.fromEntries(Object.entries(COLS).map(([k, name]) => [k, header.indexOf(name)])) as Record<keyof typeof COLS, number>;
  const get = (row: string[], k: keyof typeof COLS) => (at[k] >= 0 ? (row[at[k]] ?? "").trim() : "");
  const seen = new Map<string, number>();
  const rows: SheetRowInput[] = [];
  const counts: Record<string, number> = {};
  let total = 0;
  for (const row of table.slice(1)) {
    const sku = get(row, "sku").toLowerCase();
    if (!SKU.test(sku)) continue;
    total++;
    const serial = get(row, "serial");
    const inwardDate = sheetDate(get(row, "inward"));
    const dispatchDate = sheetDate(get(row, "dispatch"));
    const invoice = get(row, "invoice");
    const qtyRaw = sheetNumber(get(row, "qty"));
    const qty = qtyRaw != null && Number.isInteger(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1;
    const returnedToVendor = /^y(es)?$/i.test(get(row, "rtv"));
    const base = `${sku}|${inwardDate ?? ""}|${invoice}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const key = serial || `${base}|${n}`;
    if (!dispatchDate && !returnedToVendor) counts[sku] = (counts[sku] ?? 0) + qty;
    if (!((inwardDate && inwardDate >= from) || (dispatchDate && dispatchDate >= from))) continue;
    rows.push({
      key: key.slice(0, 160),
      serial: serial || null,
      sku,
      productName: get(row, "product").slice(0, 300) || sku,
      brand: get(row, "brand") || null,
      qty,
      inwardDate,
      vendor: get(row, "vendor") || null,
      invoice: invoice || null,
      unitCostRupees: sheetNumber(get(row, "cost")),
      dispatchDate,
      customer: get(row, "customer") || null,
      returnedToVendor,
    });
  }
  return { rows, counts, total };
}

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

/** "sheet-pull-ok:<time>|in3|out5|rtv0|p2|rows2504" → numbers for the status line. */
export function readPullMark(key: string | null): { at: string; inward: number; dispatched: number; returned: number; problems: number; rows: number } | null {
  if (!key) return null;
  const m = /^sheet-pull-ok:([^|]+)\|in(\d+)\|out(\d+)\|rtv(\d+)\|p(\d+)\|rows(\d+)$/.exec(key);
  return m ? { at: m[1], inward: +m[2], dispatched: +m[3], returned: +m[4], problems: +m[5], rows: +m[6] } : null;
}

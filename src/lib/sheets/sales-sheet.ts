// Writes sales into the sales sheet (salesmasterbase): new rows per sale (one per product), then status, #PIK,
// payment and dates as they change. The sheet keeps its own columns (see sales-sheet-map.ts). The app only ever
// writes; the team's own columns, and anything they typed in a column the app fills once (customer, product…),
// stay as they are. No "server-only" here: tests drive it with a fake sheet. The Google connection is elsewhere.

import type { OpsStore } from "@/lib/ops/store";
import type { OrderSummary } from "@/lib/ops/types";
import { cellValue, columnLetter, findHeaderRow, layoutFor, REQUIRED_HEADERS, rowsFor, type Column, type ProductInfo, type SheetField, type SheetLayout } from "./sales-sheet-map";

export type SheetsClient = {
  /** Values for each range (formatted, as the sheet shows them). */
  batchGet(ranges: string[]): Promise<string[][][]>;
  /** Writes cells as if typed (numbers stay numbers, dates become dates). */
  batchUpdate(data: Array<{ range: string; values: string[][] }>): Promise<void>;
  /** Adds rows under the last row of the sheet. */
  append(range: string, rows: string[][]): Promise<void>;
};

/** Columns that change after the sale: always kept in step with the app (also cleared when the app clears them). */
const FOLLOW_UP = new Set<SheetField>(["shopify", "status", "expected", "driver", "dispatchedOn", "deliveredOn", "updated", "paymentStatus", "amountPaid", "balance"]);
/** Kept as text, so the sheet doesn't turn a phone number into 9.87E+09, drop a leading zero, or read "Nov 2026" as a date. */
const AS_TEXT = new Set<SheetField>(["phone", "pincode", "gst", "sku", "orderId", "shopify", "month"]);

/** How many rows from the top are searched for the heading row. */
const HEADER_SCAN = 5;

const quote = (tab: string) => `'${tab.replace(/'/g, "''")}'`;

/** What to type into the cell. A leading = + - @ in free text is never run as a formula. */
export function typed(field: SheetField, value: string): string {
  if (!value) return "";
  if (AS_TEXT.has(field) || /^[=+\-@]/.test(value)) return `'${value}`;
  return value;
}

export type WriteResult = { added: number; updated: number; cells: number; skipped: number; addedColumns: string[]; headerRow: number; layout: SheetLayout };

async function productInfo(store: OpsStore, orders: OrderSummary[]): Promise<Map<string, ProductInfo>> {
  const skus = [...new Set(orders.flatMap((o) => o.lines.map((l) => l.sku)).filter((s): s is string => !!s))];
  const found = await Promise.all(skus.map(async (sku) => [sku, await store.getProduct(sku).catch(() => null)] as const));
  return new Map(found.map(([sku, p]) => [sku, { brand: p?.brand ?? null, category: p?.category ?? null }]));
}

/**
 * Puts these orders in the sheet. Finds the heading row, adds the Status and EPIK order columns at its end if they
 * are missing, finds each row by the EPIK order column, updates what changed, and appends rows not there yet.
 * A row is appended once, even when two servers write at the same moment (claimAction).
 */
export async function writeOrdersToSheet(store: OpsStore, client: SheetsClient, tab: string, orders: OrderSummary[]): Promise<WriteResult> {
  const t = quote(tab);
  const [top = []] = await client.batchGet([`${t}!1:${HEADER_SCAN}`]);
  const headerIndex = findHeaderRow(top);
  const headerRow = headerIndex + 1; // 1-based sheet row
  const headers = [...(top[headerIndex] ?? [])].map((h) => String(h ?? ""));
  let layout = layoutFor(headers);

  const missing = REQUIRED_HEADERS.filter((r) => !layout.columns.some((c) => c.field === r.field));
  if (missing.length) {
    let last = headers.length - 1;
    while (last >= 0 && !headers[last].trim()) last--;
    const data = missing.map((m, i) => ({ range: `${t}!${columnLetter(last + 1 + i)}${headerRow}`, values: [[m.header]] }));
    await client.batchUpdate(data);
    missing.forEach((m, i) => (headers[last + 1 + i] = m.header));
    layout = layoutFor(headers);
  }

  const key = layout.keyColumn as Column;
  const keyLetter = columnLetter(key.index);
  const [keyCells = []] = await client.batchGet([`${t}!${keyLetter}:${keyLetter}`]);
  const rowOf = new Map<string, number>();
  keyCells.forEach((cells, i) => {
    const value = String(cells?.[0] ?? "").trim();
    if (i >= headerRow && value && !rowOf.has(value)) rowOf.set(value, i + 1);
  });

  const products = await productInfo(store, orders);
  const items = [...orders].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).flatMap((o) => rowsFor(o, layout.perLine));
  const found = items.filter((r) => rowOf.has(r.key));
  const fresh = items.filter((r) => !rowOf.has(r.key));
  const width = Math.max(...layout.columns.map((c) => c.index)) + 1;
  const lastLetter = columnLetter(width - 1);
  const valueOf = (r: (typeof items)[number], column: Column) => cellValue(r.order, column, { line: r.line, first: r.first, perLine: layout.perLine, products });

  // Rows already there: follow-up columns always, the rest only where the sheet cell is empty.
  const updates: Array<{ range: string; values: string[][] }> = [];
  if (found.length) {
    const ranges = found.map((r) => `${t}!A${rowOf.get(r.key)}:${lastLetter}${rowOf.get(r.key)}`);
    const rows: string[][][] = [];
    for (let i = 0; i < ranges.length; i += 100) rows.push(...(await client.batchGet(ranges.slice(i, i + 100))));
    found.forEach((item, i) => {
      const row = rows[i]?.[0] ?? [];
      const sheetRow = rowOf.get(item.key)!;
      for (const column of layout.columns) {
        const want = column.field === "orderId" ? item.key : valueOf(item, column);
        const have = String(row[column.index] ?? "").trim();
        const change = FOLLOW_UP.has(column.field) ? want !== have : !have && !!want;
        if (change) updates.push({ range: `${t}!${columnLetter(column.index)}${sheetRow}`, values: [[typed(column.field, want)]] });
      }
    });
    if (updates.length) await client.batchUpdate(updates);
  }

  // New rows, oldest first.
  const claimed: typeof items = [];
  for (const item of fresh) if (await store.claimAction(`sales-sheet-row:${item.key}`)) claimed.push(item);
  if (claimed.length) {
    const rows = claimed.map((item) => {
      const row = Array.from({ length: width }, () => "");
      for (const column of layout.columns) row[column.index] = typed(column.field, column.field === "orderId" ? item.key : valueOf(item, column));
      return row;
    });
    try {
      await client.append(`${t}!A1`, rows);
    } catch (error) {
      for (const item of claimed) await store.releaseAction(`sales-sheet-row:${item.key}`).catch(() => undefined);
      throw error;
    }
  }
  return {
    added: claimed.length,
    updated: new Set(updates.map((u) => u.range.replace(/^.*![A-Z]+/, ""))).size,
    cells: updates.length,
    skipped: fresh.length - claimed.length,
    addedColumns: missing.map((m) => m.header),
    headerRow,
    layout,
  };
}

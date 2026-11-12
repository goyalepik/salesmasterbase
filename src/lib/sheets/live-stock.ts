// The "EPIK App live stock" tab in the team's sheet: one row per product with stock, allocated or incoming units.
// The sheet pulls it with =IMPORTDATA(".../api/sheet/live-stock?key=…"); the app only builds the rows.
// No customer names or phones are in it.

import type { StockLevel } from "@/lib/ops/types";
import { stockCategory } from "@/lib/ops/stock-category";

export const DEFAULT_TAB = "EPIK App live stock";

export function sheetUrl(sheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
}

const rupees = (minor: number | null) => (minor == null ? "" : Math.round(minor) / 100);

/**
 * What goes into the tab: a title, when it was updated, totals, then one row per product with stock, allocated or
 * incoming units, sorted by category, brand and name. Pure: unit-tested.
 */
export function liveStockRows(levels: StockLevel[], now: Date): Array<Array<string | number>> {
  const rows = levels
    .filter((l) => l.onHand > 0 || l.incoming > 0 || l.reserved > 0)
    .map((l) => ({ l, category: stockCategory(l) }))
    .sort((a, b) => a.category.localeCompare(b.category) || (a.l.brand ?? "").localeCompare(b.l.brand ?? "") || a.l.name.localeCompare(b.l.name));
  const sum = (pick: (l: StockLevel) => number) => rows.reduce((total, r) => total + pick(r.l), 0);
  const value = sum((l) => Math.max(0, l.onHand) * (l.unitCostMinor ?? 0));
  const updated = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }).format(now);
  return [
    ["EPIK App: live stock, pulled from the EPIK app. Do not type in this tab: it refreshes by itself."],
    ["Updated (IST)", updated, "Products", rows.length, "On hand", sum((l) => Math.max(0, l.onHand)), "Free", sum((l) => Math.max(0, l.available)), "Allocated", sum((l) => l.reserved), "Incoming", sum((l) => l.incoming), "Value at cost (₹)", rupees(value)],
    [],
    ["Category", "Brand", "SKU", "Product", "Free", "On hand", "Allocated to orders", "Incoming (open POs)", "Next ETA", "Unit cost (₹)", "Value at cost (₹)"],
    ...rows.map(({ l, category }) => [
      category,
      l.brand ?? "",
      l.sku,
      l.name,
      Math.max(0, l.available),
      l.onHand,
      l.reserved,
      l.incoming,
      l.nextEta ?? "",
      rupees(l.unitCostMinor),
      l.unitCostMinor ? rupees(Math.max(0, l.onHand) * l.unitCostMinor) : "",
    ]),
  ];
}

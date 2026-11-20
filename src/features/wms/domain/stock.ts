// Stock on hand from units, and the numbering of POs and goods receipts. Pure.

import type { WmsUnit } from "./types";
import { isOnHand, SELLABLE } from "./unit";

export type UnitStockRow = {
  sku: string;
  hub: string | null;
  onHand: number;
  available: number;
  onHold: number;
  /** Σ unit cost (incl. GST) of the units on hand that have a cost. */
  valueMinor: number;
  /** Units on hand with no cost recorded (their value is missing from the total). */
  noCost: number;
  oldestReceivedAt: string | null;
};

/** One row per SKU (or per SKU and hub), from the units physically with us. */
export function unitStock(units: WmsUnit[], byHub = false): UnitStockRow[] {
  const rows = new Map<string, UnitStockRow>();
  for (const u of units) {
    if (!isOnHand(u.status)) continue;
    const key = byHub ? `${u.sku}|${u.hub ?? ""}` : u.sku;
    const row = rows.get(key) ?? { sku: u.sku, hub: byHub ? u.hub : null, onHand: 0, available: 0, onHold: 0, valueMinor: 0, noCost: 0, oldestReceivedAt: null };
    row.onHand += 1;
    if (SELLABLE.includes(u.status)) row.available += 1;
    else if (u.status !== "reserved" && u.status !== "picked" && u.status !== "packed") row.onHold += 1;
    if (u.unitCostMinor == null) row.noCost += 1;
    else row.valueMinor += u.unitCostMinor;
    if (!row.oldestReceivedAt || u.receivedAt < row.oldestReceivedAt) row.oldestReceivedAt = u.receivedAt;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.valueMinor - a.valueMinor || a.sku.localeCompare(b.sku));
}

/** Totals across rows. */
export function stockTotals(rows: UnitStockRow[]): { onHand: number; available: number; onHold: number; valueMinor: number; noCost: number } {
  return rows.reduce((t, r) => ({ onHand: t.onHand + r.onHand, available: t.available + r.available, onHold: t.onHold + r.onHold, valueMinor: t.valueMinor + r.valueMinor, noCost: t.noCost + r.noCost }), { onHand: 0, available: 0, onHold: 0, valueMinor: 0, noCost: 0 });
}

/** India's financial year (April to March) as "26-27" for a date in IST. */
export function financialYear(date: Date): string {
  const ist = new Date(date.getTime() + 330 * 60_000);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

/** The next PO number in the team's format, PO-EPIK-26-27-0042, given the numbers already used. */
export function nextPoNumber(used: string[], now: Date): string {
  const prefix = `PO-EPIK-${financialYear(now)}-`;
  let max = 0;
  for (const n of used) {
    if (!n.toUpperCase().startsWith(prefix)) continue;
    const tail = Number(n.slice(prefix.length));
    if (Number.isInteger(tail) && tail > max) max = tail;
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

export function grnNumber(n: number): string {
  return `GRN-${String(n).padStart(5, "0")}`;
}

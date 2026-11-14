// Numbers for the salespeople's page: orders per CDE this month, split by where they are. Pure (tests use it).

import { isoDateInIst } from "@/lib/format";
import { deliveryStatusOf, type DeliveryStatus } from "@/lib/ops/delivery-status";
import type { OrderSummary } from "@/lib/ops/types";

/** Where an order is, in three words a salesperson cares about. Cancelled orders are counted apart. */
export type Progress = "delivered" | "moving" | "waiting";

export const PROGRESS: Array<{ id: Progress; label: string; colour: string }> = [
  { id: "delivered", label: "Delivered", colour: "#1f9d6b" },
  { id: "moving", label: "On the way", colour: "#2f6fe8" },
  { id: "waiting", label: "Not started", colour: "#d9902f" },
];

export function progressOf(status: DeliveryStatus): Progress | null {
  if (status === "delivered") return "delivered";
  if (status === "ready" || status === "out_for_delivery") return "moving";
  if (status === "cancelled") return null;
  return "waiting";
}

/** The 1st of this month, 00:00 IST. */
export function monthStartIso(now: Date): string {
  return `${isoDateInIst(now).slice(0, 7)}-01T00:00:00+05:30`;
}

export function monthLabel(now: Date): string {
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(now);
}

export type Tally = Record<Progress, number> & { cancelled: number; total: number };

const empty = (): Tally => ({ delivered: 0, moving: 0, waiting: 0, cancelled: 0, total: 0 });

function add(tally: Tally, order: OrderSummary) {
  const p = progressOf(deliveryStatusOf(order.stage));
  if (p) {
    tally[p] += 1;
    tally.total += 1;
  } else tally.cancelled += 1;
}

export type CdeRow = { name: string; month: Tally; open: number; allTime: number };

/** The same person however their name was typed ("ibrahim", "Ibrahim "). */
export const pocKey = (name: string | null | undefined) => (name ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * One row per CDE who has an order since the start day: this month's orders by progress (cancelled not in the
 * total), plus open and all-time counts. Busiest this month first, then by name.
 */
export function cdeRows(orders: OrderSummary[], monthStart: string): { rows: CdeRow[]; month: Tally } {
  const byName = new Map<string, CdeRow>();
  const month = empty();
  const start = Date.parse(monthStart);
  for (const order of orders) {
    const inMonth = Date.parse(order.createdAt) >= start;
    if (inMonth) add(month, order);
    const key = pocKey(order.poc);
    if (!key) continue;
    const row = byName.get(key) ?? { name: order.poc!.replace(/\s+/g, " ").trim(), month: empty(), open: 0, allTime: 0 };
    row.allTime += 1;
    const p = progressOf(deliveryStatusOf(order.stage));
    if (p === "waiting" || p === "moving") row.open += 1;
    if (inMonth) add(row.month, order);
    byName.set(key, row);
  }
  const rows = [...byName.values()].sort((a, b) => b.month.total - a.month.total || a.name.localeCompare(b.name));
  return { rows, month };
}

// Replenishment (days of stock and what to reorder), the same logic as the DOH sheet. Pure.

export const REORDER = {
  /** Cover days below this: reorder now. */
  reorderNow: 15,
  /** Cover days below this: reorder soon. */
  approaching: 30,
  /** Cover days above this: overstock. */
  overstock: 90,
  /** Suggested quantity brings cover up to this many days. */
  targetCover: 30,
  /** Sold in 30 days at or above this: fast mover. */
  fastMover: 10,
  /** No sale for this many days with stock: dead stock. */
  deadDays: 90,
} as const;

export type ReorderStatus = "out_of_stock" | "reorder_now" | "approaching" | "healthy" | "overstock" | "non_moving" | "dead";
export const REORDER_LABELS: Record<ReorderStatus, string> = {
  out_of_stock: "Out of stock",
  reorder_now: "Reorder now",
  approaching: "Reorder soon",
  healthy: "Healthy",
  overstock: "Overstock",
  non_moving: "Not moving",
  dead: "Dead stock",
};
export type Movement = "fast" | "slow" | "none";

export type ReorderInput = { warehouse: number; inTransit: number; sold7: number; sold30: number; daysSinceSale: number | null };
export type ReorderOut = {
  total: number;
  avg7: number;
  avg30: number;
  doh7: number | null;
  doh30: number | null;
  cover: number | null;
  movement: Movement;
  status: ReorderStatus;
  suggested: number;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export function reorderRow(i: ReorderInput, r = REORDER): ReorderOut {
  const total = Math.max(0, i.warehouse) + Math.max(0, i.inTransit);
  const avg7 = i.sold7 / 7;
  const avg30 = i.sold30 / 30;
  const doh7 = avg7 > 0 ? round1(Math.max(0, i.warehouse) / avg7) : null;
  const doh30 = avg30 > 0 ? round1(Math.max(0, i.warehouse) / avg30) : null;
  const cover = avg30 > 0 ? round1(total / avg30) : null;
  const movement: Movement = i.sold30 >= r.fastMover ? "fast" : i.sold30 > 0 ? "slow" : "none";
  let status: ReorderStatus;
  if (i.warehouse <= 0 && avg30 > 0) status = "out_of_stock";
  else if (avg30 === 0) status = i.warehouse > 0 && (i.daysSinceSale == null || i.daysSinceSale >= r.deadDays) ? "dead" : i.warehouse > 0 ? "non_moving" : "healthy";
  else if (cover! < r.reorderNow) status = "reorder_now";
  else if (cover! < r.approaching) status = "approaching";
  else if (cover! > r.overstock) status = "overstock";
  else status = "healthy";
  const suggested = avg30 > 0 ? Math.max(0, Math.ceil(r.targetCover * avg30 - total)) : 0;
  return { total, avg7: round1(avg7), avg30: round1(avg30), doh7, doh30, cover, movement, status, suggested };
}

/** Stock age buckets (days since it came in). */
export const AGE_BUCKETS = [
  { label: "0 to 30 days", max: 30 },
  { label: "31 to 60 days", max: 60 },
  { label: "61 to 90 days", max: 90 },
  { label: "91 to 180 days", max: 180 },
  { label: "Over 180 days", max: Infinity },
] as const;

export function ageBucket(days: number): number {
  return AGE_BUCKETS.findIndex((b) => days <= b.max);
}

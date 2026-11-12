// Today's activity: stock in and out over a period, bucketed by IST hour (one day) or IST day (a week). Pure.

import type { StockMovement } from "@/lib/ops/types";

export type ActivityRange = "today" | "yesterday" | "week";

export type Bucket = { key: string; label: string; in: number; out: number };

export type ActivitySummary = {
  buckets: Bucket[];
  unitsIn: number;
  unitsOut: number;
  productsIn: number;
  ordersOut: number;
  incoming: StockMovement[];
  outgoing: StockMovement[];
  byKindIn: Array<[string, number]>;
  byKindOut: Array<[string, number]>;
};

const IST_OFFSET = 5.5 * 60 * 60 * 1000;
const DAY = 86_400_000;

/** IST midnight of the day `now` falls on, as a UTC time. */
export function istMidnight(now: Date): Date {
  const ist = new Date(now.getTime() + IST_OFFSET);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET);
}

/** Start and end (exclusive) of the range, in UTC. */
export function rangeBounds(range: ActivityRange, now: Date): { from: Date; to: Date } {
  const today = istMidnight(now);
  if (range === "yesterday") return { from: new Date(today.getTime() - DAY), to: today };
  if (range === "week") return { from: new Date(today.getTime() - 6 * DAY), to: new Date(today.getTime() + DAY) };
  return { from: today, to: new Date(today.getTime() + DAY) };
}

export const KIND_WORDS: Record<StockMovement["kind"], string> = {
  opening: "Opening",
  inward: "Stock in",
  dispatch: "Shipped",
  return: "Customer return",
  rtv: "Back to vendor",
  adjust: "Correction",
};

/** Where an incoming unit came from, in plain words. */
export function inwardSource(m: StockMovement): string {
  if (m.kind === "return") return "Customer return";
  if (m.kind === "adjust") return "Correction";
  if (m.refType === "po") return "PO received";
  if (m.refType === "procurement") return "Bought for a customer";
  if (m.refType === "sheet") return "From the team sheet";
  return "Stock in";
}

const tally = (list: StockMovement[], word: (m: StockMovement) => string) => {
  const map = new Map<string, number>();
  for (const m of list) map.set(word(m), (map.get(word(m)) ?? 0) + Math.abs(m.qty));
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
};

export function summariseActivity(moves: StockMovement[], range: ActivityRange, now: Date): ActivitySummary {
  const { from, to } = rangeBounds(range, now);
  const inRange = moves.filter((m) => m.kind !== "opening" && m.createdAt >= from.toISOString() && m.createdAt < to.toISOString());
  const buckets: Bucket[] = [];
  const index = (iso: string) => Math.floor((Date.parse(iso) - from.getTime()) / (range === "week" ? DAY : 3_600_000));
  if (range === "week") {
    for (let d = 0; d < 7; d++) {
      const day = new Date(from.getTime() + d * DAY + IST_OFFSET);
      buckets.push({ key: `d${d}`, label: new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", timeZone: "UTC" }).format(day), in: 0, out: 0 });
    }
  } else {
    for (let h = 0; h < 24; h++) buckets.push({ key: `h${h}`, label: h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`, in: 0, out: 0 });
  }
  for (const m of inRange) {
    const b = buckets[index(m.createdAt)];
    if (!b) continue;
    if (m.qty > 0) b.in += m.qty;
    else b.out -= m.qty;
  }
  const incoming = inRange.filter((m) => m.qty > 0).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const outgoing = inRange.filter((m) => m.qty < 0).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    buckets,
    unitsIn: incoming.reduce((s, m) => s + m.qty, 0),
    unitsOut: outgoing.reduce((s, m) => s - m.qty, 0),
    productsIn: new Set(incoming.map((m) => m.sku)).size,
    ordersOut: new Set(outgoing.filter((m) => m.refType === "order" && m.refId).map((m) => m.refId)).size,
    incoming,
    outgoing,
    byKindIn: tally(incoming, inwardSource),
    byKindOut: tally(outgoing, (m) => KIND_WORDS[m.kind]),
  };
}

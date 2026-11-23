// The order's progress on the CD page, like a parcel tracker: Ordered → Confirmed → At the hub → Shipped → Delivered,
// and "See all updates": every change the Sales Masterbase showed (logged by followSheetStatus) and the app's own
// steps, newest first. Pure (no "server-only"): tests use it.

import type { OrderEvent } from "@/lib/ops/types";
import { sheetDateMs, type TrackOrder, type TrackStatus } from "@/lib/sheets/smb-orders";

export type StepState = "done" | "current" | "todo" | "stopped";
export type Step = { id: string; label: string; state: StepState; date: string | null; note: string | null };

/** The last step done for each status (0 Ordered … 4 Delivered). */
const DONE_UPTO: Record<TrackStatus, number> = {
  new: 0, not_confirmed: 0, other: 0, on_hold: 0, cancelled: 0, confirmed: 1, arranging: 1, waiting: 1, hub: 2, on_the_way: 3, brand: 3, delivered: 4,
};

/** What's happening at the step in progress. */
const NOW_NOTE: Partial<Record<TrackStatus, string>> = {
  new: "Waiting for confirmation",
  not_confirmed: "Waiting for confirmation",
  other: "Ask logistics",
  on_hold: "On hold",
  confirmed: "Being packed",
  arranging: "Arranging stock",
  waiting: "Waiting for stock",
  hub: "Goes out next",
  on_the_way: "On the way to the customer",
  brand: "The brand is delivering it",
};

const IST = "Asia/Kolkata";
export const whenText = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: IST, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const dayText = (ms: number) => new Intl.DateTimeFormat("en-IN", { timeZone: IST, weekday: "short", day: "numeric", month: "short" }).format(new Date(ms));
/** "01/11/2026" → "Sun, 1 Nov"; anything else as it is. */
const sheetDay = (v: string | null) => {
  if (!v) return null;
  const ms = sheetDateMs(v);
  return ms == null ? v : dayText(ms);
};

/** When the SMB first showed a code (from the logged updates), as "Tue, 5 Nov". */
function firstSeen(events: OrderEvent[], code: RegExp): string | null {
  const hit = [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).find((e) => e.type === "smb" && code.test(e.summary));
  return hit ? dayText(Date.parse(hit.createdAt)) : null;
}

export function trackSteps(o: TrackOrder, events: OrderEvent[] = []): Step[] {
  const ordered: Step = { id: "ordered", label: "Ordered", state: "done", date: sheetDay(o.date), note: null };
  if (o.status === "cancelled") return [ordered, { id: "cancelled", label: "Cancelled", state: "stopped", date: null, note: null }];
  const steps: Step[] = [
    ordered,
    { id: "confirmed", label: "Confirmed", state: "todo", date: firstSeen(events, /Logistic status (?!NOT)CONFIRMED/), note: null },
    { id: "hub", label: "Packed at the hub", state: "todo", date: firstSeen(events, /Logistic status EPIK_HUB/), note: null },
    { id: "shipped", label: o.status === "brand" ? "Sent by the brand" : "Shipped", state: "todo", date: sheetDay(o.dispatchedOn), note: null },
    { id: "delivered", label: "Delivered", state: "todo", date: sheetDay(o.deliveredOn), note: null },
  ];
  const done = DONE_UPTO[o.status];
  steps.forEach((s, i) => {
    s.state = i <= done ? "done" : i === done + 1 ? "current" : "todo";
    if (s.state !== "done") s.date = null;
  });
  const now = steps[done + 1];
  if (now) now.note = NOW_NOTE[o.status] ?? null;
  return steps;
}

export type Update = { at: string | null; when: string; text: string; by: string };

const HIDDEN = new Set(["shopify_error", "shopify_draft", "claim", "sheet_error"]);

/**
 * Every update, newest first: what the Sales Masterbase showed over time and the app's own steps (sale made, payment,
 * status). An order only in the SMB has no history yet: its dates and latest remark stand in.
 */
export function trackUpdates(o: TrackOrder, events: OrderEvent[] = []): Update[] {
  const out: Update[] = [];
  for (const e of events) {
    if (HIDDEN.has(e.type)) continue;
    // The SMB's own update already says it; the app's copy of the same status adds nothing for a CD.
    if (e.type === "status" && e.actor === "Sales Masterbase") continue;
    const text = e.summary.replace(/\s+/g, " ").trim();
    if (!text) continue;
    out.push({ at: e.createdAt, when: whenText(e.createdAt), text, by: e.actor });
  }
  if (!out.length) {
    const add = (ms: number | null, text: string) => out.push({ at: ms == null ? null : new Date(ms).toISOString(), when: ms == null ? "" : dayText(ms), text, by: "Sales Masterbase" });
    if (o.update) add(null, `Update: ${o.update}`);
    if (o.deliveredOn) add(sheetDateMs(o.deliveredOn), "Delivered.");
    if (o.dispatchedOn) add(sheetDateMs(o.dispatchedOn), "Dispatched.");
    if (o.logisticStatus) add(null, `Logistic status ${o.logisticStatus}${o.deliveryStatus ? `, delivery status: ${o.deliveryStatus}` : ""}.`);
    if (o.date) add(sheetDateMs(o.date), "Order placed.");
    return out;
  }
  // Newest first; the same moment keeps the order they were written in (later first).
  const sorted = out.map((u, i) => ({ u, i })).sort((a, b) => (b.u.at ?? "").localeCompare(a.u.at ?? "") || b.i - a.i).map((x) => x.u);
  // Same words twice in a row (Shopify repeats itself): keep the newest.
  return sorted.filter((u, i) => i === 0 || u.text !== sorted[i - 1].text);
}

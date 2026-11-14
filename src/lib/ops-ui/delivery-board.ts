// The orders on the logistics Order status page and the salespeople's status page: every order since the start day
// (ORDER_STATUS_FROM), not TEST ones. Pure helpers, so both pages filter and count the same way.

import { DELIVERY_STATUSES, deliveryStatusOf, statusChangedAt, type DeliveryStatus } from "@/lib/ops/delivery-status";
import { isTestName } from "@/lib/ops/test-mode";
import type { OrderSummary } from "@/lib/ops/types";

export const OPEN_DELIVERY: DeliveryStatus[] = ["new", "waiting_stock", "ready", "out_for_delivery", "on_hold"];
export const DONE_DELIVERY: DeliveryStatus[] = ["delivered", "cancelled"];

export type BoardView = DeliveryStatus | "open" | "all";

export function readView(raw: string | undefined): BoardView {
  if (raw === "all") return "all";
  return (DELIVERY_STATUSES as readonly string[]).includes(raw ?? "") ? (raw as DeliveryStatus) : "open";
}

export function boardOrders(items: OrderSummary[], fromIso: string): OrderSummary[] {
  return items.filter((o) => o.createdAt >= fromIso && !isTestName(o.customerName));
}

/** Delivered and cancelled orders leave the salespeople's page after this many days. */
export const DONE_DAYS = 30;

export function recentEnough(order: OrderSummary, now: Date, days = DONE_DAYS): boolean {
  if (OPEN_DELIVERY.includes(deliveryStatusOf(order.stage))) return true;
  return Date.parse(statusChangedAt(order)) >= now.getTime() - days * 86_400_000;
}

const digits = (s: string) => s.replace(/\D/g, "");

/** Search by #PIK, EPIK order, phone (any part of it), customer, product, POC or hub. */
export function matchesSearch(order: OrderSummary, raw: string): boolean {
  const q = raw.trim().toLowerCase();
  if (!q) return true;
  const qDigits = digits(q);
  if (qDigits.length >= 4 && digits(order.phone ?? "").includes(qDigits)) return true;
  const pik = q.replace(/^#/, "");
  const hay = [order.id, order.shopifyOrderId ?? "", order.customerName, order.poc ?? "", order.hub ?? "", ...order.lines.map((l) => `${l.productName} ${l.sku ?? ""}`)]
    .join(" ")
    .toLowerCase();
  return hay.includes(q) || (pik.length >= 3 && hay.includes(pik));
}

export function countByStatus(orders: OrderSummary[]): Record<DeliveryStatus, number> & { open: number; all: number } {
  const counts = Object.fromEntries(DELIVERY_STATUSES.map((s) => [s, 0])) as Record<DeliveryStatus, number>;
  for (const o of orders) counts[deliveryStatusOf(o.stage)] += 1;
  const open = OPEN_DELIVERY.reduce((n, s) => n + counts[s], 0);
  return { ...counts, open, all: orders.length };
}

export function inView(order: OrderSummary, view: BoardView): boolean {
  const status = deliveryStatusOf(order.stage);
  if (view === "all") return true;
  if (view === "open") return OPEN_DELIVERY.includes(status);
  return status === view;
}

/** Oldest open orders first (they need logistics most); newest first for delivered and cancelled. */
export function sortForBoard(orders: OrderSummary[], view: BoardView): OrderSummary[] {
  const newestFirst = view === "delivered" || view === "cancelled" || view === "all";
  return [...orders].sort((a, b) => (newestFirst ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt)));
}

export const DELIVERY_TONE: Record<DeliveryStatus, string> = {
  new: "tone-info",
  waiting_stock: "tone-violet",
  ready: "tone-accent",
  out_for_delivery: "tone-teal",
  delivered: "tone-good",
  on_hold: "tone-warn",
  cancelled: "tone-muted",
};

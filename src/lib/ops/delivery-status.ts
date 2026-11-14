// The simple delivery status the logistics person sets (Logistics, Order status), shown to salespeople on the
// no-login status page and copied to the sales sheet. It is the order stage in plain words: one status everywhere.
// Pure (no "server-only"): pages, the sheet writer and tests all read it.

import type { Order, OrderLine, OrderStage } from "@/lib/ops/types";

export const DELIVERY_STATUSES = ["new", "waiting_stock", "ready", "out_for_delivery", "delivered", "on_hold", "cancelled"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const DELIVERY_LABELS: Record<DeliveryStatus, string> = {
  new: "New sale",
  waiting_stock: "Waiting for stock",
  ready: "Ready to dispatch",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  on_hold: "On hold",
  cancelled: "Cancelled",
};

/** The codes the team already uses in its sheets. The dashboard, the SMB sheet and the salespeople's page show these. */
export const DELIVERY_CODES: Record<DeliveryStatus, string> = {
  new: "NEW",
  waiting_stock: "WAITING_STOCK",
  ready: "CONFIRMED",
  out_for_delivery: "EPIK_OFD",
  delivered: "EPIK_DELIVERED",
  on_hold: "ON_HOLD",
  cancelled: "EPIK_CANCELLED",
};

/** What the inventory team picks from, in order. On hold stays readable on older orders but is not offered. */
export const PICKABLE_STATUSES: DeliveryStatus[] = ["new", "waiting_stock", "ready", "out_for_delivery", "delivered", "cancelled"];

/** "CONFIRMED · Ready to dispatch": the code the team knows, with plain words for everyone else. */
export function statusOptionLabel(status: DeliveryStatus): string {
  return `${DELIVERY_CODES[status]} · ${DELIVERY_LABELS[status]}`;
}

/** One line a salesperson can read to the customer. */
export const DELIVERY_MEANING: Record<DeliveryStatus, string> = {
  new: "Order received. Logistics will check stock.",
  waiting_stock: "Waiting for the product to arrive at the warehouse.",
  ready: "In stock and packed. Will go out soon.",
  out_for_delivery: "On the way to the customer.",
  delivered: "Delivered to the customer.",
  on_hold: "Paused. See the note.",
  cancelled: "Order cancelled.",
};

/** Payment review and New both read "New sale": sales go straight to logistics, nobody waits on RevOps. */
export function deliveryStatusOf(stage: OrderStage): DeliveryStatus {
  switch (stage) {
    case "awaiting_payment":
    case "awaiting_inventory":
      return "new";
    case "awaiting_stock":
      return "waiting_stock";
    case "ready_to_dispatch":
      return "ready";
    case "out_for_delivery":
      return "out_for_delivery";
    case "delivered":
      return "delivered";
    case "on_hold":
      return "on_hold";
    case "cancelled":
      return "cancelled";
  }
}

/** The stage a status is stored as. "New sale" keeps Payment review when the order is still there. */
export function stageForStatus(status: DeliveryStatus, current: OrderStage): OrderStage {
  switch (status) {
    case "new":
      return current === "awaiting_payment" ? "awaiting_payment" : "awaiting_inventory";
    case "waiting_stock":
      return "awaiting_stock";
    case "ready":
      return "ready_to_dispatch";
    case "out_for_delivery":
      return "out_for_delivery";
    case "delivered":
      return "delivered";
    case "on_hold":
      return "on_hold";
    case "cancelled":
      return "cancelled";
  }
}

export function isDeliveryStatus(value: unknown): value is DeliveryStatus {
  return typeof value === "string" && (DELIVERY_STATUSES as readonly string[]).includes(value);
}

/**
 * Lines whose stock is booked in the app's own stock ledger (reserved, backordered, procured, dispatched with a
 * serial). Those orders use the full Dispatch buttons, which move stock; the simple status would leave the ledger
 * wrong. Today stock lives in the team sheets, so new orders never have these lines.
 */
export function usesAppStock(lines: Pick<OrderLine, "status">[]): boolean {
  return lines.some((l) => l.status === "reserved" || l.status === "awaiting_po" || l.status === "procuring" || l.status === "dispatched");
}

/**
 * The day this way of working started (IST date, YYYY-MM-DD). Orders made before it stay off the status page,
 * the logistics list and the sheet. Set ORDER_STATUS_FROM to change it.
 */
export const DEFAULT_STATUS_FROM = "2026-11-01";

export function statusFrom(env: Record<string, string | undefined> = process.env): string {
  const raw = env.ORDER_STATUS_FROM?.trim();
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : DEFAULT_STATUS_FROM;
}

/** Start of that IST day, as a UTC ISO time (for "created on or after"). */
export function statusFromIso(env: Record<string, string | undefined> = process.env): string {
  return new Date(`${statusFrom(env)}T00:00:00+05:30`).toISOString();
}

/** Last status change for a list: when the order reached its stage. */
export function statusChangedAt(order: Pick<Order, "stageChangedAt" | "createdAt">): string {
  return order.stageChangedAt || order.createdAt;
}

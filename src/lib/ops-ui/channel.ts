import type { Order } from "@/lib/ops/types";

/** Where an order came from, in the words the team uses. */
export function channelLabel(order: Pick<Order, "source" | "createdBy" | "saleSource">): { label: string; tone: string } {
  if (order.createdBy === "Shopify") return { label: order.saleSource === "Sagepilot" ? "Sagepilot" : "Website", tone: "tone-info" };
  if (order.source === "slack") return { label: "CDE", tone: "tone-good" };
  if (order.source === "desk") return { label: "Dashboard", tone: "tone-muted" };
  return { label: "Sheet", tone: "tone-muted" };
}

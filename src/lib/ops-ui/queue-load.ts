import "server-only";

// The New orders queue, loaded once per request and shared by the Inventory home and the New orders tab.

import { cache } from "react";
import type { QueueOrderView } from "@/components/ops/inventory-queue";
import { paymentState } from "@/lib/ops/payment-status";
import type { OpsStore } from "@/lib/ops/store";
import type { OrderSummary, PurchaseOrder, StockLevel } from "@/lib/ops/types";
import { inr } from "@/lib/ops-ui/format";
import { buildNewOrderQueue } from "@/lib/ops-ui/inventory-queue";

export const loadQueue = cache(async (store: OpsStore) => {
  const waiting = await store.listOrders({ stage: "awaiting_inventory", limit: 200 });
  const skus = [...new Set(waiting.items.flatMap((o) => o.lines.map((l) => l.sku)).filter((s): s is string => !!s))];
  const [levels, poLists] = await Promise.all([
    Promise.all(skus.map((sku) => store.stockFor(sku))),
    Promise.all(skus.map((sku) => store.listPurchaseOrders({ status: "open", sku }))),
  ]);
  const stock: Record<string, StockLevel | null> = Object.fromEntries(skus.map((s, i) => [s, levels[i]]));
  const pos: Record<string, PurchaseOrder[]> = Object.fromEntries(skus.map((s, i) => [s, poLists[i]]));
  return buildNewOrderQueue(waiting.items, stock, pos);
});

/** How the order was paid, as a short chip: Paid, Part paid, or Not paid with what is due on delivery. */
export function payChip(order: OrderSummary): QueueOrderView["pay"] {
  const due = Math.max(0, order.offeredTotalMinor - order.paidMinor);
  switch (paymentState(order)) {
    case "paid":
      return { label: "Paid", tone: "good" };
    case "partially_paid":
      return { label: `Part paid · ${inr(due)} due`, tone: "warn" };
    default:
      return { label: `Not paid · ${inr(due)} on delivery`, tone: "bad" };
  }
}

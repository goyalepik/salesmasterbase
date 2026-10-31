import type { OrderLine, PurchaseOrder, StockLevel } from "@/lib/ops/types";

export type Suggestion = "reserve" | "po" | "procure" | "sku";

/** What inventory should most likely do with this line, from its stock and open POs. */
export function suggestFor(line: OrderLine, stock: StockLevel | null, pos: PurchaseOrder[]): Suggestion {
  if (!line.sku) return "sku";
  if ((stock?.available ?? 0) >= line.qty) return "reserve";
  if (pos.length) return "po";
  return "procure";
}

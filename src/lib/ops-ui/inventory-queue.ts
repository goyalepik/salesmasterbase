// The Inventory screens' working lists, worked out from orders, stock and POs. Pure: unit-tested without a database.

import type { OrderLine, OrderSummary, ProcurementRequest, PurchaseOrder, StockLevel } from "@/lib/ops/types";
import { suggestFor, type Suggestion } from "./suggest";

export type QueueLine = {
  line: OrderLine;
  /** Stock as it is now. */
  stock: StockLevel | null;
  pos: PurchaseOrder[];
  /** The likely move, after older orders in the queue take their share of the free stock. */
  suggestion: Suggestion;
  /** Free units of this SKU that older orders in the queue also want. */
  aheadQty: number;
};

export type QueueGroup = "ready" | "call" | "sku";

export type QueueOrder = {
  order: OrderSummary;
  lines: QueueLine[];
  /** ready: every product can be allocated now. call: something needs a backorder, procure or reject. sku: a product has no SKU. */
  group: QueueGroup;
  /** Products that can be allocated now. */
  allocatable: number;
};

/**
 * New orders, oldest first, each with its products still to decide. Free stock is shared out oldest first,
 * so when two orders want the last unit the older one shows "In stock" and the newer one shows the next best move.
 */
export function buildNewOrderQueue(orders: OrderSummary[], stock: Record<string, StockLevel | null>, pos: Record<string, PurchaseOrder[]>): QueueOrder[] {
  const sorted = [...orders].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const wanted = new Map<string, number>();
  const out: QueueOrder[] = [];
  for (const order of sorted) {
    const lines: QueueLine[] = order.lines
      .filter((l) => l.status === "pending" || l.status === "rejected")
      .map((line) => {
        const level = line.sku ? stock[line.sku] ?? null : null;
        const open = line.sku ? pos[line.sku] ?? [] : [];
        const ahead = line.sku ? wanted.get(line.sku) ?? 0 : 0;
        const left = level ? { ...level, available: Math.max(0, level.available - ahead) } : null;
        if (line.sku && line.status === "pending") wanted.set(line.sku, ahead + line.qty);
        return { line, stock: level, pos: open, suggestion: suggestFor(line, left, open), aheadQty: ahead };
      });
    if (!lines.length) continue;
    const pending = lines.filter((l) => l.line.status === "pending");
    const group: QueueGroup = pending.some((l) => l.suggestion === "sku")
      ? "sku"
      : pending.length && pending.every((l) => l.suggestion === "reserve")
        ? "ready"
        : "call";
    out.push({ order, lines, group, allocatable: pending.filter((l) => l.suggestion === "reserve").length });
  }
  return out;
}

export type WaitingLine = { order: OrderSummary; line: OrderLine; freeNow: boolean };

export type PoGroup = {
  poId: string;
  /** Null when the PO is closed or gone but products still wait on it: they need a new decision. */
  po: PurchaseOrder | null;
  waiting: WaitingLine[];
  waitingQty: number;
  late: boolean;
};

export type BuyingItem = { request: ProcurementRequest; order: OrderSummary | null; line: OrderLine | null; late: boolean; freeNow: boolean };

/**
 * Products waiting for stock: grouped by the brand PO they wait on (late first, then by ETA), and the products being
 * bought for one customer (by ETA). `freeNow` marks a product whose stock has since come in, so it can be allocated now.
 */
export function buildBackorders(
  orders: OrderSummary[],
  openPos: PurchaseOrder[],
  requests: ProcurementRequest[],
  stock: Record<string, StockLevel | null>,
  todayIso: string,
): { onPo: PoGroup[]; buying: BuyingItem[] } {
  const sorted = [...orders].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const poById = new Map(openPos.map((po) => [po.id, po]));
  const free = (line: OrderLine) => !!line.sku && (stock[line.sku]?.available ?? 0) >= line.qty;
  const groups = new Map<string, PoGroup>();
  const lineById = new Map<string, { order: OrderSummary; line: OrderLine }>();
  for (const order of sorted) {
    for (const line of order.lines) {
      lineById.set(line.id, { order, line });
      if (line.status !== "awaiting_po" || !line.poId) continue;
      const po = poById.get(line.poId) ?? null;
      const group = groups.get(line.poId) ?? { poId: line.poId, po, waiting: [], waitingQty: 0, late: !!po?.eta && po.eta < todayIso };
      group.waiting.push({ order, line, freeNow: free(line) });
      group.waitingQty += line.qty;
      groups.set(line.poId, group);
    }
  }
  const onPo = [...groups.values()].sort((a, b) => {
    if (!a.po !== !b.po) return a.po ? 1 : -1; // closed POs with products still waiting: first, they need a decision
    if (a.late !== b.late) return a.late ? -1 : 1;
    return (a.po?.eta ?? "9999").localeCompare(b.po?.eta ?? "9999");
  });
  const buying = requests
    .filter((r) => r.status === "requested" || r.status === "ordered")
    .map((request) => {
      const found = lineById.get(request.lineId) ?? null;
      return { request, order: found?.order ?? null, line: found?.line ?? null, late: !!request.eta && request.eta < todayIso, freeNow: found ? free(found.line) : false };
    })
    .sort((a, b) => Number(b.late) - Number(a.late) || (a.request.eta ?? "9999").localeCompare(b.request.eta ?? "9999"));
  return { onPo, buying };
}

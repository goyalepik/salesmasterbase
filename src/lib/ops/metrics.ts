import { isoDateInIst, istDayBounds } from "@/lib/format";
import { ORDER_STAGES, OPEN_STAGES, type Installation, type OpsMetrics, type OrderStage, type OrderSummary, type ProcurementRequest, type StockLevel } from "@/lib/ops/types";

const DAY = 24 * 60 * 60 * 1000;
export const STUCK_HOURS = { payment: 24, inventory: 24 } as const;

/** Orders, lines and the rest are small enough (hundreds per month) to aggregate in one pass. */
export function computeMetrics(input: {
  now: Date;
  orders: OrderSummary[];
  verifiedTodayMinor: number;
  stock: StockLevel[];
  procurement: ProcurementRequest[];
  installations: Installation[];
  days?: number;
}): OpsMetrics {
  const { now, orders } = input;
  const today = istDayBounds(now);
  const days = input.days ?? 14;
  const pipeline = Object.fromEntries(ORDER_STAGES.map((stage) => [stage, 0])) as Record<OrderStage, number>;
  let pipelineValueMinor = 0;
  let codOutstandingMinor = 0;
  let stuckPayment = 0;
  let stuckInventory = 0;
  const todayStats = { orders: 0, offeredMinor: 0, verifiedMinor: input.verifiedTodayMinor, delivered: 0 };
  const dailyMap = new Map<string, { day: string; orders: number; offeredMinor: number; delivered: number }>();
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = isoDateInIst(new Date(today.start.getTime() - i * DAY));
    dailyMap.set(day, { day, orders: 0, offeredMinor: 0, delivered: 0 });
  }
  const hubs = new Map<string, { hub: string; orders: number; offeredMinor: number }>();
  const pocs = new Map<string, { poc: string; orders: number; offeredMinor: number }>();
  const products = new Map<string, { sku: string | null; name: string; units: number; offeredMinor: number }>();
  const windowStart = today.start.getTime() - (days - 1) * DAY;

  for (const order of orders) {
    pipeline[order.stage] += 1;
    const created = new Date(order.createdAt).getTime();
    const ageHours = (now.getTime() - new Date(order.stageChangedAt ?? order.createdAt).getTime()) / 3_600_000;
    if (OPEN_STAGES.includes(order.stage)) {
      pipelineValueMinor += order.offeredTotalMinor;
      if (order.stage === "awaiting_payment" && ageHours > STUCK_HOURS.payment) stuckPayment += 1;
      if (order.stage === "awaiting_inventory" && ageHours > STUCK_HOURS.inventory) stuckInventory += 1;
    }
    if (order.stage !== "cancelled" && order.codDueMinor > 0 && order.stage !== "delivered") codOutstandingMinor += order.codDueMinor;
    if (order.stage === "cancelled") continue;
    if (created >= today.start.getTime() && created < today.end.getTime()) {
      todayStats.orders += 1;
      todayStats.offeredMinor += order.offeredTotalMinor;
    }
    if (order.deliveredAt) {
      const deliveredAt = new Date(order.deliveredAt).getTime();
      if (deliveredAt >= today.start.getTime() && deliveredAt < today.end.getTime()) todayStats.delivered += 1;
      const dayKey = isoDateInIst(new Date(order.deliveredAt));
      const bucket = dailyMap.get(dayKey);
      if (bucket) bucket.delivered += 1;
    }
    if (created < windowStart) continue;
    const bucket = dailyMap.get(isoDateInIst(new Date(order.createdAt)));
    if (bucket) {
      bucket.orders += 1;
      bucket.offeredMinor += order.offeredTotalMinor;
    }
    const hub = order.hub ?? "No hub";
    const h = hubs.get(hub) ?? { hub, orders: 0, offeredMinor: 0 };
    h.orders += 1;
    h.offeredMinor += order.offeredTotalMinor;
    hubs.set(hub, h);
    const poc = order.poc ?? "No POC";
    const p = pocs.get(poc) ?? { poc, orders: 0, offeredMinor: 0 };
    p.orders += 1;
    p.offeredMinor += order.offeredTotalMinor;
    pocs.set(poc, p);
    for (const line of order.lines) {
      const key = line.sku ?? line.productName.toLowerCase();
      const item = products.get(key) ?? { sku: line.sku, name: line.productName, units: 0, offeredMinor: 0 };
      item.units += line.qty;
      item.offeredMinor += line.offeredPriceMinor;
      products.set(key, item);
    }
  }

  const todayIso = isoDateInIst(now);
  const lateProcurement = input.procurement.filter((r) => (r.status === "requested" || r.status === "ordered") && r.eta && r.eta < todayIso).length;
  const lateInstallations = input.installations.filter((i) => i.status === "pending" && i.dueDate < todayIso).length;
  const stock = input.stock.reduce(
    (acc, row) => {
      if (row.onHand > 0) acc.skus += 1;
      acc.units += Math.max(0, row.onHand);
      acc.reserved += row.reserved;
      acc.incoming += row.incoming;
      acc.valueMinor += Math.max(0, row.onHand) * (row.unitCostMinor ?? 0);
      return acc;
    },
    { skus: 0, units: 0, reserved: 0, incoming: 0, valueMinor: 0 },
  );

  const byValue = <T extends { offeredMinor: number }>(a: T, b: T) => b.offeredMinor - a.offeredMinor;
  return {
    today: todayStats,
    pipeline,
    pipelineValueMinor,
    overdue: { stuckPayment, stuckInventory, lateProcurement, lateInstallations },
    codOutstandingMinor,
    stock,
    daily: [...dailyMap.values()],
    byHub: [...hubs.values()].sort(byValue),
    byPoc: [...pocs.values()].sort(byValue).slice(0, 12),
    topProducts: [...products.values()].sort(byValue).slice(0, 10),
  };
}

import type { OrderSummary, ProcurementRequest, PurchaseOrder, StockLevel } from "@/lib/ops/types";

export type Insight = { tone: "bad" | "warn" | "info" | "good"; title: string; detail: string; href?: string };

export type InsightInput = {
  stock: StockLevel[];
  /** Orders waiting on inventory or on stock to arrive. */
  waiting: OrderSummary[];
  /** Orders sold in the last 30 days, for what is moving and what is not. */
  recent: OrderSummary[];
  pos: PurchaseOrder[];
  procurement: ProcurementRequest[];
  todayIso: string;
};

function rupees(minor: number): string {
  const r = minor / 100;
  if (r >= 1e7) return `₹${(r / 1e7).toFixed(2)} Cr`;
  if (r >= 1e5) return `₹${(r / 1e5).toFixed(1)} L`;
  return `₹${Math.round(r).toLocaleString("en-IN")}`;
}

function clip(text: string, max = 46): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * Plain checks over stock, orders and POs that a stock manager would otherwise do by hand in the sheet.
 * Worst first. Pure: no I/O, so it is cheap to run on every page load and easy to test.
 */
export function inventoryInsights(input: InsightInput): Insight[] {
  const out: Insight[] = [];
  const bySku = new Map(input.stock.map((row) => [row.sku, row]));

  // 1. Paid orders asking for more than is free.
  const demand = new Map<string, { name: string; qty: number }>();
  for (const order of input.waiting) {
    for (const line of order.lines) {
      if (!line.sku || (line.status !== "pending" && line.status !== "rejected")) continue;
      const row = demand.get(line.sku) ?? { name: line.productName, qty: 0 };
      row.qty += line.qty;
      demand.set(line.sku, row);
    }
  }
  const short = [...demand.entries()]
    .map(([sku, d]) => ({ sku, name: d.name, gap: d.qty - (bySku.get(sku)?.available ?? 0), incoming: bySku.get(sku)?.incoming ?? 0 }))
    .filter((d) => d.gap > 0)
    .sort((a, b) => b.gap - a.gap);
  if (short.length) {
    const units = short.reduce((sum, d) => sum + d.gap, 0);
    const top = short[0]!;
    out.push({
      tone: "bad",
      title: `${units} ${units === 1 ? "unit" : "units"} short for paid orders`,
      detail: `${short.length} ${short.length === 1 ? "product" : "products"} sold without free stock. Biggest gap: ${clip(top.name)} (${top.gap} short${top.incoming ? `, ${top.incoming} incoming` : ", nothing incoming"}). Procure or hold on a PO.`,
      href: "/inventory/decisions?show=procure",
    });
  }

  // 2. Late brand POs and late customer procurement.
  const latePos = input.pos.filter((po) => po.status === "open" && po.eta && po.eta < input.todayIso);
  const lateProc = input.procurement.filter((p) => (p.status === "requested" || p.status === "ordered") && p.eta && p.eta < input.todayIso);
  if (latePos.length || lateProc.length) {
    const vendors = new Map<string, number>();
    for (const po of latePos) if (po.vendor) vendors.set(po.vendor, (vendors.get(po.vendor) ?? 0) + 1);
    const worst = [...vendors.entries()].sort((a, b) => b[1] - a[1])[0];
    const parts = [latePos.length ? `${latePos.length} PO ${latePos.length === 1 ? "line" : "lines"}` : "", lateProc.length ? `${lateProc.length} customer ${lateProc.length === 1 ? "purchase" : "purchases"}` : ""].filter(Boolean);
    out.push({
      tone: "warn",
      title: `${parts.join(" and ")} past the expected date`,
      detail: worst ? `Most late: ${clip(worst[0], 30)} (${worst[1]}). Call the vendor and update the date.` : "Call the vendor and update the date.",
      href: "/procurement",
    });
  }

  // 3. Fast movers about to run out.
  const sold = new Map<string, number>();
  for (const order of input.recent) {
    if (order.stage === "cancelled") continue;
    for (const line of order.lines) if (line.sku) sold.set(line.sku, (sold.get(line.sku) ?? 0) + line.qty);
  }
  const low = input.stock
    .filter((row) => (sold.get(row.sku) ?? 0) >= 2 && row.available <= Math.max(1, Math.ceil((sold.get(row.sku) ?? 0) / 4)) && row.incoming === 0)
    .sort((a, b) => (sold.get(b.sku) ?? 0) - (sold.get(a.sku) ?? 0));
  if (low.length) {
    const top = low[0]!;
    out.push({
      tone: "warn",
      title: `${low.length} fast ${low.length === 1 ? "seller" : "sellers"} running low`,
      detail: `${clip(top.name)}: ${top.available} free, ${sold.get(top.sku)} sold in 30 days, nothing on order. Raise a PO.`,
      href: `/inventory?q=${encodeURIComponent(top.sku)}#stock`,
    });
  }

  // 4. Money sitting on the shelf.
  const idle = input.stock
    .filter((row) => row.onHand > 0 && row.reserved === 0 && !sold.has(row.sku) && row.unitCostMinor)
    .map((row) => ({ row, value: row.onHand * (row.unitCostMinor ?? 0) }))
    .sort((a, b) => b.value - a.value);
  const idleValue = idle.reduce((sum, i) => sum + i.value, 0);
  if (idle.length && idleValue > 0) {
    const top = idle[0]!;
    out.push({
      tone: "info",
      title: `${rupees(idleValue)} in stock with no sale in 30 days`,
      detail: `${idle.length} products. Largest: ${clip(top.row.name)} (${top.row.onHand} units, ${rupees(top.value)}). Push it to sales or offer a deal.`,
      href: "/inventory?only=available#stock",
    });
  }

  // 5. Where the money is.
  const brands = new Map<string, number>();
  let total = 0;
  for (const row of input.stock) {
    const value = Math.max(0, row.onHand) * (row.unitCostMinor ?? 0);
    total += value;
    if (value > 0) brands.set(row.brand ?? "Other", (brands.get(row.brand ?? "Other") ?? 0) + value);
  }
  const topBrands = [...brands.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (topBrands.length && total > 0) {
    out.push({
      tone: "info",
      title: `${topBrands.map(([b]) => b).join(", ")} hold ${Math.round((topBrands.reduce((s, [, v]) => s + v, 0) / total) * 100)}% of stock value`,
      detail: topBrands.map(([b, v]) => `${b} ${rupees(v)}`).join(" · "),
    });
  }

  if (!out.length) out.push({ tone: "good", title: "Nothing needs attention", detail: "Every paid order has stock, and no PO is late." });
  return out;
}

import type { OpsStore } from "@/lib/ops/store";
import type { Installation, OrderLine, OrderStage, Product } from "@/lib/ops/types";

/**
 * A normalised copy of the company Google Sheets, produced by `scripts/import-sheets.ts`.
 * It contains customer names, phones and costs, so the file stays out of git (`data/*.local.json`).
 */
export type OpsSeed = {
  generatedAt: string;
  source: string;
  products: Product[];
  stock: Array<{ sku: string; units: number; unitCostMinor: number | null }>;
  purchaseOrders: Array<{ poNumber: string; vendor: string | null; sku: string; productName: string | null; qtyOrdered: number; qtyReceived: number; eta: string | null; createdAt: string | null }>;
  orders: SeedOrder[];
  installations: Array<{ shopifyOrderId: string; sku: string | null; status: Installation["status"]; dueDate: string; doneAt: string | null; technician: string | null }>;
};

export type SeedOrder = {
  key: string;
  shopifyOrderId: string | null;
  createdAt: string;
  customerName: string;
  phone: string | null;
  address: string | null;
  hub: string | null;
  poc: string | null;
  stage: OrderStage;
  deliveredAt: string | null;
  paidMinor: number;
  codDueMinor: number;
  declaredPaymentStatus: string | null;
  declaredPaymentMode: string | null;
  holdReason: string | null;
  cancelReason: string | null;
  notes: string | null;
  lines: Array<{ sku: string | null; productName: string; offeredPriceMinor: number; serialNo: string | null; status: OrderLine["status"] }>;
};

export type LoadReport = { products: number; stockRows: number; purchaseOrders: number; orders: number; skippedOrders: number; reservedLines: number; unreservedLines: number; installations: number };

/** Loads a seed into any store. Safe to run again: existing Shopify orders and stock are left alone. */
export async function loadSeed(store: OpsStore, seed: OpsSeed, options: { onProgress?: (message: string) => void } = {}): Promise<LoadReport> {
  const report: LoadReport = { products: 0, stockRows: 0, purchaseOrders: 0, orders: 0, skippedOrders: 0, reservedLines: 0, unreservedLines: 0, installations: 0 };
  const say = options.onProgress ?? (() => {});
  const actor = "Sheet import";

  await store.upsertProducts(seed.products);
  report.products = seed.products.length;
  say(`${report.products} products`);

  if (!(await store.hasMovements())) {
    const opening = seed.stock.filter((row) => row.units > 0).map((row) => ({ sku: row.sku, qty: row.units, kind: "opening" as const, refType: "sheet", refId: "Current Stock", serialNo: null, unitCostMinor: row.unitCostMinor, note: "Opening stock from Inventory Tracker", actor, createdAt: seed.generatedAt }));
    await store.addMovements(opening);
    report.stockRows = opening.length;
  }
  say(`${report.stockRows} opening stock rows`);

  for (const po of seed.purchaseOrders) {
    if (po.qtyOrdered <= 0) continue;
    await store.upsertPurchaseOrder({ poNumber: po.poNumber, vendor: po.vendor, sku: po.sku, productName: po.productName, qtyOrdered: po.qtyOrdered, qtyReceived: Math.min(po.qtyReceived, po.qtyOrdered), eta: po.eta, status: po.qtyReceived >= po.qtyOrdered ? "closed" : "open", createdAt: po.createdAt ?? undefined });
    report.purchaseOrders += 1;
  }
  say(`${report.purchaseOrders} purchase order lines`);

  const existing = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const page = await store.listOrders({ stage: "all", limit: 1000, offset });
    for (const order of page.items) if (order.shopifyOrderId) existing.add(order.shopifyOrderId);
    if (page.items.length < 1000) break;
  }

  const byShopify = new Map<string, string>();
  const sorted = [...seed.orders].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const [index, input] of sorted.entries()) {
    if (input.shopifyOrderId && existing.has(input.shopifyOrderId)) {
      report.skippedOrders += 1;
      continue;
    }
    const order = await store.insertOrder({
      source: "import",
      stage: input.stage,
      createdAt: input.createdAt,
      customerName: input.customerName,
      phone: input.phone,
      shippingAddress: input.address,
      hub: input.hub,
      poc: input.poc,
      shopifyOrderId: input.shopifyOrderId,
      declaredPaymentStatus: input.declaredPaymentStatus,
      declaredPaymentMode: input.declaredPaymentMode,
      notes: input.notes,
      lines: input.lines.map((l) => ({ sku: l.sku, productName: l.productName, listPriceMinor: null, offeredPriceMinor: l.offeredPriceMinor })),
    });
    await store.updateOrder(order.id, {
      paidMinor: input.paidMinor,
      codDueMinor: input.codDueMinor,
      deliveredAt: input.deliveredAt,
      dispatchedAt: input.stage === "out_for_delivery" || input.stage === "delivered" ? input.deliveredAt ?? input.createdAt : null,
      holdReason: input.holdReason,
      cancelReason: input.cancelReason,
    });
    for (const [i, line] of order.lines.entries()) {
      const wanted = input.lines[i]?.status ?? "pending";
      if (wanted === "reserved") {
        const result = await store.reserveLine(line.id);
        if (result === "ok") report.reservedLines += 1;
        else {
          report.unreservedLines += 1;
          await store.updateLine(line.id, { status: "pending" });
        }
      } else {
        await store.updateLine(line.id, { status: wanted, serialNo: input.lines[i]?.serialNo ?? null });
      }
    }
    if (report.unreservedLines && input.stage === "ready_to_dispatch") {
      const fresh = await store.getOrder(order.id);
      if (fresh?.lines.some((l) => l.status === "pending")) await store.updateOrder(order.id, { stage: "awaiting_inventory" });
    }
    await store.appendEvent({ orderId: order.id, lineId: null, type: "imported", actor, summary: `Imported from the Google Sheets${input.shopifyOrderId ? ` (${input.shopifyOrderId})` : ""}.` });
    if (input.shopifyOrderId) byShopify.set(input.shopifyOrderId, order.id);
    report.orders += 1;
    if (index % 200 === 0) say(`${report.orders} orders…`);
  }
  say(`${report.orders} orders (${report.skippedOrders} already present)`);

  for (const item of seed.installations) {
    const orderId = byShopify.get(item.shopifyOrderId);
    if (!orderId) continue;
    const order = await store.getOrder(orderId);
    if (!order || order.installations.length) continue;
    const line = order.lines.find((l) => item.sku && l.sku === item.sku) ?? order.lines[0];
    if (!line) continue;
    await store.insertInstallation({ orderId, lineId: line.id, sku: line.sku, productName: line.productName, customerName: order.customerName, phone: order.phone, address: order.shippingAddress, status: item.status, dueDate: item.dueDate, doneAt: item.doneAt, technician: item.technician, note: "Imported from Installation Tracker" });
    report.installations += 1;
  }
  say(`${report.installations} installations`);
  return report;
}

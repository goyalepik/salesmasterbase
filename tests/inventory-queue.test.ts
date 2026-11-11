import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBackorders, buildNewOrderQueue } from "../src/lib/ops-ui/inventory-queue";
import { modeFromGateway, shopifyPaymentHint } from "../src/lib/ops/payment-status";
import type { OrderLine, OrderSummary, PurchaseOrder, StockLevel } from "../src/lib/ops/types";

function line(id: string, orderId: string, sku: string | null, patch: Partial<OrderLine> = {}): OrderLine {
  return { id, orderId, lineNo: 1, sku, productName: sku ?? "Typed product", qty: 1, listPriceMinor: null, offeredPriceMinor: 100_00, accessories: null, extendedWarranty: null, installation: null, status: "pending", poId: null, procurementId: null, serialNo: null, rejectReason: null, ...patch };
}

function order(id: string, createdAt: string, lines: OrderLine[], stage: OrderSummary["stage"] = "awaiting_inventory"): OrderSummary {
  return {
    id, createdAt, updatedAt: createdAt, source: "desk", stage, stageChangedAt: createdAt, customerName: `Customer ${id}`, phone: null, email: null, shippingAddress: null, pincode: null,
    billingAddress: null, gst: null, hub: "Hebbal", cxType: null, poc: "Asha", saleSource: null, saleType: null, declaredPaymentStatus: null, declaredPaymentMode: null, notes: null,
    shopifyOrderId: null, slackChannelId: null, slackMessageTs: null, createdBy: null, offeredTotalMinor: 100_00, paidMinor: 100_00, codDueMinor: 0, driver: null,
    expectedDeliveryDate: null, dispatchedAt: null, deliveredAt: null, holdReason: null, cancelReason: null, lines,
  };
}

function level(sku: string, available: number, incoming = 0): StockLevel {
  return { sku, name: sku, brand: null, category: null, channel: null, onHand: available, reserved: 0, available, incoming, nextEta: null, unitCostMinor: null };
}

const po: PurchaseOrder = { id: "po1", poNumber: "PO-1", vendor: "Dreame", sku: "b", productName: "B", qtyOrdered: 5, qtyReceived: 0, eta: "2026-11-05", status: "open", createdAt: "2026-10-01T00:00:00Z" };

test("new orders: the older order gets the last unit, the newer one is told why not", () => {
  const orders = [
    order("EPK-2", "2026-11-02T00:00:00Z", [line("l2", "EPK-2", "a")]),
    order("EPK-1", "2026-11-01T00:00:00Z", [line("l1", "EPK-1", "a")]),
  ];
  const queue = buildNewOrderQueue(orders, { a: level("a", 1) }, {});
  assert.deepEqual(queue.map((q) => q.order.id), ["EPK-1", "EPK-2"]);
  assert.equal(queue[0].group, "ready");
  assert.equal(queue[1].group, "call");
  assert.equal(queue[1].lines[0].suggestion, "procure");
  assert.equal(queue[1].lines[0].aheadQty, 1);
});

test("new orders: grouped as ready, needs a call, or no SKU", () => {
  const queue = buildNewOrderQueue(
    [
      order("EPK-1", "2026-11-01T00:00:00Z", [line("l1", "EPK-1", "a"), line("l2", "EPK-1", "b")]),
      order("EPK-2", "2026-11-02T00:00:00Z", [line("l3", "EPK-2", null)]),
      order("EPK-3", "2026-11-03T00:00:00Z", [line("l4", "EPK-3", "a"), line("l5", "EPK-3", "a", { status: "reserved" })]),
    ],
    { a: level("a", 5), b: level("b", 0, 5) },
    { b: [po] },
  );
  assert.deepEqual(queue.map((q) => [q.order.id, q.group, q.allocatable]), [["EPK-1", "call", 1], ["EPK-2", "sku", 0], ["EPK-3", "ready", 1]]);
  assert.equal(queue[0].lines[1].suggestion, "po");
  assert.equal(queue[2].lines.length, 1, "already allocated products are not shown again");
});

test("backorders: grouped by PO, closed POs first, and free stock is flagged", () => {
  const waiting = [
    order("EPK-1", "2026-11-01T00:00:00Z", [line("l1", "EPK-1", "b", { status: "awaiting_po", poId: "po1" })], "awaiting_stock"),
    order("EPK-2", "2026-11-02T00:00:00Z", [line("l2", "EPK-2", "b", { status: "awaiting_po", poId: "po1" })], "awaiting_stock"),
    order("EPK-3", "2026-11-03T00:00:00Z", [line("l3", "EPK-3", "c", { status: "awaiting_po", poId: "gone" })], "awaiting_stock"),
    order("EPK-4", "2026-11-04T00:00:00Z", [line("l4", "EPK-4", "d", { status: "procuring", procurementId: "r1" })], "awaiting_stock"),
  ];
  const request = { id: "r1", orderId: "EPK-4", lineId: "l4", sku: "d", productName: "D", vendor: "Croma", costMinor: null, eta: "2026-11-01", status: "ordered" as const, poNumber: null, createdAt: "", updatedAt: "" };
  const { onPo, buying } = buildBackorders(waiting, [po], [request], { b: level("b", 0), c: level("c", 1), d: level("d", 0) }, "2026-11-10");
  assert.deepEqual(onPo.map((g) => [g.poId, g.waitingQty, g.late]), [["gone", 1, false], ["po1", 2, true]]);
  assert.equal(onPo[0].po, null);
  assert.equal(onPo[0].waiting[0].freeNow, true);
  assert.deepEqual(onPo[1].waiting.map((w) => w.order.id), ["EPK-1", "EPK-2"]);
  assert.equal(buying[0].late, true);
  assert.equal(buying[0].order?.id, "EPK-4");
});

test("verify payment starts from what Shopify says, only for website orders", () => {
  const web = { createdBy: "Shopify", declaredPaymentStatus: "Shopify: paid, ₹69,900 paid", declaredPaymentMode: "snapmint", paidMinor: 0 };
  assert.deepEqual(shopifyPaymentHint(web), { amountMinor: 6_990_000, mode: "Snapmint", gateway: "snapmint" });
  assert.equal(shopifyPaymentHint({ ...web, createdBy: "U123" }), null, "a CDE's sale is never pre-filled");
  assert.equal(shopifyPaymentHint({ ...web, paidMinor: 6_990_000 }), null, "already verified");
  assert.equal(shopifyPaymentHint({ ...web, declaredPaymentStatus: "Shopify: pending" }), null);
  assert.equal(shopifyPaymentHint({ ...web, declaredPaymentMode: "razorpay" })?.mode, null, "card or UPI: RevOps picks");
  assert.equal(modeFromGateway("bajaj finserv"), "Bajaj");
  assert.equal(modeFromGateway("cash on delivery (cod)"), "Cash");
  assert.equal(modeFromGateway("razorpay + snapmint"), null);
});

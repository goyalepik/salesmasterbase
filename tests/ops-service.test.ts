import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryOpsStore } from "../src/lib/ops/memory-store";
import {
  cancelOrder,
  clearForFulfilment,
  createOrder,
  decideLine,
  markDelivered,
  outForDelivery,
  receiveProcurement,
  receivePurchaseOrder,
  recordPayment,
  setShopifyId,
  stageFromLines,
} from "../src/lib/ops/service";
import type { NewOrderInput } from "../src/lib/ops/types";

const desk = { name: "Desk", slackUserId: null };

function store() {
  return new MemoryOpsStore({
    products: [
      { sku: "ep-dr-l50s-pu", name: "DREAME L50s Pro Ultra", brand: "Dreame", category: "Robot Vacuum", channel: "CnC", listPriceMinor: 8_000_000, gstRate: 0.18, hsn: null, eol: false, needsInstallation: true },
      { sku: "ep-ap-i17-256-bk", name: "Apple iPhone 17 256GB Black", brand: "Apple", category: "Phone", channel: "CnC", listPriceMinor: 9_000_000, gstRate: 0.18, hsn: null, eol: false, needsInstallation: false },
    ],
    movements: [{ sku: "ep-dr-l50s-pu", qty: 1, kind: "opening", refType: null, refId: null, serialNo: null, unitCostMinor: 7_200_000, note: null, actor: "import", createdAt: "2026-10-01T00:00:00Z" }],
    purchaseOrders: [{ id: "po1", poNumber: "PO-1", vendor: "Value-One", sku: "ep-dr-l50s-pu", productName: null, qtyOrdered: 2, qtyReceived: 0, eta: "2026-11-05", status: "open", createdAt: "2026-10-01T00:00:00Z" }],
  });
}

function sale(sku = "ep-dr-l50s-pu", price = 7_500_000): NewOrderInput {
  return { source: "desk", customerName: "Asha Rao", phone: "9845012345", hub: "Hebbal", poc: "Ibrahim", lines: [{ sku, productName: sku, listPriceMinor: null, offeredPriceMinor: price }] };
}

test("a sale moves from payment to delivery and creates installation", async () => {
  const s = store();
  const created = await createOrder(s, sale(), desk);
  assert.ok(created.ok);
  const id = created.value.id;
  assert.equal(created.value.stage, "awaiting_payment");
  assert.equal(created.value.lines[0].productName, "DREAME L50s Pro Ultra");

  const early = await decideLine(s, created.value.lines[0].id, { type: "reserve" }, desk);
  assert.equal(early.ok, false, "inventory cannot act before RevOps");

  const paid = await recordPayment(s, id, { amountMinor: 2_500_000, mode: "UPI", kind: "advance", reference: "UTR1", clear: true }, desk);
  assert.ok(paid.ok);
  assert.equal(paid.value.stage, "awaiting_inventory");
  assert.equal(paid.value.codDueMinor, 5_000_000);

  const reserved = await decideLine(s, created.value.lines[0].id, { type: "reserve" }, desk);
  assert.ok(reserved.ok);
  assert.equal(reserved.value.stage, "ready_to_dispatch");
  assert.equal((await s.stockFor("ep-dr-l50s-pu"))?.available, 0);

  const ofd = await outForDelivery(s, id, { driver: "Ravi", serials: { [created.value.lines[0].id]: "SN1" }, expectedDate: null }, desk);
  assert.ok(ofd.ok);
  assert.equal((await s.stockFor("ep-dr-l50s-pu"))?.onHand, 0);

  const delivered = await markDelivered(s, id, { collectedMinor: 5_000_000, mode: "Cash" }, desk);
  assert.ok(delivered.ok);
  assert.equal(delivered.value.stage, "delivered");
  assert.equal(delivered.value.codDueMinor, 0);
  assert.equal(delivered.value.paidMinor, 7_500_000);
  assert.equal(delivered.value.installations.length, 1, "robot vacuum needs installation");
});

test("the last unit cannot be reserved twice", async () => {
  const s = store();
  const a = await createOrder(s, sale(), desk);
  const b = await createOrder(s, sale(), desk);
  assert.ok(a.ok && b.ok);
  await clearForFulfilment(s, a.value.id, "Repeat customer", desk);
  await clearForFulfilment(s, b.value.id, "Repeat customer", desk);
  const first = await decideLine(s, a.value.lines[0].id, { type: "reserve" }, desk);
  const second = await decideLine(s, b.value.lines[0].id, { type: "reserve" }, desk);
  assert.ok(first.ok);
  assert.equal(second.ok, false);
});

test("a line held on a PO is reserved when the PO arrives", async () => {
  const s = store();
  const filler = await createOrder(s, sale(), desk);
  const order = await createOrder(s, sale(), desk);
  assert.ok(filler.ok && order.ok);
  await clearForFulfilment(s, filler.value.id, "ok", desk);
  await decideLine(s, filler.value.lines[0].id, { type: "reserve" }, desk);
  await clearForFulfilment(s, order.value.id, "ok", desk);
  const held = await decideLine(s, order.value.lines[0].id, { type: "hold_po", poId: "po1" }, desk);
  assert.ok(held.ok);
  assert.equal(held.value.stage, "awaiting_stock");
  const received = await receivePurchaseOrder(s, "po1", { qty: 1, serials: [], unitCostMinor: null }, desk);
  assert.ok(received.ok);
  assert.deepEqual(received.value.reserved, [order.value.id]);
  assert.equal((await s.getOrder(order.value.id))?.stage, "ready_to_dispatch");
});

test("procure for a customer, then receive", async () => {
  const s = store();
  const order = await createOrder(s, sale("ep-ap-i17-256-bk", 8_500_000), desk);
  assert.ok(order.ok);
  await clearForFulfilment(s, order.value.id, "ok", desk);
  const procured = await decideLine(s, order.value.lines[0].id, { type: "procure", vendor: "Vijay Sales", costMinor: 8_000_000, eta: "2026-11-02" }, desk);
  assert.ok(procured.ok);
  assert.equal(procured.value.stage, "awaiting_stock");
  const request = procured.value.procurement[0];
  const received = await receiveProcurement(s, request.id, { serialNo: "IMEI1", unitCostMinor: null }, desk);
  assert.ok(received.ok);
  assert.equal(received.value.stage, "ready_to_dispatch");
  assert.equal((await s.stockFor("ep-ap-i17-256-bk"))?.reserved, 1);
});

test("cancelling frees reserved stock", async () => {
  const s = store();
  const order = await createOrder(s, sale(), desk);
  assert.ok(order.ok);
  await clearForFulfilment(s, order.value.id, "ok", desk);
  await decideLine(s, order.value.lines[0].id, { type: "reserve" }, desk);
  const cancelled = await cancelOrder(s, order.value.id, "Customer changed mind", desk);
  assert.ok(cancelled.ok);
  assert.equal((await s.stockFor("ep-dr-l50s-pu"))?.available, 1);
});

test("roles are enforced once people are configured", async () => {
  const s = store();
  await s.upsertPerson({ slackUserId: "U1", name: "Riya", roles: ["sales"], hub: null });
  const order = await createOrder(s, sale(), desk);
  assert.ok(order.ok);
  const refused = await recordPayment(s, order.value.id, { amountMinor: 100, mode: "UPI", kind: "advance", reference: null, clear: true }, { name: "Riya", slackUserId: "U1" });
  assert.equal(refused.ok, false);
});

test("stage follows the lines", () => {
  const base = { id: "l", orderId: "o", lineNo: 1, sku: null, productName: "x", qty: 1, listPriceMinor: null, offeredPriceMinor: 1, accessories: null, extendedWarranty: null, installation: null, poId: null, procurementId: null, serialNo: null, rejectReason: null };
  assert.equal(stageFromLines([{ ...base, status: "reserved" }, { ...base, status: "brand_direct" }]), "ready_to_dispatch");
  assert.equal(stageFromLines([{ ...base, status: "reserved" }, { ...base, status: "procuring" }]), "awaiting_stock");
  assert.equal(stageFromLines([{ ...base, status: "rejected" }]), "on_hold");
});

test("shopify ids are normalised", async () => {
  const s = store();
  const order = await createOrder(s, sale(), desk);
  assert.ok(order.ok);
  const linked = await setShopifyId(s, order.value.id, "pik3918", desk);
  assert.ok(linked.ok);
  assert.equal(linked.value.shopifyOrderId, "#PIK3918");
});

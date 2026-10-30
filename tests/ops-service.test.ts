import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryOpsStore } from "../src/lib/ops/memory-store";
import {
  cancelOrder,
  clearForFulfilment,
  correctStock,
  createOrder,
  createPurchaseOrder,
  decideLine,
  markDelivered,
  outForDelivery,
  receiveProcurement,
  receivePurchaseOrder,
  receiveStock,
  recordPayment,
  saveProduct,
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

test("a new product can be added and then bought on a new PO", async () => {
  const s = store();
  const added = await saveProduct(s, { sku: "EP-NW-X1", name: "Narwal Freo X1", brand: "Narwal", category: "Robot Vacuum", listPriceMinor: 6_000_000, needsInstallation: true }, desk);
  assert.ok(added.ok);
  assert.equal(added.value.sku, "ep-nw-x1", "sku is stored lower case");
  const bad = await saveProduct(s, { sku: "bad sku!", name: "X", brand: null, category: null, listPriceMinor: null, needsInstallation: false }, desk);
  assert.equal(bad.ok, false);

  const po = await createPurchaseOrder(s, { poNumber: "po-epik-26-27-0099", vendor: "Value-One", eta: "2026-11-20", lines: [{ sku: "ep-nw-x1", qty: 3 }, { sku: "ep-dr-l50s-pu", qty: 2 }] }, desk);
  assert.ok(po.ok);
  assert.equal(po.value.length, 2);
  assert.equal(po.value[0].poNumber, "PO-EPIK-26-27-0099");
  assert.equal((await s.stockFor("ep-nw-x1"))?.incoming, 3);

  const again = await createPurchaseOrder(s, { poNumber: "PO-EPIK-26-27-0099", vendor: "Value-One", eta: null, lines: [{ sku: "ep-nw-x1", qty: 1 }] }, desk);
  assert.equal(again.ok, false, "the same PO and SKU cannot be added twice");
  const unknown = await createPurchaseOrder(s, { poNumber: "PO-2", vendor: "Croma", eta: null, lines: [{ sku: "ep-none", qty: 1 }] }, desk);
  assert.equal(unknown.ok, false, "products must be in the catalogue");

  const received = await receivePurchaseOrder(s, po.value[0].id, { qty: 3, serials: ["S1", "S2", "S3"], unitCostMinor: 5_000_000 }, desk);
  assert.ok(received.ok);
  assert.equal((await s.stockFor("ep-nw-x1"))?.onHand, 3);
});

test("stock can come in without a PO, with a reason", async () => {
  const s = store();
  const ret = await receiveStock(s, { sku: "ep-ap-i17-256-bk", qty: 2, reason: "return", note: "EPK-000100", serials: ["A1"], unitCostMinor: null }, desk);
  assert.ok(ret.ok);
  assert.equal((await s.stockFor("ep-ap-i17-256-bk"))?.onHand, 2);
  const kinds = (await s.listMovements("ep-ap-i17-256-bk", 10)).map((m) => [m.kind, m.qty, m.serialNo]);
  assert.deepEqual(kinds.sort(), [["return", 1, "A1"], ["return", 1, null]].sort());
  const vague = await receiveStock(s, { sku: "ep-ap-i17-256-bk", qty: 1, reason: "other", note: "", serials: [], unitCostMinor: null }, desk);
  assert.equal(vague.ok, false, "other needs a note");
  const tooManySerials = await receiveStock(s, { sku: "ep-ap-i17-256-bk", qty: 1, reason: "found", note: "", serials: ["B1", "B2"], unitCostMinor: null }, desk);
  assert.equal(tooManySerials.ok, false);
});

test("a stock correction never removes units promised to an order", async () => {
  const s = store();
  const order = await createOrder(s, sale(), desk);
  assert.ok(order.ok);
  await clearForFulfilment(s, order.value.id, "ok", desk);
  await decideLine(s, order.value.lines[0].id, { type: "reserve" }, desk);
  const remove = await correctStock(s, { sku: "ep-dr-l50s-pu", delta: -1, reason: "Physical count on 30 Oct" }, desk);
  assert.equal(remove.ok, false, "the only unit is reserved");
  const noReason = await correctStock(s, { sku: "ep-dr-l50s-pu", delta: 2, reason: "" }, desk);
  assert.equal(noReason.ok, false);
  const add = await correctStock(s, { sku: "ep-dr-l50s-pu", delta: 2, reason: "Physical count on 30 Oct" }, desk);
  assert.ok(add.ok);
  assert.equal(add.value?.onHand, 3);
  const fix = await correctStock(s, { sku: "ep-dr-l50s-pu", delta: -2, reason: "Counted twice by mistake" }, desk);
  assert.ok(fix.ok);
  assert.equal(fix.value?.available, 0);
});

test("stock actions follow team roles", async () => {
  const s = store();
  await s.upsertPerson({ slackUserId: "U1", name: "Sales person", roles: ["sales"], hub: null });
  const seller = { name: "Sales person", slackUserId: "U1" };
  assert.equal((await correctStock(s, { sku: "ep-dr-l50s-pu", delta: 1, reason: "Physical count" }, seller)).ok, false);
  assert.equal((await createPurchaseOrder(s, { poNumber: "PO-9", vendor: "X Co", eta: null, lines: [{ sku: "ep-dr-l50s-pu", qty: 1 }] }, seller)).ok, false);
});

test("receiving the same PO twice at once never doubles the stock", async () => {
  const s = store();
  const [a, b] = await Promise.all([
    receivePurchaseOrder(s, "po1", { qty: 2, serials: [], unitCostMinor: null }, desk),
    receivePurchaseOrder(s, "po1", { qty: 2, serials: [], unitCostMinor: null }, desk),
  ]);
  assert.equal([a.ok, b.ok].filter(Boolean).length, 1, "only one receipt goes through");
  assert.equal((await s.stockFor("ep-dr-l50s-pu"))?.onHand, 3, "1 opening + 2 received");
});

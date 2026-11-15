import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryOpsStore } from "../src/lib/ops/memory-store";
import { approvePayment, createOrder, setDeliveryStatus, type Actor } from "../src/lib/ops/service";
import { needsPaymentApproval } from "../src/lib/ops/delivery-status";
import { countByStatus, inView } from "../src/lib/ops-ui/delivery-board";
import { serviceRolesFor } from "../src/lib/app-roles";

// Every sale from PAYMENT_APPROVAL_FROM waits for Sales to approve its payment; then logistics picks it up.
process.env.PAYMENT_APPROVAL_FROM = "2026-01-01T00:00:00Z";

const sales: Actor = { name: "Sales desk", slackUserId: null, roles: serviceRolesFor("sales") };
const logistics: Actor = { name: "Logistics", slackUserId: null, roles: serviceRolesFor("inventory") };

async function sale(store = new MemoryOpsStore(), total = 6_500_000) {
  const created = await createOrder(
    store,
    { source: "slack", customerName: "Asha Rao", phone: "9845012345", hub: "HQ", poc: "Ibrahim", declaredPaymentStatus: "Full paid", lines: [{ sku: null, productName: "Robot vacuum", listPriceMinor: null, offeredPriceMinor: total }] },
    sales,
  );
  assert.ok(created.ok);
  return { store, id: created.value.id };
}

test("a new sale waits for payment approval: not in logistics' To do, and logistics can't move it", async () => {
  const { store, id } = await sale();
  const order = (await store.getOrder(id))!;
  assert.equal(needsPaymentApproval(order), true);
  assert.equal(inView(order, "open"), false);
  assert.equal(inView(order, "new"), false);
  assert.equal(inView(order, "payment"), true);
  assert.equal(countByStatus([order]).payment, 1);
  assert.equal(countByStatus([order]).open, 0);
  const moved = await setDeliveryStatus(store, id, { status: "ready", note: null, expectedDate: null, driver: null }, logistics);
  assert.equal(moved.ok, false);
  assert.match(moved.ok ? "" : moved.error, /Waiting for Sales to approve the payment/);
});

test("full paid: the payment is recorded and the sale goes to logistics", async () => {
  const { store, id } = await sale();
  const done = await approvePayment(store, id, { choice: "full", mode: "UPI", reference: "431298765432", note: null }, sales);
  assert.ok(done.ok, done.ok ? "" : done.error);
  const order = (await store.getOrder(id))!;
  assert.equal(order.stage, "awaiting_inventory");
  assert.equal(order.paidMinor, 6_500_000);
  assert.equal(order.codDueMinor, 0);
  assert.equal(inView(order, "open"), true);
  assert.match(order.events.at(-1)!.summary, /Payment approved: ₹65,000(\.00)? full paid by UPI \(ref 431298765432\)\. Balance ₹0(\.00)?\. Sent to logistics\./);
  // Now logistics can work on it.
  assert.ok((await setDeliveryStatus(store, id, { status: "ready", note: null, expectedDate: null, driver: null }, logistics)).ok);
});

test("partial paid needs an amount below the total, and keeps the balance", async () => {
  const { store, id } = await sale();
  const tooMuch = await approvePayment(store, id, { choice: "partial", amountMinor: 6_500_000, mode: "Cash" }, sales);
  assert.equal(tooMuch.ok, false);
  const ok = await approvePayment(store, id, { choice: "partial", amountMinor: 2_000_000, mode: "Cash", note: "Rest on delivery" }, sales);
  assert.ok(ok.ok);
  const order = (await store.getOrder(id))!;
  assert.equal(order.paidMinor, 2_000_000);
  assert.equal(order.codDueMinor, 4_500_000);
  assert.equal(order.stage, "awaiting_inventory");
});

test("without payment needs a note; cancel needs a reason and frees the order", async () => {
  const a = await sale();
  assert.equal((await approvePayment(a.store, a.id, { choice: "without", note: "" }, sales)).ok, false);
  assert.ok((await approvePayment(a.store, a.id, { choice: "without", note: "Payment link sent" }, sales)).ok);
  const order = (await a.store.getOrder(a.id))!;
  assert.equal(order.stage, "awaiting_inventory");
  assert.equal(order.paidMinor, 0);
  assert.equal(order.codDueMinor, 6_500_000);
  assert.match(order.events.at(-1)!.summary, /without payment: Payment link sent\. Sent to logistics\./);

  const b = await sale();
  assert.equal((await approvePayment(b.store, b.id, { choice: "cancel", note: "" }, sales)).ok, false);
  assert.ok((await approvePayment(b.store, b.id, { choice: "cancel", note: "Customer changed mind" }, sales)).ok);
  assert.equal((await b.store.getOrder(b.id))!.stage, "cancelled");
});

test("approving twice is refused, and Inventory can't approve", async () => {
  const { store, id } = await sale();
  assert.equal((await approvePayment(store, id, { choice: "full", mode: "UPI" }, logistics)).ok, false);
  assert.ok((await approvePayment(store, id, { choice: "full", mode: "UPI" }, sales)).ok);
  const again = await approvePayment(store, id, { choice: "full", mode: "UPI" }, sales);
  assert.equal(again.ok, false);
  assert.equal((await store.getOrder(id))!.paidMinor, 6_500_000, "no second payment");
});

test("orders made before approval started count as approved", async () => {
  process.env.PAYMENT_APPROVAL_FROM = "2099-01-01T00:00:00Z";
  const { store, id } = await sale();
  const order = (await store.getOrder(id))!;
  assert.equal(needsPaymentApproval(order), false);
  assert.equal(inView(order, "open"), true);
  process.env.PAYMENT_APPROVAL_FROM = "2026-01-01T00:00:00Z";
});

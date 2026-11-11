import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { MemoryRepository } from "../src/lib/memory-repository";
import { MemoryOpsStore } from "../src/lib/ops/memory-store";
import { computeMetrics } from "../src/lib/ops/metrics";
import { clearTestOrders, createOrder, decideLine, outForDelivery, recordPayment } from "../src/lib/ops/service";
import { declaredUtr, discountFlag, isTestName, isTestSaleText } from "../src/lib/ops/test-mode";
import type { NewOrderInput } from "../src/lib/ops/types";
import { handleSlackEvent } from "../src/lib/slack/handle-event";
import { homeSales, homeView } from "../src/lib/slack/home";
import { utrAlsoOn } from "../src/lib/slack/ops-actions";
import { orderCard } from "../src/lib/slack/ops-cards";
import { SALE_FORM_MARKER } from "../src/lib/slack/sale-form";

const desk = { name: "Desk", slackUserId: null };

function store() {
  return new MemoryOpsStore({
    products: [{ sku: "ep-dr-l50s-pu", name: "DREAME L50s Pro Ultra", brand: "Dreame", category: "Robot Vacuum", channel: "CnC", listPriceMinor: 8_000_000, gstRate: 0.18, hsn: null, eol: false, needsInstallation: true }],
    movements: [{ sku: "ep-dr-l50s-pu", qty: 2, kind: "opening", refType: null, refId: null, serialNo: null, unitCostMinor: 7_200_000, note: null, actor: "import", createdAt: "2026-10-01T00:00:00Z" }],
    purchaseOrders: [],
  });
}

function sale(customerName: string, extra: Partial<NewOrderInput> = {}): NewOrderInput {
  return { source: "slack", customerName, phone: "9000012345", hub: "Hebbal", poc: "Ibrahim", lines: [{ sku: "ep-dr-l50s-pu", productName: "x", listPriceMinor: 8_000_000, offeredPriceMinor: 7_800_000 }], ...extra };
}

test("test names: TEST at the start, any case, but not words that only begin with test", () => {
  for (const name of ["TEST", "Test Bhavya", "test-2", "  TEST: phone"]) assert.equal(isTestName(name), true, name);
  for (const name of ["Testarossa Rao", "Asha Test", "", null]) assert.equal(isTestName(name), false, String(name));
  assert.equal(isTestSaleText(`Name - TEST Bhavya\nProduct - Dreame\n${SALE_FORM_MARKER}`), true);
  assert.equal(isTestSaleText(`Name - Asha Rao\nNotes - test run`), false);
});

test("discount flag: over 15% below the Shopify list price, over the products that have one", () => {
  assert.equal(discountFlag([{ listPriceMinor: 10_000_00, offeredPriceMinor: 9_000_00, qty: 1 }]), null, "10% is fine");
  const flag = discountFlag([{ listPriceMinor: 10_000_00, offeredPriceMinor: 7_800_00, qty: 2 }, { listPriceMinor: null, offeredPriceMinor: 1_00, qty: 1 }]);
  assert.ok(flag);
  assert.equal(Math.round(flag.share * 100), 22);
  assert.equal(flag.listMinor, 20_000_00);
});

test("the UTR inside the CDE's payment line", () => {
  assert.equal(declaredUtr("UPI, UTR 431298765432"), "431298765432");
  assert.equal(declaredUtr("Card, ref: AB12CD34"), "AB12CD34");
  assert.equal(declaredUtr("Cash"), null);
});

test("test orders never count in the numbers", async () => {
  const s = store();
  const real = await createOrder(s, sale("Asha Rao"), desk);
  const practice = await createOrder(s, sale("TEST Bhavya"), desk);
  assert.ok(real.ok && practice.ok);
  const { items } = await s.listOrders({ stage: "all" });
  const m = computeMetrics({ now: new Date(), orders: items, verifiedTodayMinor: 0, stock: [], procurement: [], installations: [] });
  assert.equal(m.today.orders, 1);
  assert.equal(m.pipeline.awaiting_payment, 1);
});

test("the card: TEST label, what the CDE said about the payment, discount and same-UTR warnings", async () => {
  const s = store();
  const first = await createOrder(s, sale("Asha Rao", { declaredPaymentStatus: "Full paid, ₹78,000 received", declaredPaymentMode: "UPI, UTR 431298765432" }), desk);
  const second = await createOrder(s, sale("TEST Bhavya", { declaredPaymentMode: "UPI, UTR 431298765432", lines: [{ sku: "ep-dr-l50s-pu", productName: "x", listPriceMinor: 8_000_000, offeredPriceMinor: 6_000_000 }] }), desk);
  assert.ok(first.ok && second.ok);
  const order = (await s.getOrder(second.value.id))!;
  const clash = await utrAlsoOn(s, order);
  assert.deepEqual(clash, [first.value.id]);
  const card = orderCard(order, { stock: {}, appBaseUrl: null, buttons: true, utrAlsoOn: clash });
  const json = JSON.stringify(card.blocks);
  assert.match(json, /TEST · EPK-/);
  assert.match(json, /25% below the list price/);
  assert.match(json, new RegExp(`same UTR is also on ${first.value.id}`));
  assert.match(json, /Payment, as the CDE entered it/);
  const plain = orderCard((await s.getOrder(first.value.id))!, { stock: {}, appBaseUrl: null, buttons: true, utrAlsoOn: [] });
  assert.doesNotMatch(JSON.stringify(plain.blocks), /TEST ·|below the list price/);
});

test("Clear test orders removes only test orders and puts their units back in stock", async () => {
  const s = store();
  const real = await createOrder(s, sale("Asha Rao"), desk);
  const practice = await createOrder(s, sale("TEST dispatch"), desk);
  const reservedOnly = await createOrder(s, sale("test reserve"), desk);
  assert.ok(real.ok && practice.ok && reservedOnly.ok);
  for (const o of [practice.value, reservedOnly.value]) {
    await recordPayment(s, o.id, { amountMinor: 7_800_000, mode: "UPI", kind: "full", reference: null, clear: true }, desk);
    assert.ok((await decideLine(s, o.lines[0]!.id, { type: "reserve" }, desk)).ok);
  }
  assert.ok((await outForDelivery(s, practice.value.id, { driver: "Ravi", serials: {}, expectedDate: null }, desk)).ok);
  assert.equal((await s.stockFor("ep-dr-l50s-pu"))?.available, 0);

  const cleared = await clearTestOrders(s, desk);
  assert.ok(cleared.ok);
  assert.deepEqual(cleared.value.orders.map((o) => o.id).sort(), [practice.value.id, reservedOnly.value.id].sort());
  assert.equal(await s.getOrder(practice.value.id), null);
  assert.ok(await s.getOrder(real.value.id), "real order untouched");
  const level = await s.stockFor("ep-dr-l50s-pu");
  assert.equal(level?.onHand, 2, "dispatched unit returned");
  assert.equal(level?.available, 2, "reservation gone");
});

test("Home tab: the CDE's own last 5 days and open orders, test orders labelled but not counted", async () => {
  const s = store();
  await createOrder(s, sale("Asha Rao"), { name: "Ibrahim", slackUserId: null });
  const mine = await createOrder(s, { ...sale("Asha Rao"), createdBy: "U_CDE" }, desk);
  await createOrder(s, { ...sale("TEST Bhavya"), createdBy: "U_CDE" }, desk);
  await createOrder(s, { ...sale("Someone else"), createdBy: "U_OTHER" }, desk);
  assert.ok(mine.ok);
  const sales = await homeSales(s, "U_CDE");
  assert.equal(sales.recent.orders, 1);
  assert.equal(sales.recent.offeredMinor, 7_800_000);
  assert.equal(sales.open.length, 2);
  assert.equal(sales.open.filter((o) => o.test).length, 1);
  const view = JSON.stringify(homeView(sales));
  assert.match(view, /Your sales/);
  assert.match(view, /open_full_sale_form/);
  assert.match(view, /Payment review/);
});

test("a test sale posted in Slack is not stored as a sale", async () => {
  const secret = "test-signing-secret";
  const nowSeconds = 1_761_800_000;
  const repo = new MemoryRepository({ messages: [], extractions: [], exceptions: [], attempts: [], audit: [], channels: [] });
  const rawBody = JSON.stringify({ type: "event_callback", event_id: "EvT", event_time: nowSeconds, event: { type: "message", channel: "C1", bot_id: "B1", text: `Name - TEST Bhavya\nProduct - DREAME\nOffered price - 80000\n${SALE_FORM_MARKER}`, ts: "1761800000.000100" } });
  const response = await handleSlackEvent({
    rawBody,
    timestamp: String(nowSeconds),
    signature: `v0=${createHmac("sha256", secret).update(`v0:${nowSeconds}:${rawBody}`).digest("hex")}`,
    retryNum: null,
    retryReason: null,
    env: { mode: "live", signingSecret: secret, monitoredChannelId: "C1", channelName: "#sales" },
    repo,
    schedule: () => undefined,
    nowSeconds,
  });
  assert.equal(response.status, 200);
  assert.equal(repo.snapshot().messages.length, 0);
});

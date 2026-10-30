import assert from "node:assert/strict";
import test from "node:test";
import { parseMessageText } from "../src/lib/parse/message";
import type { OrderDetail, StockLevel } from "../src/lib/ops/types";
import { productSuggestions, stockForOrder } from "../src/lib/slack/ops-actions";
import { legacyTextForOrder, maskPhone, orderCard, productOptionText } from "../src/lib/slack/ops-cards";
import { formatSale, legacySaleFields, readOpsSaleSubmission, saleModal, SALE_FORM_MARKER } from "../src/lib/slack/sale-form";
import { elementsOf, setup, stateFor, type Answer } from "./slack-ops-helpers";

const BASE = "https://ops.example.com";

function actionIds(blocks: unknown[]): string[] {
  return elementsOf(blocks).map((e) => String(e.el.action_id));
}

function checkLimits(blocks: Array<Record<string, unknown>>) {
  assert.ok(blocks.length <= 50, "at most 50 blocks");
  for (const block of blocks) {
    if (block.type === "actions") {
      const elements = block.elements as Array<Record<string, unknown>>;
      assert.ok(elements.length <= 5, "at most 5 elements per actions row");
      for (const el of elements) {
        const text = (el.text as { text?: string } | undefined)?.text;
        if (text) assert.ok(text.length <= 75);
        if (el.value) assert.ok(String(el.value).length <= 2000);
        if (el.type === "overflow") for (const o of el.options as Array<{ value: string; text: { text: string } }>) assert.ok(o.value.length <= 75 && o.text.text.length <= 75);
      }
    }
    if (block.type === "header") assert.ok(((block.text as { text: string }).text).length <= 150);
  }
  const ids = blocks.map((b) => b.block_id).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length, "block ids are unique");
}

async function orderAt(stage: OrderDetail["stage"]) {
  const ctx = await setup();
  const { items } = await ctx.store.listOrders({ stage, limit: 1 });
  const order = (await ctx.store.getOrder(items[0]!.id))!;
  return { ...ctx, order, stock: await stockForOrder(ctx.store, order) };
}

test("payment check card: verify and clear buttons, masked phone, money and next step", async () => {
  const { order, stock } = await orderAt("awaiting_payment");
  const card = orderCard(order, { stock, appBaseUrl: BASE });
  checkLimits(card.blocks);
  const json = JSON.stringify(card.blocks);
  assert.match((card.blocks[0] as { text: { text: string } }).text.text, new RegExp(`^${order.id} · Payment check$`));
  assert.deepEqual(actionIds(card.blocks), ["ops:verify", "ops:clear", "ops:open", "ops:more"]);
  assert.equal(json.includes(order.phone!), false, "full phone never shown");
  assert.ok(json.includes(order.phone!.slice(-4)));
  assert.ok(json.includes("*Verified paid*"));
  assert.ok(json.includes("RevOps: verify the payment"));
  const open = elementsOf(card.blocks).find((e) => e.el.action_id === "ops:open")!;
  assert.equal(open.el.url, `${BASE}/orders/${order.id}`);
  const value = JSON.parse(String(elementsOf(card.blocks)[0]!.el.value));
  assert.deepEqual(value, { o: order.id });
});

test("no dashboard button without APP_BASE_URL", async () => {
  const { order, stock } = await orderAt("awaiting_payment");
  const card = orderCard(order, { stock, appBaseUrl: null });
  assert.equal(actionIds(card.blocks).includes("ops:open"), false);
});

test("inventory card: per-line buttons and live stock for undecided lines", async () => {
  const { order, stock } = await orderAt("awaiting_inventory");
  const card = orderCard(order, { stock, appBaseUrl: BASE });
  checkLimits(card.blocks);
  const line = order.lines[0]!;
  const level = stock[line.sku!];
  const text = JSON.stringify(card.blocks);
  assert.ok(text.includes(`Available ${level?.available ?? 0} · Reserved ${level?.reserved ?? 0} · Incoming ${level?.incoming ?? 0}`));
  const lineButtons = elementsOf(card.blocks).filter((e) => e.blockId === "line_actions:1").map((e) => String(e.el.action_id));
  assert.ok(lineButtons.includes("ops:procure"));
  assert.ok(lineButtons.includes("ops:brand_direct"));
  assert.ok(lineButtons.includes("ops:reject"));
  const value = JSON.parse(String(elementsOf(card.blocks).find((e) => e.blockId === "line_actions:1")!.el.value));
  assert.deepEqual(value, { o: order.id, l: line.id });
});

test("reserve shows only with free stock, hold on PO only with incoming stock, Map SKU without SKU", () => {
  const order = fakeOrder();
  const stock: Record<string, StockLevel | null> = {
    "ep-a": level("ep-a", 3, 1, 0, null),
    "ep-b": level("ep-b", 0, 0, 5, "2026-11-05"),
  };
  const card = orderCard(order, { stock, appBaseUrl: null });
  checkLimits(card.blocks);
  const row = (n: number) => elementsOf(card.blocks).filter((e) => e.blockId === `line_actions:${n}`).map((e) => String(e.el.action_id));
  assert.deepEqual(row(1), ["ops:reserve", "ops:procure", "ops:brand_direct", "ops:reject"]);
  assert.deepEqual(row(2), ["ops:hold_po", "ops:procure", "ops:brand_direct", "ops:reject"]);
  assert.deepEqual(row(3), ["ops:map_sku", "ops:procure", "ops:brand_direct", "ops:reject"]);
  const json = JSON.stringify(card.blocks);
  assert.ok(json.includes("Available 0 · Reserved 0 · Incoming 5 (next 5 Nov)"));
  assert.ok(json.includes("No SKU yet"));
});

test("procuring line offers Mark ordered and Received", () => {
  const order = fakeOrder();
  order.stage = "awaiting_stock";
  order.lines = [{ ...order.lines[0]!, status: "procuring", procurementId: "pr1" }];
  order.procurement = [{ id: "pr1", orderId: order.id, lineId: order.lines[0]!.id, sku: "ep-a", productName: "A", vendor: "Value-One", costMinor: null, eta: "2026-11-02", status: "requested", poNumber: null, createdAt: "", updatedAt: "" }];
  const card = orderCard(order, { stock: {}, appBaseUrl: null });
  const ids = actionIds(card.blocks);
  assert.ok(ids.includes("ops:proc_ordered") && ids.includes("ops:proc_received"));
  assert.ok(JSON.stringify(card.blocks).includes("Procuring from Value-One"));
});

test("dispatch, delivery and finished cards", async () => {
  const ready = await orderAt("ready_to_dispatch");
  assert.ok(actionIds(orderCard(ready.order, { stock: ready.stock, appBaseUrl: null }).blocks).includes("ops:dispatch"));
  const ofd = await orderAt("out_for_delivery");
  const ofdCard = orderCard(ofd.order, { stock: ofd.stock, appBaseUrl: null });
  assert.ok(actionIds(ofdCard.blocks).includes("ops:delivered"));
  const overflow = elementsOf(ofdCard.blocks).find((e) => e.el.type === "overflow")!;
  assert.deepEqual((overflow.el.options as Array<{ text: { text: string } }>).map((o) => o.text.text), ["Link Shopify #PIK"], "out for delivery cannot be cancelled");
  const done = await orderAt("delivered");
  const doneIds = actionIds(orderCard(done.order, { stock: done.stock, appBaseUrl: null }).blocks);
  assert.deepEqual(doneIds, ["ops:more"]);
});

test("many products stay inside Slack's block limit", () => {
  const order = fakeOrder();
  const base = order.lines[0]!;
  order.lines = Array.from({ length: 30 }, (_, i) => ({ ...base, id: `l${i}`, lineNo: i + 1 }));
  const card = orderCard(order, { stock: { "ep-a": level("ep-a", 9, 0, 0, null) }, appBaseUrl: BASE });
  checkLimits(card.blocks);
  assert.ok(JSON.stringify(card.blocks).includes("+10 more products"));
});

test("phone masking keeps the last four digits", () => {
  assert.equal(maskPhone("9845012345"), "••••••2345");
  assert.equal(maskPhone(null), "—");
});

test("product search returns at most 100 options labelled name · sku within 75 characters", async () => {
  const { store } = await setup();
  const result = await productSuggestions(store, "dreame");
  assert.ok(result.options.length >= 2);
  const l50 = result.options.find((o) => o.value === "ep-dr-l50s-pu")!;
  assert.ok(l50.text.text.endsWith(" · ep-dr-l50s-pu"));
  assert.ok(l50.text.text.startsWith("DREAME L50s Pro Ultra"));
  for (const o of result.options) assert.ok(o.text.text.length <= 75);
  const all = await productSuggestions(store, "");
  assert.ok(all.options.length <= 100);
  const long = productOptionText({ sku: "ep-x-1", name: "A".repeat(200) });
  assert.equal(long.length, 75);
  assert.ok(long.endsWith("… · ep-x-1"));
});

// ── Sale modal validation ────────────────────────────────────────────────────

const L50 = { value: "ep-dr-l50s-pu", text: "DREAME L50s Pro Ultra Robot Vacuum & Mop · ep-dr-l50s-pu" };
const V8 = { value: "ep-dy-v8", text: "Dyson V8 Absolute Vacuum Cleaner · ep-dy-v8" };

function saleAnswers(extra: Record<string, Answer> = {}): Record<string, Answer> {
  return {
    customer: "Asha Rao",
    phone: "+91 98450 12345",
    product: L50,
    shipping_address: "12, 2nd Main, Hebbal, Bengaluru",
    pincode: "560024",
    hub: "Hebbal",
    cx_type: "New",
    poc: "Ibrahim",
    sale_source: "Walk-in",
    sale_type: "Same day",
    list_price: "89,999",
    offered_price: "79,999",
    payment_status: "Advance payment realized",
    payment_mode: "UPI",
    ...extra,
  };
}

function saleValues(extra: Record<string, Answer> = {}) {
  return stateFor(saleModal(SALE_CHANNEL), saleAnswers(extra));
}
const SALE_CHANNEL = "CSALES0001";

test("the sale modal has phone, catalogue pickers and products 2 and 3", () => {
  const modal = saleModal(SALE_CHANNEL);
  const ids = modal.blocks.map((b) => (b as { block_id?: string }).block_id).filter(Boolean);
  for (const id of ["phone", "product", "product_other", "product_2", "offered_price_2", "product_3", "offered_price_3"]) assert.ok(ids.includes(id), id);
  const product = modal.blocks.find((b) => (b as { block_id?: string }).block_id === "product") as { element: { type: string; action_id: string } };
  assert.equal(product.element.type, "external_select");
  assert.equal(product.element.action_id, "product_search");
  assert.ok(modal.blocks.length <= 100);
});

test("a valid sale reads phone, SKU and extra products", () => {
  const read = readOpsSaleSubmission(saleValues({ product_2: V8, offered_price_2: "25,000" }), "USALES0001");
  assert.ok(read.ok);
  if (!read.ok) return;
  assert.equal(read.sale.phone, "9845012345");
  assert.deepEqual(read.sale.products.map((p) => [p.sku, p.offeredMinor]), [["ep-dr-l50s-pu", 7_999_900], ["ep-dy-v8", 2_500_000]]);
  assert.equal(read.sale.fields.product, "DREAME L50s Pro Ultra Robot Vacuum & Mop");
  assert.equal(read.sale.fields.offeredPrice, "79999");
  const legacy = formatSale(legacySaleFields(read.sale));
  const parsed = parseMessageText(legacy);
  assert.equal(parsed.offeredPriceMinor, 10_499_900, "legacy offered price is the order total");
  assert.ok(legacy.includes("Product - DREAME L50s Pro Ultra Robot Vacuum & Mop + Dyson V8 Absolute Vacuum Cleaner"));
  assert.ok(legacy.includes(SALE_FORM_MARKER));
  assert.equal(legacy.includes("9845012345"), false, "phone is not added to the channel text");
});

test("phone is required and must be a mobile number", () => {
  for (const phone of ["", "12345", "0000000000"]) {
    const read = readOpsSaleSubmission(saleValues({ phone }), "USALES0001");
    assert.equal(read.ok, false);
    if (!read.ok) assert.equal(typeof read.errors.phone, "string");
  }
});

test("a product must be picked or typed, not both", () => {
  const none = readOpsSaleSubmission(saleValues({ product: "" as unknown as Answer }), "USALES0001");
  assert.equal(none.ok, false);
  if (!none.ok) assert.ok(none.errors.product);
  const both = readOpsSaleSubmission(saleValues({ product_other: "Custom sofa" }), "USALES0001");
  assert.equal(both.ok, false);
  if (!both.ok) assert.ok(both.errors.product_other);
  const typed = stateFor(saleModal(SALE_CHANNEL), { ...saleAnswers(), product: undefined as unknown as Answer, product_other: "Custom sofa" });
  const read = readOpsSaleSubmission(typed, "USALES0001");
  assert.ok(read.ok);
  if (read.ok) assert.deepEqual(read.sale.products[0], { sku: null, name: "Custom sofa", offeredMinor: 7_999_900 });
});

test("products 2 and 3 need both the product and the price", () => {
  const noPrice = readOpsSaleSubmission(saleValues({ product_2: V8 }), "USALES0001");
  assert.equal(noPrice.ok, false);
  if (!noPrice.ok) assert.ok(noPrice.errors.offered_price_2);
  const noProduct = readOpsSaleSubmission(saleValues({ offered_price_3: "5000" }), "USALES0001");
  assert.equal(noProduct.ok, false);
  if (!noProduct.ok) assert.ok(noProduct.errors.product_3);
  const badPrice = readOpsSaleSubmission(saleValues({ product_2: V8, offered_price_2: "soon" }), "USALES0001");
  assert.equal(badPrice.ok, false);
  if (!badPrice.ok) assert.ok(badPrice.errors.offered_price_2);
});

test("legacy text rebuilt from an order matches the posted text", async () => {
  const read = readOpsSaleSubmission(saleValues({ product_2: V8, offered_price_2: "25000" }), "USALES0001");
  assert.ok(read.ok);
  if (!read.ok) return;
  const posted = formatSale(legacySaleFields(read.sale));
  const { store } = await setup();
  const { orderInputFromSale } = await import("../src/lib/ops/sale-input");
  const { createOrder } = await import("../src/lib/ops/service");
  const created = await createOrder(
    store,
    orderInputFromSale(read.sale.fields, { source: "slack", phone: read.sale.phone, sku: "ep-dr-l50s-pu", extraLines: [{ sku: "ep-dy-v8", productName: "Dyson V8 Absolute Vacuum Cleaner", listPriceMinor: null, offeredPriceMinor: 2_500_000 }], createdBy: "USALES0001" }),
    { name: "Ibrahim", slackUserId: "USALES0001" },
  );
  assert.ok(created.ok);
  if (!created.ok) return;
  assert.equal(legacyTextForOrder(created.value), posted);
});

// ── helpers ─────────────────────────────────────────────────────────────────

function level(sku: string, available: number, reserved: number, incoming: number, nextEta: string | null): StockLevel {
  return { sku, name: sku, brand: null, category: null, channel: null, onHand: available + reserved, reserved, available, incoming, nextEta, unitCostMinor: null };
}

function fakeOrder(): OrderDetail {
  const line = (n: number, sku: string | null) => ({
    id: `line-${n}`,
    orderId: "EPK-000900",
    lineNo: n,
    sku,
    productName: sku ? `Product ${sku}` : "Custom sofa",
    qty: 1,
    listPriceMinor: null,
    offeredPriceMinor: 1_000_000,
    accessories: null,
    extendedWarranty: null,
    installation: null,
    status: "pending" as const,
    poId: null,
    procurementId: null,
    serialNo: null,
    rejectReason: null,
  });
  return {
    id: "EPK-000900",
    createdAt: "2026-10-30T05:00:00Z",
    updatedAt: "2026-10-30T05:00:00Z",
    source: "slack",
    stage: "awaiting_inventory",
    stageChangedAt: "2026-10-30T05:00:00.000Z",
    customerName: "Asha <Rao>",
    phone: "9845012345",
    email: null,
    shippingAddress: null,
    pincode: null,
    billingAddress: null,
    gst: null,
    hub: "Hebbal",
    cxType: null,
    poc: "Ibrahim",
    saleSource: null,
    saleType: null,
    declaredPaymentStatus: null,
    declaredPaymentMode: null,
    notes: null,
    shopifyOrderId: null,
    slackChannelId: "CSALES0001",
    slackMessageTs: "1.1",
    createdBy: "USALES0001",
    offeredTotalMinor: 3_000_000,
    paidMinor: 1_000_000,
    codDueMinor: 2_000_000,
    driver: null,
    expectedDeliveryDate: null,
    dispatchedAt: null,
    deliveredAt: null,
    holdReason: null,
    cancelReason: null,
    lines: [line(1, "ep-a"), line(2, "ep-b"), line(3, null)],
    payments: [],
    events: [],
    installations: [],
    procurement: [],
  };
}

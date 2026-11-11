import assert from "node:assert/strict";
import test from "node:test";
import { parseMessageText } from "../src/lib/parse/message";
import type { OrderDetail, StockLevel } from "../src/lib/ops/types";
import { productSuggestions, stockForOrder } from "../src/lib/slack/ops-actions";
import { legacyTextForOrder, maskPhone, orderCard, productOptionText } from "../src/lib/slack/ops-cards";
import { formatSale, formatWebSale, formForChoice, legacySaleFields, readOpsSaleSubmission, readWebSaleSubmission, saleButtonMessage, saleChoiceModal, saleModal, SALE_FORM_MARKER, webSaleModal, withCatalogue } from "../src/lib/slack/sale-form";
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
  const card = orderCard(order, { stock, appBaseUrl: BASE, buttons: true });
  checkLimits(card.blocks);
  const json = JSON.stringify(card.blocks);
  assert.match((card.blocks[0] as { text: { text: string } }).text.text, new RegExp(`^${order.id} · Payment review$`));
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
  const card = orderCard(order, { stock, appBaseUrl: null, buttons: true });
  assert.equal(actionIds(card.blocks).includes("ops:open"), false);
});

test("inventory card: per-line buttons and live stock for undecided lines", async () => {
  const { order, stock } = await orderAt("awaiting_inventory");
  const card = orderCard(order, { stock, appBaseUrl: BASE, buttons: true });
  checkLimits(card.blocks);
  const line = order.lines[0]!;
  const level = stock[line.sku!];
  const text = JSON.stringify(card.blocks);
  assert.ok(text.includes(`In stock: ${level?.available ?? 0} free · ${level?.reserved ?? 0} allocated · ${level?.incoming ?? 0} incoming`));
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
  const card = orderCard(order, { stock, appBaseUrl: null, buttons: true });
  checkLimits(card.blocks);
  const row = (n: number) => elementsOf(card.blocks).filter((e) => e.blockId === `line_actions:${n}`).map((e) => String(e.el.action_id));
  assert.deepEqual(row(1), ["ops:reserve", "ops:procure", "ops:brand_direct", "ops:reject"]);
  assert.deepEqual(row(2), ["ops:hold_po", "ops:procure", "ops:brand_direct", "ops:reject"]);
  assert.deepEqual(row(3), ["ops:map_sku", "ops:procure", "ops:brand_direct", "ops:reject"]);
  const json = JSON.stringify(card.blocks);
  assert.ok(json.includes("In stock: 0 free · 0 allocated · 5 incoming (next 5 Nov)"));
  assert.ok(json.includes("No SKU yet"));
});

test("procuring line offers Mark ordered and Received", () => {
  const order = fakeOrder();
  order.stage = "awaiting_stock";
  order.lines = [{ ...order.lines[0]!, status: "procuring", procurementId: "pr1" }];
  order.procurement = [{ id: "pr1", orderId: order.id, lineId: order.lines[0]!.id, sku: "ep-a", productName: "A", vendor: "Value-One", costMinor: null, eta: "2026-11-02", status: "requested", poNumber: null, createdAt: "", updatedAt: "" }];
  const card = orderCard(order, { stock: {}, appBaseUrl: null, buttons: true });
  const ids = actionIds(card.blocks);
  assert.ok(ids.includes("ops:proc_ordered") && ids.includes("ops:proc_received"));
  assert.ok(JSON.stringify(card.blocks).includes("Procuring from Value-One"));
});

test("dispatch, delivery and finished cards", async () => {
  const ready = await orderAt("ready_to_dispatch");
  assert.ok(actionIds(orderCard(ready.order, { stock: ready.stock, appBaseUrl: null, buttons: true }).blocks).includes("ops:dispatch"));
  const ofd = await orderAt("out_for_delivery");
  const ofdCard = orderCard(ofd.order, { stock: ofd.stock, appBaseUrl: null, buttons: true });
  assert.ok(actionIds(ofdCard.blocks).includes("ops:delivered"));
  const overflow = elementsOf(ofdCard.blocks).find((e) => e.el.type === "overflow")!;
  assert.deepEqual((overflow.el.options as Array<{ text: { text: string } }>).map((o) => o.text.text), ["Link Shopify #PIK"], "out for delivery cannot be cancelled");
  const done = await orderAt("delivered");
  const doneIds = actionIds(orderCard(done.order, { stock: done.stock, appBaseUrl: null, buttons: true }).blocks);
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

test("product search returns at most 100 options labelled name · Shopify price within 75 characters", async () => {
  const { store } = await setup();
  const result = await productSuggestions(store, "dreame");
  assert.ok(result.options.length >= 2);
  const l50 = result.options.find((o) => o.value === "ep-dr-l50s-pu")!;
  assert.ok(l50.text.text.endsWith(" · ₹89,999"), l50.text.text);
  assert.ok(l50.text.text.startsWith("DREAME L50s Pro Ultra"));
  for (const o of result.options) assert.ok(o.text.text.length <= 75);
  const all = await productSuggestions(store, "");
  assert.ok(all.options.length <= 100);
  // No price: the SKU stands in.
  const long = productOptionText({ sku: "ep-x-1", name: "A".repeat(200) });
  assert.equal(long.length, 75);
  assert.ok(long.endsWith("… · ep-x-1"));
});

// ── Sale forms ───────────────────────────────────────────────────────────────

const L50 = { value: "ep-dr-l50s-pu", text: "DREAME L50s Pro Ultra Robot Vacuum & Mop · ₹89,999" };

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
    sale_source: "Home Demo",
    sale_type: "Same day",
    offered_price: "79,999",
    payment_status: "Partial",
    paid_by: "UPI",
    amount_received: "20,000",
    utr: "431298765432",
    ...extra,
  };
}

/** The form as Slack shows it after the payment status was picked (payment questions drawn). */
function saleValues(extra: Record<string, Answer> = {}) {
  const answers = saleAnswers(extra);
  return stateFor(saleModal(SALE_CHANNEL, { paymentStatus: typeof answers.payment_status === "string" ? answers.payment_status : null }), answers);
}
const SALE_CHANNEL = "CSALES0001";

test("the long form: one product, offered price, payment questions, delivery date; no price box, no products 2 and 3", () => {
  const ids = (view: { blocks: unknown[] }) => view.blocks.map((b) => (b as { block_id?: string }).block_id).filter(Boolean);
  const blank = saleModal(SALE_CHANNEL);
  for (const id of ["customer", "phone", "email", "product", "offered_price", "product_other", "hub", "poc", "payment_status", "expected_delivery", "notes"]) assert.ok(ids(blank).includes(id), id);
  for (const id of ["list_price", "product_2", "product_3", "paid_by", "collect_by"]) assert.equal(ids(blank).includes(id), false, id);
  const product = blank.blocks.find((b) => (b as { block_id?: string }).block_id === "product") as { element: { type: string; action_id: string } };
  assert.equal(product.element.type, "external_select");
  assert.equal(product.element.action_id, "product_search");
  // Picking a status brings its own questions.
  assert.deepEqual(["paid_by", "amount_received", "utr"].map((id) => ids(saleModal(SALE_CHANNEL, { paymentStatus: "Partial" })).includes(id)), [true, true, true]);
  assert.ok(ids(saleModal(SALE_CHANNEL, { paymentStatus: "To be collected" })).includes("collect_by"));
  assert.equal(ids(saleModal(SALE_CHANNEL, { paymentStatus: "To be collected" })).includes("utr"), false);
  assert.ok(blank.blocks.length <= 100);
  assert.ok(blank.title.text.length <= 24);
});

test("a valid long-form sale reads phone, SKU, payment and delivery date", () => {
  const read = readOpsSaleSubmission(saleValues({ expected_delivery: "2026-11-14" }), "USALES0001");
  assert.ok(read.ok, JSON.stringify(read));
  if (!read.ok) return;
  assert.equal(read.sale.phone, "9845012345");
  assert.deepEqual(read.sale.products.map((p) => [p.sku, p.offeredMinor]), [["ep-dr-l50s-pu", 7_999_900]]);
  assert.equal(read.sale.fields.product, "DREAME L50s Pro Ultra Robot Vacuum & Mop");
  assert.equal(read.sale.fields.paymentStatus, "Partial, ₹20,000 received");
  assert.equal(read.sale.fields.paymentMode, "UPI, UTR 431298765432");
  assert.equal(read.sale.fields.expectedDelivery, "2026-11-14");
  const legacy = formatSale(legacySaleFields(read.sale));
  assert.equal(parseMessageText(legacy).offeredPriceMinor, 7_999_900);
  assert.ok(legacy.includes("Payment status - Partial, ₹20,000 received"));
  assert.ok(legacy.includes("Expected delivery - 14 Nov 2026"));
  assert.ok(legacy.includes(SALE_FORM_MARKER));
  assert.equal(legacy.includes("9845012345"), false, "phone is not added to the channel text");
});

test("payment questions: full paid, to be collected, partial, UTR", () => {
  const full = readOpsSaleSubmission(saleValues({ payment_status: "Full paid", paid_by: "Cash", amount_received: "", utr: "" }), "USALES0001");
  assert.ok(full.ok);
  if (full.ok) {
    assert.equal(full.sale.fields.paymentStatus, "Full paid, ₹79,999 received", "blank amount = the full offered price");
    assert.equal(full.sale.fields.paymentMode, "Cash", "cash needs no UTR");
  }
  const later = readOpsSaleSubmission(saleValues({ payment_status: "To be collected", collect_by: "Cash on delivery" }), "USALES0001");
  assert.ok(later.ok);
  if (later.ok) assert.deepEqual([later.sale.fields.paymentStatus, later.sale.fields.paymentMode], ["To be collected", "Cash on delivery"]);
  const noMode = readOpsSaleSubmission(saleValues({ payment_status: "To be collected" }), "USALES0001");
  assert.ok(!noMode.ok && noMode.errors.collect_by);
  const noAmount = readOpsSaleSubmission(saleValues({ amount_received: "" }), "USALES0001");
  assert.ok(!noAmount.ok && noAmount.errors.amount_received);
  const tooMuch = readOpsSaleSubmission(saleValues({ amount_received: "79,999" }), "USALES0001");
  assert.ok(!tooMuch.ok && /Full paid/.test(tooMuch.errors.amount_received ?? ""));
  const noUtr = readOpsSaleSubmission(saleValues({ utr: "" }), "USALES0001");
  assert.ok(!noUtr.ok && noUtr.errors.utr);
  // The form never redrew: ask Slack to show the payment questions instead of failing.
  const missed = readOpsSaleSubmission(stateFor(saleModal(SALE_CHANNEL), saleAnswers()), "USALES0001");
  assert.ok(!missed.ok && missed.showPayment === "Partial");
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
  const read = readOpsSaleSubmission(saleValues({ product: undefined as unknown as Answer, product_other: "Custom sofa" }), "USALES0001");
  assert.ok(read.ok);
  if (read.ok) assert.deepEqual(read.sale.products[0], { sku: null, name: "Custom sofa", offeredMinor: 7_999_900 });
});

test("legacy text rebuilt from an order matches the posted text", async () => {
  const read = readOpsSaleSubmission(saleValues({ expected_delivery: "2026-11-14" }), "USALES0001");
  assert.ok(read.ok);
  if (!read.ok) return;
  const { store } = await setup();
  // As the route does: names and list prices from the product list.
  const sale = await withCatalogue(read.sale, async (sku) => store.getProduct(sku));
  const posted = formatSale(legacySaleFields(sale));
  const { orderInputFromSale } = await import("../src/lib/ops/sale-input");
  const { createOrder } = await import("../src/lib/ops/service");
  const created = await createOrder(store, orderInputFromSale(sale.fields, { source: "slack", phone: sale.phone, sku: "ep-dr-l50s-pu", createdBy: "USALES0001" }), { name: "Ibrahim", slackUserId: "USALES0001" });
  assert.ok(created.ok);
  if (!created.ok) return;
  assert.equal(created.value.expectedDeliveryDate, "2026-11-14");
  assert.equal(legacyTextForOrder(created.value), posted);
});

test("the list price comes from the product list; a typed price is ignored", async () => {
  // Even if an old form still sends a price, it is not used.
  const read = readOpsSaleSubmission(saleValues({ list_price: "1,50,000" }), "USALES0001");
  assert.ok(read.ok);
  if (!read.ok) return;
  assert.equal(read.sale.fields.listPrice, "");
  const sale = await withCatalogue(read.sale, async (sku) => (sku === "ep-dr-l50s-pu" ? { name: "DREAME L50s Pro Ultra", listPriceMinor: 8_999_900 } : null));
  assert.equal(sale.fields.listPrice, "89999");
  assert.ok(formatSale(legacySaleFields(sale)).includes("Price - 89999"));
  // A product typed by hand has no list price, and the price line is left out.
  const typed = readOpsSaleSubmission(saleValues({ product: undefined as unknown as Answer, product_other: "Custom sofa" }), "USALES0001");
  assert.ok(typed.ok);
  if (!typed.ok) return;
  const custom = await withCatalogue(typed.sale, async () => null);
  assert.equal(formatSale(legacySaleFields(custom)).includes("Price -"), false);
});

test("/sale asks how the customer is buying, then opens the right form", () => {
  assert.equal(saleChoiceModal(SALE_CHANNEL).callback_id, "epik_sale_choice");
  // Radio buttons are filled by hand: the test helper knows selects, not radios.
  const radio = (value: string) => ({ sale_kind: { value: { type: "radio_buttons", selected_option: { value } } } });
  assert.equal(formForChoice(radio("web"), SALE_CHANNEL)?.callback_id, "epik_web_sale");
  assert.equal(formForChoice(radio("full"), SALE_CHANNEL)?.callback_id, "epik_sale");
  assert.equal(formForChoice({}, SALE_CHANNEL), null);
  const buttons = JSON.stringify(saleButtonMessage());
  assert.ok(buttons.includes("Place order manually (CDE)") && buttons.includes("Order placed on website"));
});

test("the website form: six questions, reads cleanly, posts a sale line the old dashboard reads", () => {
  const view = webSaleModal(SALE_CHANNEL);
  const ids = view.blocks.map((b) => (b as { block_id?: string }).block_id).filter(Boolean);
  assert.deepEqual(ids, ["customer", "phone", "product", "poc", "sale_source", "notes"]);
  const values = stateFor(view, { customer: "Ravi Kumar", phone: "90000 12345", product: L50, poc: "Ibrahim", sale_source: "Home Demo", notes: "Will order tonight" });
  const read = readWebSaleSubmission(values, "USALES0001");
  assert.ok(read.ok, JSON.stringify(read));
  if (!read.ok) return;
  assert.deepEqual([read.sale.phone, read.sale.sku, read.sale.saleSource], ["9000012345", "ep-dr-l50s-pu", "Home Demo"]);
  const text = formatWebSale({ ...read.sale, listMinor: 8_999_900 });
  assert.ok(text.includes("Order type - Website"));
  assert.ok(text.includes("Price - 89999"));
  assert.ok(text.includes(SALE_FORM_MARKER));
  assert.equal(text.includes("9000012345"), false, "phone stays out of the channel");
  assert.equal(parseMessageText(text).offeredPriceMinor, 8_999_900);
  const bad = readWebSaleSubmission(stateFor(view, { customer: "R", phone: "123", poc: "", sale_source: "Home Demo" }), "USALES0001");
  assert.ok(!bad.ok && bad.errors.phone && bad.errors.product && bad.errors.customer && bad.errors.poc);
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

test("default card is status only: no step buttons, just Open in dashboard", async () => {
  for (const stage of ["awaiting_payment", "awaiting_inventory", "ready_to_dispatch"] as const) {
    const { order, stock } = await orderAt(stage);
    const card = orderCard(order, { stock, appBaseUrl: BASE });
    checkLimits(card.blocks);
    assert.deepEqual(actionIds(card.blocks), ["ops:open"], stage);
    const json = JSON.stringify(card.blocks);
    assert.equal(json.includes(order.phone!), false, "full phone never shown");
    assert.ok(json.includes("Paid *"));
    assert.ok(json.includes("*Next:*"));
  }
  const { order, stock } = await orderAt("awaiting_payment");
  assert.deepEqual(actionIds(orderCard(order, { stock, appBaseUrl: null }).blocks), []);
});

test("shortcuts and Home tab buttons open the right form", async () => {
  const { openerView, SALE_SHORTCUTS } = await import("../src/lib/slack/sale-form");
  assert.equal(SALE_SHORTCUTS.new_sale, "choice");
  assert.equal(openerView(SALE_SHORTCUTS.website_order!, "C1").callback_id, webSaleModal("C1").callback_id);
  assert.equal(openerView(SALE_SHORTCUTS.create_order!, "C1").callback_id, saleModal("C1").callback_id);
  assert.equal(openerView(SALE_SHORTCUTS.new_sale!, "C1").callback_id, saleChoiceModal("C1").callback_id);
  assert.equal(SALE_SHORTCUTS.something_else, undefined);
});

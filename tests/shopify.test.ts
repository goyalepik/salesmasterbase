import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryOpsStore } from "../src/lib/ops/memory-store";
import { createOrder, cancelOrder } from "../src/lib/ops/service";
import type { NewOrderInput } from "../src/lib/ops/types";
import { shopifyConfigFromEnv, shopifyGraphql, type Graphql } from "../src/lib/shopify/client";
import { createShopifyDraft, draftFromHistory, draftInputFor, linkCompletedDrafts, shopifyPhone } from "../src/lib/shopify/drafts";

// Made-up customers only. Phones use the 90000xxxxx test range.
const desk = { name: "Desk", slackUserId: null };

function store() {
  return new MemoryOpsStore({
    products: [
      { sku: "ep-dr-l50s-pu", name: "DREAME L50s Pro Ultra", brand: "Dreame", category: "Robot Vacuum", channel: "CnC", listPriceMinor: 8_000_000, gstRate: 0.18, hsn: null, eol: false, needsInstallation: true },
    ],
    movements: [],
    purchaseOrders: [],
  });
}

function sale(over: Partial<NewOrderInput> = {}): NewOrderInput {
  return {
    source: "slack",
    customerName: "Asha Test Rao",
    phone: "90000 12345",
    email: "asha@example.com",
    shippingAddress: "12 Test Road, Hebbal, Bengaluru",
    pincode: "560024",
    hub: "Hebbal",
    poc: "Ibrahim",
    declaredPaymentStatus: "Advance payment realized",
    declaredPaymentMode: "UPI",
    lines: [
      { sku: "ep-dr-l50s-pu", productName: "DREAME L50s Pro Ultra", listPriceMinor: 8_000_000, offeredPriceMinor: 7_500_000, installation: "Added" },
      { sku: null, productName: "Extra mop pads", listPriceMinor: null, offeredPriceMinor: 120_000 },
    ],
    ...over,
  };
}

/** A pretend Shopify: answers the queries we send and records what was asked. */
function fakeShopify(opts: { userErrors?: string[]; orders?: Array<{ name: string; tags: string[] }> } = {}) {
  const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
  let drafts = 0;
  const gql: Graphql = async <T>(query: string, variables: Record<string, unknown> = {}) => {
    calls.push({ query, variables });
    if (query.includes("productVariants")) {
      return { productVariants: { nodes: [{ id: "gid://shopify/ProductVariant/111", sku: "EP-DR-L50S-PU", price: "80000.00" }] } } as T;
    }
    if (query.includes("draftOrderCreate")) {
      if (opts.userErrors?.length) return { draftOrderCreate: { draftOrder: null, userErrors: opts.userErrors.map((message) => ({ field: null, message })) } } as T;
      drafts++;
      return { draftOrderCreate: { draftOrder: { id: `gid://shopify/DraftOrder/90${drafts}`, name: `#D${drafts}` }, userErrors: [] } } as T;
    }
    if (query.includes("TaggedOrders")) {
      return { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: opts.orders ?? [] } } as T;
    }
    throw new Error("unexpected query");
  };
  return { gql, calls };
}

test("phones are sent the way Shopify wants them", () => {
  assert.equal(shopifyPhone("90000 12345"), "+919000012345");
  assert.equal(shopifyPhone("+91 90000-12345"), "+919000012345");
  assert.equal(shopifyPhone("090000 12345"), "+919000012345");
  assert.equal(shopifyPhone("12345"), null);
  assert.equal(shopifyPhone(null), null);
});

test("the draft carries the deal price, customer, tags and add-ons", async () => {
  const s = store();
  const created = await createOrder(s, sale(), desk);
  assert.ok(created.ok);
  const variants = new Map([["ep-dr-l50s-pu", { id: "gid://shopify/ProductVariant/111", priceMinor: 8_000_000 }]]);
  const { input, lines, warnings } = draftInputFor(created.value, variants);
  const items = input.lineItems as Array<Record<string, unknown>>;
  // Matched product: Shopify's own variant with a discount down to the deal price (₹80,000 → ₹75,000 = 6.25%).
  assert.equal(items[0].variantId, "gid://shopify/ProductVariant/111");
  assert.deepEqual(items[0].appliedDiscount, { value: 6.25, valueType: "PERCENTAGE", title: "EPIK deal price" });
  assert.deepEqual(items[0].customAttributes, [{ key: "Installation", value: "Added" }]);
  // Unknown product: a custom item at the deal price.
  assert.equal(items[1].title, "Extra mop pads");
  assert.deepEqual(items[1].originalUnitPriceWithCurrency, { amount: "1200.00", currencyCode: "INR" });
  assert.equal(input.phone, "+919000012345");
  assert.equal(input.email, "asha@example.com");
  assert.deepEqual(input.tags, ["epik-ops", created.value.id, "cde-sale"]);
  assert.deepEqual(input.shippingAddress, { firstName: "Asha Test", lastName: "Rao", address1: "12 Test Road, Hebbal, Bengaluru", zip: "560024", countryCode: "IN", phone: "+919000012345" });
  assert.match(String(input.note), /Created by EPIK Ops from EPK-\d+ \(Slack sale by Ibrahim, Hebbal\)\. Check it, then click Complete\. Payment declared by the CDE: Advance payment realized, UPI\./);
  assert.equal(lines.filter((l) => l.matched).length, 1);
  assert.ok(warnings.some((w) => /no SKU yet/.test(w)));
});

test("a draft is created once, written to history, and never twice", async () => {
  const s = store();
  const created = await createOrder(s, sale(), desk);
  assert.ok(created.ok);
  const shop = fakeShopify();
  const first = await createShopifyDraft(s, shop.gql, created.value.id);
  assert.ok(first.ok, first.ok ? "" : first.message);
  assert.equal(first.ok && first.draftName, "#D1");
  const order = (await s.getOrder(created.value.id))!;
  assert.deepEqual(draftFromHistory(order), { name: "#D1", numericId: "901" });
  const again = await createShopifyDraft(s, shop.gql, created.value.id);
  assert.equal(again.ok, false);
  assert.match(again.message, /already exists/);
  assert.equal(shop.calls.filter((c) => c.query.includes("draftOrderCreate")).length, 1, "Shopify was asked to create exactly one draft");
});

test("no draft for cancelled or already-linked orders", async () => {
  const s = store();
  const a = await createOrder(s, sale(), desk);
  const b = await createOrder(s, sale({ shopifyOrderId: "#PIK4001" }), desk);
  assert.ok(a.ok && b.ok);
  await cancelOrder(s, a.value.id, "Customer changed mind", desk);
  const shop = fakeShopify();
  assert.match((await createShopifyDraft(s, shop.gql, a.value.id)).message, /cancelled/);
  assert.match((await createShopifyDraft(s, shop.gql, b.value.id)).message, /Already linked to Shopify #PIK4001/);
  assert.equal(shop.calls.length, 0, "Shopify was not contacted at all");
});

test("when Shopify refuses, the reason is in the history and a retry can still work", async () => {
  const s = store();
  const created = await createOrder(s, sale(), desk);
  assert.ok(created.ok);
  const refused = await createShopifyDraft(s, fakeShopify({ userErrors: ["Email is invalid"] }).gql, created.value.id);
  assert.equal(refused.ok, false);
  const order = (await s.getOrder(created.value.id))!;
  assert.ok(order.events.some((e) => e.type === "shopify_error" && /Email is invalid/.test(e.summary)));
  assert.equal(draftFromHistory(order), null);
  const retry = await createShopifyDraft(s, fakeShopify().gql, created.value.id);
  assert.ok(retry.ok, "the claim was released, so a second attempt goes through");
});

test("completed drafts link their #PIK number back, without overwriting", async () => {
  const s = store();
  const a = await createOrder(s, sale(), desk);
  const b = await createOrder(s, sale({ shopifyOrderId: "#PIK4001" }), desk);
  assert.ok(a.ok && b.ok);
  const shop = fakeShopify({
    orders: [
      { name: "#PIK5001", tags: ["epik-ops", a.value.id, "cde-sale"] },
      { name: "#PIK5002", tags: ["epik-ops", b.value.id] },
      { name: "#PIK5003", tags: ["epik-ops"] },
    ],
  });
  const result = await linkCompletedDrafts(s, shop.gql, new Date("2026-11-06T10:00:00Z"));
  assert.equal(result.checked, 3);
  assert.deepEqual(result.linked, [`${a.value.id} → #PIK5001`]);
  assert.equal((await s.getOrder(a.value.id))!.shopifyOrderId, "#PIK5001");
  assert.equal((await s.getOrder(b.value.id))!.shopifyOrderId, "#PIK4001", "an existing link is never overwritten");
  assert.match(String(shop.calls[0].variables.q), /^tag:epik-ops updated_at:>='2026-10-23/);
});

test("the Shopify connection can read and make drafts, and refuses anything else", async () => {
  let sent = 0;
  const fakeFetch = (async () => { sent++; return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }); }) as typeof fetch;
  const gql = shopifyGraphql({ domain: "test.myshopify.com", auth: { kind: "token", token: "t" }, apiVersion: "2026-10", slackSales: "off" as const, importFrom: null }, fakeFetch);
  await gql("query Read { shop { name } }");
  await gql("mutation CreateDraft($input: DraftOrderInput!) { draftOrderCreate(input: $input) { draftOrder { id } } }");
  await gql("mutation CompleteDraft($id: ID!) { draftOrderComplete(id: $id) { draftOrder { id } } }");
  await assert.rejects(gql("mutation { orderCancel(orderId: \"1\") { job { id } } }"), /Only reading, and creating or completing draft orders/);
  await assert.rejects(gql("mutation { productUpdate(input: {}) { product { id } } }"), /Only reading, and creating or completing draft orders/);
  await assert.rejects(gql("mutation { orderMarkAsPaid(input: {}) { order { id } } }"), /Only reading, and creating or completing draft orders/);
  assert.equal(sent, 3, "refused changes never reach Shopify");
});

test("Dev Dashboard apps: a 24-hour token is fetched with the client ID and secret, reused, then renewed", async () => {
  const calls: string[] = [];
  let issued = 0;
  const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/admin/oauth/access_token")) {
      calls.push(`token ${String(init?.body)}`);
      issued++;
      return new Response(JSON.stringify({ access_token: `tok${issued}`, scope: "read_orders", expires_in: 86399 }), { status: 200 });
    }
    calls.push(`graphql ${(init?.headers as Record<string, string>)["x-shopify-access-token"]}`);
    return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
  }) as typeof fetch;
  let clock = 1_000_000;
  const cfg = { domain: "cc-test.myshopify.com", auth: { kind: "client" as const, clientId: "id1", clientSecret: "sec1" }, apiVersion: "2026-10", slackSales: "off" as const, importFrom: null };
  const gql = shopifyGraphql(cfg, fakeFetch, () => clock);
  await gql("query A { shop { name } }");
  await gql("query B { shop { name } }");
  clock += 86_400_000; // a day later the token has expired
  await gql("query C { shop { name } }");
  assert.deepEqual(calls, [
    "token grant_type=client_credentials&client_id=id1&client_secret=sec1",
    "graphql tok1",
    "graphql tok1",
    "token grant_type=client_credentials&client_id=id1&client_secret=sec1",
    "graphql tok2",
  ]);
});

test("Shopify stays off until it has a store and a way in; auto drafts need their own switch", () => {
  assert.equal(shopifyConfigFromEnv({}), null);
  assert.equal(shopifyConfigFromEnv({ SHOPIFY_STORE_DOMAIN: "x.myshopify.com" }), null);
  assert.equal(shopifyConfigFromEnv({ SHOPIFY_STORE_DOMAIN: "x", SHOPIFY_CLIENT_ID: "id" }), null, "a client ID alone is not enough");
  assert.deepEqual(shopifyConfigFromEnv({ SHOPIFY_STORE_DOMAIN: "https://x.myshopify.com/", SHOPIFY_ADMIN_TOKEN: "t" }), { domain: "x.myshopify.com", auth: { kind: "token", token: "t" }, apiVersion: "2026-10", slackSales: "off" as const, importFrom: null });
  // The handle from the admin URL works, and client ID + secret win over an old token.
  assert.deepEqual(shopifyConfigFromEnv({ SHOPIFY_STORE_DOMAIN: "main-homified", SHOPIFY_CLIENT_ID: "id", SHOPIFY_CLIENT_SECRET: "sec", SHOPIFY_ADMIN_TOKEN: "t" })?.auth, { kind: "client", clientId: "id", clientSecret: "sec" });
  assert.equal(shopifyConfigFromEnv({ SHOPIFY_STORE_DOMAIN: "main-homified", SHOPIFY_CLIENT_ID: "id", SHOPIFY_CLIENT_SECRET: "sec" })?.domain, "main-homified.myshopify.com");
  const mode = (env: Record<string, string>) => shopifyConfigFromEnv({ SHOPIFY_STORE_DOMAIN: "x.myshopify.com", SHOPIFY_ADMIN_TOKEN: "t", ...env })?.slackSales;
  assert.equal(mode({}), "off");
  assert.equal(mode({ SHOPIFY_AUTO_DRAFTS: "true" }), "draft", "the older switch still means drafts");
  assert.equal(mode({ SHOPIFY_SLACK_SALES: "order" }), "order");
  assert.equal(mode({ SHOPIFY_SLACK_SALES: "Order ", SHOPIFY_AUTO_DRAFTS: "true" }), "order", "the new setting wins");
  assert.equal(mode({ SHOPIFY_SLACK_SALES: "yes" }), "off", "anything unclear is off");
});

// ── Website orders coming in from Shopify ────────────────────────────────────

import { importShopifyOrders, orderInputFor, practiceOrderNode, type ShopifyOrderNode } from "../src/lib/shopify/orders";

function shopOrder(over: Partial<ShopifyOrderNode> = {}): ShopifyOrderNode {
  return {
    name: "#PIK6001",
    createdAt: "2026-11-05T09:00:00Z",
    cancelledAt: null,
    sourceName: "283712782337",
    app: { name: "Epik" },
    displayFinancialStatus: "PAID",
    paymentGatewayNames: ["juspay"],
    totalPriceSet: { shopMoney: { amount: "75000.00" } },
    totalOutstandingSet: { shopMoney: { amount: "0.00" } },
    email: "web@example.com",
    phone: "+919000054321",
    tags: ["juspay"],
    shippingAddress: { name: "Web Test Buyer", address1: "5 Sample Street", address2: null, city: "Bengaluru", province: "Karnataka", zip: "560034", phone: null },
    billingAddress: null,
    lineItems: { nodes: [{ title: "DREAME L50s Pro Ultra", sku: "EP-DR-L50S-PU", quantity: 1, discountedTotalSet: { shopMoney: { amount: "75000.00" } } }] },
    ...over,
  };
}

const FROM = { importFrom: "2026-11-01" };

test("a new website order comes into the dashboard once, waiting for RevOps", async () => {
  const s = store();
  const first = await importShopifyOrders(s, [shopOrder()], FROM);
  assert.equal(first.created.length, 1);
  const order = (await s.findOrderByShopify("#PIK6001"))!;
  const detail = (await s.getOrder(order.id))!;
  assert.equal(detail.stage, "awaiting_payment", "RevOps still confirms the money");
  assert.equal(detail.paidMinor, 0, "Shopify's 'paid' is shown, not counted as verified");
  assert.equal(detail.customerName, "Web Test Buyer");
  assert.equal(detail.phone, "+919000054321");
  assert.equal(detail.saleSource, "Website");
  assert.equal(detail.shippingAddress, "5 Sample Street, Bengaluru, Karnataka");
  assert.equal(detail.declaredPaymentStatus, "Shopify: paid, ₹75,000 paid");
  assert.equal(detail.lines[0].sku, "ep-dr-l50s-pu");
  assert.equal(detail.lines[0].offeredPriceMinor, 7_500_000);
  assert.equal(detail.offeredTotalMinor, 7_500_000);
  const again = await importShopifyOrders(s, [shopOrder()], FROM);
  assert.equal(again.created.length, 0, "never added twice");
});

test("old orders, already-cancelled orders and our own drafts are left alone", async () => {
  const s = store();
  const result = await importShopifyOrders(s, [
    shopOrder({ name: "#PIK5000", createdAt: "2026-10-20T09:00:00Z" }),
    shopOrder({ name: "#PIK6002", cancelledAt: "2026-11-05T10:00:00Z" }),
    shopOrder({ name: "#PIK6003", tags: ["epik-ops", "EPK-000001"], sourceName: "shopify_draft_order", app: { name: "Draft Orders" } }),
  ], FROM);
  assert.equal(result.created.length, 0);
  assert.equal(result.skipped, 3);
});

test("India time decides 'new': 1 am IST on the start date counts", async () => {
  const s = store();
  // 2026-11-05T19:30Z is 6 Nov, 1:00 am in India.
  const result = await importShopifyOrders(s, [shopOrder({ createdAt: "2026-11-05T19:30:00Z" })], { importFrom: "2026-11-06" });
  assert.equal(result.created.length, 1);
});

test("Sagepilot chat orders are labelled as such", () => {
  assert.equal(orderInputFor(shopOrder({ app: { name: "Sagepilot AI - GetEpik" } }), "Sagepilot").saleSource, "Sagepilot");
});

test("a draft the team typed by hand links its #PIK to the Slack sale, only on a single sure match", async () => {
  const s = store();
  const slackSale = await createOrder(s, sale({ phone: "90000 54321", createdAt: "2026-11-05T08:00:00Z", lines: [{ sku: "ep-dr-l50s-pu", productName: "DREAME", listPriceMinor: null, offeredPriceMinor: 7_500_000 }] }), desk);
  assert.ok(slackSale.ok);
  const typed = shopOrder({ name: "#PIK6010", sourceName: "shopify_draft_order", app: { name: "Draft Orders" }, tags: [] });
  const result = await importShopifyOrders(s, [typed], FROM);
  assert.deepEqual(result.linked, [`${slackSale.value.id} → #PIK6010`]);
  assert.equal(result.created.length, 0, "a typed draft never becomes a second order");
  assert.equal((await s.getOrder(slackSale.value.id))!.shopifyOrderId, "#PIK6010");
});

test("no link when two sales could match, or the amount is off", async () => {
  const s = store();
  for (let i = 0; i < 2; i++) await createOrder(s, sale({ phone: "90000 54321", createdAt: "2026-11-05T08:00:00Z", lines: [{ sku: null, productName: "X", listPriceMinor: null, offeredPriceMinor: 7_500_000 }] }), desk);
  const typed = shopOrder({ name: "#PIK6011", sourceName: "shopify_draft_order", app: { name: "Draft Orders" }, tags: [] });
  assert.equal((await importShopifyOrders(s, [typed], FROM)).linked.length, 0, "two candidates: leave it");
  const s2 = store();
  await createOrder(s2, sale({ phone: "90000 54321", createdAt: "2026-11-05T08:00:00Z", lines: [{ sku: null, productName: "X", listPriceMinor: null, offeredPriceMinor: 3_000_000 }] }), desk);
  assert.equal((await importShopifyOrders(s2, [typed], FROM)).linked.length, 0, "₹30,000 vs ₹75,000: not the same sale");
});

test("a cancellation on Shopify adds one note to orders it brought in, and never touches older ones", async () => {
  const s = store();
  await importShopifyOrders(s, [shopOrder()], FROM);
  const old = await createOrder(s, sale({ shopifyOrderId: "#PIK6020", createdAt: "2026-11-05T08:00:00Z" }), desk);
  assert.ok(old.ok);
  const cancelled = [shopOrder({ cancelledAt: "2026-11-06T10:00:00Z" }), shopOrder({ name: "#PIK6020", cancelledAt: "2026-11-06T10:00:00Z" })];
  const first = await importShopifyOrders(s, cancelled, FROM);
  const second = await importShopifyOrders(s, cancelled, FROM);
  assert.equal(first.flagged.length, 1);
  assert.equal(second.flagged.length, 0, "the note is added once");
  const imported = (await s.getOrder((await s.findOrderByShopify("#PIK6001"))!.id))!;
  assert.equal(imported.stage, "awaiting_payment", "nothing is cancelled automatically");
  assert.ok(imported.events.some((e) => e.type === "shopify_cancelled"));
  assert.ok(!(await s.getOrder(old.value.id))!.events.some((e) => e.type === "shopify_cancelled"), "an order we didn't import is left alone");
});

// ── Slack sale → a real Shopify order with payment pending ───────────────────

import { pushOrderToShopify, shopifyThreadNote, DUE_ON_RECEIPT } from "../src/lib/shopify/drafts";
import { catalogItems, type ShopifyVariantNode } from "../src/lib/shopify/catalog";
import { productSuggestions, warmProductCatalogue } from "../src/lib/slack/ops-actions";

/** A pretend Shopify that can also complete drafts. */
function orderShop(opts: { termsRefused?: boolean; completeError?: string } = {}) {
  const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
  let drafts = 0;
  const gql: Graphql = async <T>(query: string, variables: Record<string, unknown> = {}) => {
    calls.push({ query, variables });
    if (query.includes("productVariants")) {
      return { productVariants: { nodes: [{ id: "gid://shopify/ProductVariant/111", sku: "EP-DR-L50S-PU", price: "80000.00" }] } } as T;
    }
    if (query.includes("draftOrderCreate")) {
      const input = variables.input as Record<string, unknown>;
      if (input.paymentTerms && opts.termsRefused) {
        return { draftOrderCreate: { draftOrder: null, userErrors: [{ field: null, message: "The user must have access to set payment terms." }] } } as T;
      }
      drafts++;
      return { draftOrderCreate: { draftOrder: { id: `gid://shopify/DraftOrder/80${drafts}`, name: `#D${drafts}`, paymentTerms: input.paymentTerms ? { id: "gid://shopify/PaymentTerms/1" } : null }, userErrors: [] } } as T;
    }
    if (query.includes("draftOrderComplete")) {
      if (opts.completeError) return { draftOrderComplete: { draftOrder: null, userErrors: [{ message: opts.completeError }] } } as T;
      return { draftOrderComplete: { draftOrder: { id: variables.id, order: { id: "gid://shopify/Order/7001", name: "#PIK7001" } }, userErrors: [] } } as T;
    }
    throw new Error("unexpected query");
  };
  return { gql, calls, created: () => drafts };
}

test("order mode: the Slack sale becomes a Shopify order with payment pending and gets its #PIK straight away", async () => {
  const s = store();
  const created = await createOrder(s, sale(), desk);
  assert.ok(created.ok);
  const shop = orderShop();
  const outcome = await pushOrderToShopify(s, shop.gql, created.value.id, "order");
  assert.deepEqual(outcome, { ok: true, message: "Shopify order #PIK7001 created, payment pending.", draftName: "#D1", orderName: "#PIK7001" });
  const input = shop.calls.find((c) => c.query.includes("draftOrderCreate"))!.variables.input as Record<string, unknown>;
  assert.deepEqual(input.paymentTerms, { paymentTermsTemplateId: DUE_ON_RECEIPT }, "due on receipt, so Shopify shows payment pending");
  assert.match(String(input.note), /Payment pending until RevOps confirms it\. Payment declared by the CDE: Advance payment realized, UPI\./);
  assert.equal(shop.calls.find((c) => c.query.includes("draftOrderComplete"))!.variables.id, "gid://shopify/DraftOrder/801");
  const order = (await s.getOrder(created.value.id))!;
  assert.equal(order.shopifyOrderId, "#PIK7001");
  assert.equal(order.stage, "awaiting_payment", "Shopify's order does not count as paid here: RevOps still checks");
  assert.equal(order.paidMinor, 0);
  // Never twice.
  const again = await pushOrderToShopify(s, shop.gql, created.value.id, "order");
  assert.equal(again.ok, false);
  assert.equal(shop.created(), 1);
  assert.equal(shopifyThreadNote(outcome), "Shopify order #PIK7001 created, payment pending.");
});

test("order mode without the payment terms permission stops at a draft and never completes it", async () => {
  const s = store();
  const created = await createOrder(s, sale(), desk);
  assert.ok(created.ok);
  const shop = orderShop({ termsRefused: true });
  const outcome = await pushOrderToShopify(s, shop.gql, created.value.id, "order");
  assert.ok(outcome.ok);
  assert.equal(outcome.orderName, null);
  assert.ok(!shop.calls.some((c) => c.query.includes("draftOrderComplete")), "completing without payment terms would mark it paid");
  const order = (await s.getOrder(created.value.id))!;
  assert.equal(order.shopifyOrderId, null);
  assert.equal(draftFromHistory(order)?.name, "#D1");
  assert.ok(order.events.some((e) => e.type === "shopify_error" && /write_payment_terms/.test(e.summary)));
  assert.match(shopifyThreadNote(outcome), /^Shopify draft #D1 made\./);
});

test("if completing fails, the draft is kept and no second one is ever made", async () => {
  const s = store();
  const created = await createOrder(s, sale(), desk);
  assert.ok(created.ok);
  const shop = orderShop({ completeError: "Shopify is busy" });
  const first = await pushOrderToShopify(s, shop.gql, created.value.id, "order");
  assert.equal(first.ok, false);
  assert.match(shopifyThreadNote(first), /^Shopify order not made: Draft #D1 made but not completed: Shopify is busy/);
  const second = await pushOrderToShopify(s, shop.gql, created.value.id, "order");
  assert.equal(second.ok, false);
  assert.match(second.message, /already exists/);
  assert.equal(shop.created(), 1);
});

// ── The Shopify product list in the Slack form ───────────────────────────────

function variant(sku: string | null, title: string, status = "ACTIVE", variantTitle = "Default Title", price = "1000.00"): ShopifyVariantNode {
  return { id: `gid://shopify/ProductVariant/${sku ?? "x"}-${status}`, sku, title: variantTitle, price, product: { title, status, productType: "Robot Vacuum" } };
}

test("the Shopify catalogue becomes product-list rows: no SKU, archived and duplicates are handled", () => {
  const items = catalogItems([
    variant("EP-DR-L50S-PU", "DREAME L50s Pro Ultra Robot Vacuum and Mop", "ACTIVE", "Default Title", "79999.00"),
    variant("ep-ap-i15-128-bl", "Apple iPhone 15", "DRAFT", "128 GB / Blue"),
    variant(null, "No SKU thing"),
    variant("ep-old", "Old thing", "ARCHIVED"),
    variant("ep-dup", "Dup draft", "DRAFT"),
    variant("ep-dup", "Dup live", "ACTIVE"),
  ]);
  assert.deepEqual(items.map((i) => [i.sku, i.name, i.status]), [
    ["ep-dr-l50s-pu", "DREAME L50s Pro Ultra Robot Vacuum and Mop", "ACTIVE"],
    ["ep-ap-i15-128-bl", "Apple iPhone 15 - 128 GB / Blue", "DRAFT"],
    ["ep-dup", "Dup live", "ACTIVE"],
  ]);
  assert.equal(items[0].priceMinor, 7_999_900);
  assert.equal(items[0].needsInstallation, true);
  assert.equal(items[1].needsInstallation, false);
});

test("copying the catalogue keeps our own product details, adds new SKUs and unmarks ones gone from Shopify", async () => {
  const s = new MemoryOpsStore({
    products: [
      { sku: "ep-dr-l50s-pu", name: "Dreame L50s (sheet name)", brand: "Dreame", category: "Robot Vacuum", channel: "CnC", listPriceMinor: 8_000_000, gstRate: 0.18, hsn: "85081100", eol: false, needsInstallation: true },
      { sku: "ep-sheet-only", name: "Sheet only cable", brand: null, category: null, channel: null, listPriceMinor: null, gstRate: null, hsn: null, eol: false, needsInstallation: false },
      { sku: "ep-gone", name: "Gone from Shopify", brand: null, category: null, channel: null, listPriceMinor: null, gstRate: null, hsn: null, eol: false, needsInstallation: false, shopifyVariantId: "gid://shopify/ProductVariant/9", shopifyStatus: "ACTIVE" },
    ],
    movements: [],
    purchaseOrders: [],
  });
  const result = await s.applyShopifyCatalog(catalogItems([
    variant("ep-dr-l50s-pu", "DREAME L50s Pro Ultra Robot Vacuum and Mop", "ACTIVE", "Default Title", "79999.00"),
    variant("ep-na-fxp", "NARWAL Freo X Plus Robotic Vacuum", "DRAFT"),
  ]));
  assert.deepEqual(result, { added: 1, updated: 1, removed: 1 });
  const dreame = (await s.getProduct("ep-dr-l50s-pu"))!;
  assert.equal(dreame.name, "DREAME L50s Pro Ultra Robot Vacuum and Mop");
  assert.equal(dreame.listPriceMinor, 7_999_900);
  assert.equal(dreame.hsn, "85081100", "our own details stay");
  assert.equal(dreame.needsInstallation, true);
  assert.equal((await s.getProduct("ep-na-fxp"))!.needsInstallation, true);
  assert.equal((await s.getProduct("ep-gone"))!.shopifyVariantId, null);

  // The Slack product picker shows Shopify's products only, website ones first...
  const robots = (await productSuggestions(s, "robot")).options.map((o) => o.value);
  assert.deepEqual(robots, ["ep-dr-l50s-pu", "ep-na-fxp"]);
  // ...and falls back to the full list when nothing in Shopify matches.
  assert.deepEqual((await productSuggestions(s, "cable")).options.map((o) => o.value), ["ep-sheet-only"]);
});

test("a big backlog of website orders comes in a few per run, never twice", async () => {
  const s = store();
  const nodes = Array.from({ length: 5 }, (_, i) => shopOrder({ name: `#PIK70${i}0` }));
  const first = await importShopifyOrders(s, nodes, { importFrom: "2026-11-01", maxNew: 2 });
  assert.equal(first.created.length, 2);
  const second = await importShopifyOrders(s, nodes, { importFrom: "2026-11-01", maxNew: 2 });
  assert.equal(second.created.length, 2);
  const third = await importShopifyOrders(s, nodes, { importFrom: "2026-11-01", maxNew: 2 });
  assert.equal(third.created.length, 1);
  for (let i = 0; i < 5; i++) assert.ok(await s.findOrderByShopify(`#PIK70${i}0`));
});


// ── Website sale (Slack short form) credited when the website order arrives ──

import { clearTestOrders, creditEarlierWebsiteOrder, recordWebSale } from "../src/lib/ops/service";

test("a CDE's website sale is credited when the website order with that phone arrives", async () => {
  const s = store();
  const saved = await recordWebSale(s, { customerName: "Ravi Test", phone: "+91 90000 22222", sku: "ep-dr-l50s-pu", productName: "DREAME L50s Pro Ultra", poc: "Ibrahim", saleSource: "Home Demo", notes: null, slackChannelId: "CSALES", slackMessageTs: "1.1", createdBy: "USALES0001" });
  assert.ok(saved.ok);
  const order = shopOrder({ name: "#PIK8001", createdAt: new Date().toISOString(), phone: "+919000022222" });
  const result = await importShopifyOrders(s, [order], FROM);
  assert.equal(result.created.length, 1);
  assert.deepEqual(result.matched.map((m) => [m.shopifyName, m.poc, m.slackMessageTs]), [["#PIK8001", "Ibrahim", "1.1"]]);
  const imported = (await s.getOrder((await s.findOrderByShopify("#PIK8001"))!.id))!;
  assert.equal(imported.poc, "Ibrahim");
  assert.equal(imported.saleSource, "Home Demo");
  assert.match(imported.notes ?? "", /Sold by Ibrahim \(Home Demo\)/);
  // Used once: a second website order from the same phone is not credited again.
  const again = await importShopifyOrders(s, [shopOrder({ name: "#PIK8002", createdAt: new Date().toISOString(), phone: "+919000022222" })], FROM);
  assert.equal(again.matched.length, 0);
});

test("a website sale is not credited to an order from another phone or long after", async () => {
  const s = store();
  await recordWebSale(s, { customerName: "Ravi Test", phone: "9000033333", sku: null, productName: "Something", poc: "Ibrahim", saleSource: "Virtual Demo", notes: null, slackChannelId: "CSALES", slackMessageTs: "2.2", createdBy: "USALES0001" });
  const other = await importShopifyOrders(s, [shopOrder({ name: "#PIK8101", createdAt: new Date().toISOString(), phone: "+919000044444" })], FROM);
  assert.equal(other.matched.length, 0);
  const late = await importShopifyOrders(s, [shopOrder({ name: "#PIK8102", createdAt: new Date(Date.now() + 10 * 86_400_000).toISOString(), phone: "+919000033333" })], FROM);
  assert.equal(late.matched.length, 0, "more than a week later is not this sale");
  const bad = await recordWebSale(s, { customerName: "X Y", phone: "12345", sku: null, productName: "Thing", poc: "Ibrahim", saleSource: null, notes: null, slackChannelId: null, slackMessageTs: null, createdBy: null });
  assert.equal(bad.ok, false);
});

test("the Slack product picker reads the Shopify list from the database once, then searches it in memory", async () => {
  const s = new MemoryOpsStore({
    products: [
      { sku: "ep-ap-ip15-128-bk", name: "Apple iPhone 15 (128 GB) - Black", brand: "Apple", category: null, channel: null, listPriceMinor: 6_990_000, gstRate: null, hsn: null, eol: false, needsInstallation: false, shopifyVariantId: "gid://shopify/ProductVariant/1", shopifyStatus: "ACTIVE" },
      { sku: "ep-dr-sol-1l", name: "Dreame Cleaning Solution (1L)", brand: "Dreame", category: null, channel: null, listPriceMinor: 129_900, gstRate: null, hsn: null, eol: false, needsInstallation: false, shopifyVariantId: "gid://shopify/ProductVariant/2", shopifyStatus: "DRAFT" },
    ],
    movements: [],
    purchaseOrders: [],
  });
  let loads = 0;
  const load = s.shopifyProducts.bind(s);
  s.shopifyProducts = async () => (loads++, load());
  await warmProductCatalogue(s);
  assert.deepEqual((await productSuggestions(s, "ip")).options.map((o) => o.value), ["ep-ap-ip15-128-bk"]);
  assert.deepEqual((await productSuggestions(s, "DREAME sol")).options.map((o) => o.value), ["ep-dr-sol-1l"]);
  assert.deepEqual((await productSuggestions(s, "")).options.map((o) => o.value), ["ep-ap-ip15-128-bk", "ep-dr-sol-1l"], "website products first");
  assert.equal(loads, 1, "one database read for all searches");
  // After 6 hours the list is read again.
  await warmProductCatalogue(s, Date.now() + 7 * 60 * 60 * 1000);
  assert.equal(loads, 2);
});

test("website order first, form a few minutes later: the order is credited when the form is posted", async () => {
  const s = store();
  const actor = { name: "Ibrahim", slackUserId: "USALES0001" };
  await importShopifyOrders(s, [shopOrder({ name: "#PIK8201", createdAt: new Date(Date.now() - 5 * 60_000).toISOString(), phone: "+919000055555" })], FROM);
  await importShopifyOrders(s, [shopOrder({ name: "#PIK8202", createdAt: new Date().toISOString(), phone: "+919000066666" })], FROM);
  const saved = await recordWebSale(s, { customerName: "Ravi", phone: "90000 55555", sku: null, productName: "Dreame", poc: "Ibrahim", saleSource: "Home Demo", notes: "Demo at home", slackChannelId: "CSALES", slackMessageTs: "3.3", createdBy: "USALES0001" });
  assert.ok(saved.ok);
  const credited = await creditEarlierWebsiteOrder(s, saved.value, actor);
  assert.ok(credited);
  assert.equal(credited.shopifyName, "#PIK8201");
  const order = (await s.getOrder(credited.orderId))!;
  assert.equal(order.poc, "Ibrahim");
  assert.equal(order.saleSource, "Home Demo");
  assert.match(order.notes ?? "", /Sold by Ibrahim \(Home Demo\): website sale posted in Slack\. CDE note: Demo at home/);
  // Once only: a second form for the same phone finds nothing left to credit.
  const second = await recordWebSale(s, { customerName: "Ravi", phone: "9000055555", sku: null, productName: "Dreame", poc: "Someone", saleSource: "Virtual Demo", notes: null, slackChannelId: "CSALES", slackMessageTs: "3.4", createdBy: "U2" });
  assert.ok(second.ok);
  assert.equal(await creditEarlierWebsiteOrder(s, second.value, actor), null);
  // A form with a phone that has no website order credits nothing.
  const none = await recordWebSale(s, { customerName: "Asha", phone: "9000077777", sku: null, productName: "Dreame", poc: "Ibrahim", saleSource: null, notes: null, slackChannelId: "CSALES", slackMessageTs: "3.5", createdBy: "U1" });
  assert.ok(none.ok);
  assert.equal(await creditEarlierWebsiteOrder(s, none.value, actor), null);
});

test("a practice website order runs the real import and CDE credit, and is a test order", async () => {
  const s = store();
  const saved = await recordWebSale(s, { customerName: "TEST Ravi", phone: "9000088888", sku: null, productName: "Dreame", poc: "Ibrahim", saleSource: "Virtual Demo", notes: null, slackChannelId: "CSALES", slackMessageTs: "4.4", createdBy: "U1" });
  assert.ok(saved.ok);
  const node = practiceOrderNode("9000088888", { sku: "ep-dr-sol-1l", name: "Dreame Cleaning Solution (1L)", priceMinor: 129_900 });
  assert.match(node.name, /^#TEST-/);
  const result = await importShopifyOrders(s, [node], { importFrom: "2026-01-01" });
  assert.deepEqual(result.matched.map((m) => m.poc), ["Ibrahim"]);
  const order = (await s.getOrder((await s.findOrderByShopify(node.name))!.id))!;
  assert.equal(order.customerName, "TEST Website customer");
  assert.equal(order.poc, "Ibrahim");
  assert.equal(order.offeredTotalMinor, 129_900);
  const cleared = await clearTestOrders(s, { name: "Desk", slackUserId: null });
  assert.ok(cleared.ok);
  assert.equal(await s.getOrder(order.id), null);
});

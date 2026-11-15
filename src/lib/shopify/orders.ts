// Shopify orders → EPIK Ops. Read-only on the Shopify side.
// Website orders (and Sagepilot chat orders) become dashboard orders; drafts typed by the team are never
// duplicated, only linked to the Slack sale they came from when the match is certain.

import { formatInrFromMinor, isoDateInIst } from "@/lib/format";
import { modeFromGateway } from "@/lib/ops/payment-status";
import { cancelOrder, createOrder, findWebSale, recordShopifyEvent, setShopifyId } from "@/lib/ops/service";
import { isTestName } from "@/lib/ops/test-mode";
import type { OpsStore } from "@/lib/ops/store";
import type { NewOrderInput, Order } from "@/lib/ops/types";
import type { Graphql } from "./client";
import { EPIK_TAG, SHOPIFY_ACTOR, shopifyPhone } from "./drafts";

export type ShopifyOrderNode = {
  name: string;
  createdAt: string;
  cancelledAt: string | null;
  sourceName: string | null;
  app: { name: string } | null;
  displayFinancialStatus: string | null;
  paymentGatewayNames: string[];
  totalPriceSet: { shopMoney: { amount: string } };
  totalOutstandingSet: { shopMoney: { amount: string } };
  email: string | null;
  phone: string | null;
  tags: string[];
  shippingAddress: { name: string | null; address1: string | null; address2: string | null; city: string | null; province: string | null; zip: string | null; phone: string | null } | null;
  billingAddress: { name: string | null } | null;
  lineItems: { nodes: Array<{ title: string; sku: string | null; quantity: number; discountedTotalSet: { shopMoney: { amount: string } } }> };
};

const RECENT_ORDERS = `query RecentOrders($q: String!, $after: String) {
  orders(first: 100, after: $after, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      name createdAt cancelledAt sourceName app { name }
      displayFinancialStatus paymentGatewayNames
      totalPriceSet { shopMoney { amount } }
      totalOutstandingSet { shopMoney { amount } }
      email phone tags
      shippingAddress { name address1 address2 city province zip phone }
      billingAddress { name }
      lineItems(first: 30) { nodes { title sku quantity discountedTotalSet { shopMoney { amount } } } }
    }
  }
}`;

/** Orders created or changed since `sinceIso`, oldest first. */
export async function fetchRecentOrders(gql: Graphql, sinceIso: string): Promise<ShopifyOrderNode[]> {
  const out: ShopifyOrderNode[] = [];
  let after: string | null = null;
  for (let page = 0; page < 20; page++) {
    const data: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ShopifyOrderNode[] } } = await gql(RECENT_ORDERS, { q: `updated_at:>='${sinceIso}'`, after });
    out.push(...data.orders.nodes);
    if (!data.orders.pageInfo.hasNextPage) break;
    after = data.orders.pageInfo.endCursor;
  }
  return out;
}

const minor = (amount: string | undefined) => Math.round(Number(amount ?? 0) * 100);
const tenDigits = (raw: string | null) => (shopifyPhone(raw) ?? "").slice(-10);

/** Drafts the team typed into Shopify by hand (today's CDE sales) and drafts made by EPIK Ops. */
export function isTypedDraft(o: ShopifyOrderNode): boolean {
  return o.sourceName === "shopify_draft_order" || o.app?.name === "Draft Orders";
}

/** Which channel an imported order belongs to, as shown on the dashboard. */
export function channelOf(o: ShopifyOrderNode): string {
  const app = o.app?.name ?? "";
  if (/sagepilot/i.test(app)) return "Sagepilot";
  if (o.sourceName === "pos") return "Store (POS)";
  if (isTypedDraft(o)) return "Draft Orders";
  return "Website";
}

/** The dashboard order for a Shopify website order. Pure: unit-tested without Shopify. */
export function orderInputFor(o: ShopifyOrderNode, channel: string): NewOrderInput {
  const ship = o.shippingAddress;
  const phone = shopifyPhone(o.phone) ?? shopifyPhone(ship?.phone ?? null);
  const total = minor(o.totalPriceSet.shopMoney.amount);
  const outstanding = minor(o.totalOutstandingSet.shopMoney.amount);
  const paid = Math.max(0, total - outstanding);
  const gateways = [...new Set(o.paymentGatewayNames.map((g) => g.toLowerCase()))].join(" + ");
  const status = (o.displayFinancialStatus ?? "").toLowerCase().replace(/_/g, " ");
  const rupees = (m: number) => `₹${(m / 100).toLocaleString("en-IN")}`;
  return {
    source: "import",
    customerName: (ship?.name || o.billingAddress?.name || "Website customer").trim(),
    phone,
    email: o.email,
    shippingAddress: ship ? [ship.address1, ship.address2, ship.city, ship.province].filter(Boolean).join(", ") || null : null,
    pincode: ship?.zip ?? null,
    hub: null,
    poc: channel,
    saleSource: channel,
    declaredPaymentStatus: status ? `Shopify: ${status}${paid ? `, ${rupees(paid)} paid` : ""}` : null,
    declaredPaymentMode: gateways || null,
    notes: `Came in from Shopify ${o.name} (${channel}). Shopify shows ${status || "no payment status"}${gateways ? ` via ${gateways}` : ""}: ${rupees(paid)} paid of ${rupees(total)}. ${paidOf(o) > 0 ? "Paid on Shopify, so it went straight to logistics." : "Sales approves the payment before it moves on."}`,
    shopifyOrderId: o.name,
    createdBy: "Shopify",
    createdAt: o.createdAt,
    // Paid or partly paid on Shopify: followShopifyPayment records it and sends it to logistics right after.
    stage: "awaiting_payment",
    lines: o.lineItems.nodes.filter((l) => l.quantity > 0).map((l) => ({
      sku: l.sku?.trim().toLowerCase() || null,
      productName: l.title,
      qty: l.quantity,
      listPriceMinor: null,
      offeredPriceMinor: minor(l.discountedTotalSet.shopMoney.amount),
    })),
  };
}

/** Fully paid on Shopify (nothing outstanding). */
export function shopifyPaid(o: Pick<ShopifyOrderNode, "displayFinancialStatus" | "totalPriceSet" | "totalOutstandingSet">): boolean {
  const total = minor(o.totalPriceSet.shopMoney.amount);
  const outstanding = minor(o.totalOutstandingSet.shopMoney.amount);
  return (o.displayFinancialStatus ?? "").toUpperCase() === "PAID" || (total > 0 && outstanding <= 0);
}

/** A website order credited to the CDE who posted its website sale in Slack. */
export type WebSaleMatch = { orderId: string; shopifyName: string; poc: string; slackChannelId: string | null; slackMessageTs: string | null };

export type ImportResult = {
  created: string[];
  linked: string[];
  /** Cancelled on Shopify after it left the warehouse: someone must look. */
  flagged: string[];
  /** Website orders cancelled on Shopify, so cancelled here too (stock freed). */
  cancelled: string[];
  /** Website orders whose Shopify payment status changed. */
  paymentUpdated: string[];
  skipped: number;
  matched: WebSaleMatch[];
};

/**
 * One pass over recent Shopify orders. Only orders created on or after `importFrom` are looked at:
 * older orders (already handled in the sheets) are left alone completely.
 * - website / Sagepilot orders become dashboard orders (once, ever);
 * - drafts typed by the team get their #PIK filled on the matching Slack sale, only when exactly one
 *   order matches by phone, date and amount, and only into an empty field;
 * - a cancellation on Shopify of an order this importer brought in adds a note for RevOps.
 *   Nothing is cancelled automatically.
 */
/**
 * A website order already on the dashboard: if Shopify cancelled it, cancel it here too (frees stock), unless it
 * already left the warehouse, then flag it. If its Shopify payment status changed, show the new one. Read only.
 */
async function followShopify(store: OpsStore, existing: Order, o: ShopifyOrderNode, result: ImportResult): Promise<void> {
  if (o.cancelledAt && existing.stage !== "cancelled") {
    const order = await store.getOrder(existing.id);
    if (!order || order.events.some((e) => e.type === "shopify_cancelled")) return;
    const cancelled = existing.stage !== "out_for_delivery" && existing.stage !== "delivered"
      ? await cancelOrder(store, existing.id, `Cancelled on Shopify (${o.name})`, SHOPIFY_ACTOR)
      : null;
    if (cancelled?.ok) {
      await recordShopifyEvent(store, existing.id, "shopify_cancelled", `Cancelled on Shopify (${o.name}), so cancelled here and its stock freed.`, SHOPIFY_ACTOR);
      result.cancelled.push(existing.id);
    } else {
      await recordShopifyEvent(store, existing.id, "shopify_cancelled", `Cancelled on Shopify (${o.name}) but it is already ${existing.stage === "delivered" ? "delivered" : "out for delivery"}. Check it.`, SHOPIFY_ACTOR);
      result.flagged.push(existing.id);
    }
    return;
  }
  const declared = orderInputFor(o, channelOf(o)).declaredPaymentStatus ?? null;
  if (declared && declared !== existing.declaredPaymentStatus && existing.stage !== "cancelled") {
    await store.updateOrder(existing.id, { declaredPaymentStatus: declared });
    await recordShopifyEvent(store, existing.id, "shopify_payment", `Shopify payment now: ${declared.replace(/^Shopify:\s*/, "")}.`, SHOPIFY_ACTOR);
    result.paymentUpdated.push(existing.id);
  }
}

/** Money paid on Shopify for this order (total minus what is still outstanding). */
function paidOf(o: Pick<ShopifyOrderNode, "totalPriceSet" | "totalOutstandingSet">): number {
  return Math.max(0, minor(o.totalPriceSet.shopMoney.amount) - minor(o.totalOutstandingSet.shopMoney.amount));
}

/**
 * Shopify is the truth for money: when Shopify shows more paid than the dashboard has, the difference is recorded
 * as a payment from Shopify. Paid or partly paid means the payment is approved, so the order goes to logistics.
 * Only ever adds money (the app never takes a payment away because Shopify shows less).
 */
export async function followShopifyPayment(store: OpsStore, existing: Pick<Order, "id" | "stage" | "paidMinor" | "offeredTotalMinor">, o: ShopifyOrderNode, result?: ImportResult): Promise<void> {
  if (existing.stage === "cancelled" || o.cancelledAt) return;
  const shopPaid = paidOf(o);
  if (shopPaid > existing.paidMinor && (await store.claimAction(`shopify-paid:${o.name}:${shopPaid}`))) {
    const amount = shopPaid - existing.paidMinor;
    const total = minor(o.totalPriceSet.shopMoney.amount);
    const gateways = [...new Set(o.paymentGatewayNames.map((g) => g.toLowerCase()))].join(" + ");
    await store.insertPayment({ orderId: existing.id, amountMinor: amount, mode: modeFromGateway(gateways) ?? "Other", kind: shopPaid >= total ? "full" : "advance", reference: o.name, status: "verified", recordedBy: "Shopify" });
    await store.updateOrder(existing.id, { paidMinor: shopPaid, codDueMinor: Math.max(0, existing.offeredTotalMinor - shopPaid) });
    await recordShopifyEvent(store, existing.id, "shopify_payment", `Paid on Shopify: ${formatInrFromMinor(amount)}${gateways ? ` via ${gateways}` : ""}. Now ${formatInrFromMinor(shopPaid)} of ${formatInrFromMinor(total)}.`, SHOPIFY_ACTOR);
    if (result && !result.paymentUpdated.includes(existing.id)) result.paymentUpdated.push(existing.id);
  }
  if (existing.stage === "awaiting_payment" && shopPaid > 0) {
    const moved = await store.updateOrder(existing.id, { stage: "awaiting_inventory" }, "awaiting_payment");
    if (moved) await recordShopifyEvent(store, existing.id, "shopify_payment", `${shopPaid >= minor(o.totalPriceSet.shopMoney.amount) ? "Paid" : "Partly paid"} on Shopify, so the payment is approved. Sent to logistics.`, SHOPIFY_ACTOR);
  }
}

/** A typed Shopify draft with no Slack sale yet waits this long before it becomes a dashboard order of its own. */
export const TYPED_DRAFT_WAIT_MS = 3 * 3_600_000;

export async function importShopifyOrders(store: OpsStore, nodes: ShopifyOrderNode[], opts: { importFrom: string; maxNew?: number; now?: Date }): Promise<ImportResult> {
  const result: ImportResult = { created: [], linked: [], flagged: [], cancelled: [], paymentUpdated: [], skipped: 0, matched: [] };
  for (const o of nodes) {
    // A few new orders per run, so one run always finishes; the next run picks up the rest.
    if (opts.maxNew != null && result.created.length >= opts.maxNew) break;
    // Old orders stay exactly as they are.
    if (isoDateInIst(new Date(o.createdAt)) < opts.importFrom) { result.skipped++; continue; }
    const existing = await store.findOrderByShopify(o.name);
    const epikDraft = o.tags.some((t) => t.trim().toLowerCase() === EPIK_TAG);

    if (existing) {
      // Orders from Shopify follow it (cancellations, payment status). Every order with a #PIK takes Shopify's
      // payment as the truth.
      if (existing.createdBy === "Shopify") await followShopify(store, existing, o, result);
      const fresh = await store.getOrder(existing.id);
      if (fresh) await followShopifyPayment(store, fresh, o, result);
      result.skipped++;
      continue;
    }
    // Drafts made by EPIK Ops are linked by their tag elsewhere (linkCompletedDrafts).
    if (epikDraft) { result.skipped++; continue; }

    if (isTypedDraft(o)) {
      // Typed by the team in Shopify: link to the one matching Slack sale. With no match it becomes a dashboard
      // order of its own, so every Shopify order is on the dashboard. Two possible matches: left for a person.
      const linked = await linkTypedDraft(store, o);
      if (linked.kind === "linked") {
        result.linked.push(`${linked.orderId} → ${o.name}`);
        const fresh = await store.getOrder(linked.orderId);
        if (fresh) await followShopifyPayment(store, fresh, o, result);
        continue;
      }
      if (linked.kind === "unclear") { result.skipped++; continue; }
      // Give the CDE time to post the sale in Slack first (it would link instead): wait 3 hours, then bring it in.
      if ((opts.now ?? new Date()).getTime() - Date.parse(o.createdAt) < TYPED_DRAFT_WAIT_MS) { result.skipped++; continue; }
    }

    // A website order: new on the dashboard, unless it predates the start date or was cancelled already.
    if (o.cancelledAt || !o.lineItems.nodes.length) { result.skipped++; continue; }
    if (!(await store.claimAction(`shopify-import:${o.name}`))) { result.skipped++; continue; }
    try {
      const input = orderInputFor(o, channelOf(o));
      if (isTypedDraft(o)) {
        // Typed in Shopify with no Slack sale: no CDE known yet.
        input.poc = null;
        input.notes = input.notes?.replace(/^Came in from Shopify/, "Typed in Shopify (Draft Orders) with no matching Slack sale. Came in from Shopify") ?? null;
      }
      // A CDE said in Slack this customer would order on the website: credit the order to that CDE.
      const webSale = await findWebSale(store, input.phone, o.createdAt);
      if (webSale) {
        input.poc = webSale.poc;
        input.saleSource = webSale.saleSource ?? input.saleSource;
        input.notes = `${input.notes} Sold by ${webSale.poc}${webSale.saleSource ? ` (${webSale.saleSource})` : ""}: website sale posted in Slack.${webSale.notes ? ` CDE note: ${webSale.notes}` : ""}`;
      }
      const created = await createOrder(store, input, SHOPIFY_ACTOR);
      if (created.ok) {
        result.created.push(`${created.value.id} ← ${o.name}`);
        await followShopifyPayment(store, created.value, o, result);
        if (webSale && (await store.markWebSaleMatched(webSale.id, created.value.id))) {
          result.matched.push({ orderId: created.value.id, shopifyName: o.name, poc: webSale.poc, slackChannelId: webSale.slackChannelId, slackMessageTs: webSale.slackMessageTs });
        }
      } else { await store.releaseAction(`shopify-import:${o.name}`); result.skipped++; }
    } catch (error) {
      // The unique #PIK rule in the database stops a second copy even if two servers race here.
      await store.releaseAction(`shopify-import:${o.name}`);
      if (!/duplicate|unique/i.test(error instanceof Error ? error.message : "")) throw error;
      result.skipped++;
    }
  }
  return result;
}

/** Fills the #PIK of the Slack sale this typed draft was made from. Exactly one match, or nothing. */
type DraftLink = { kind: "linked"; orderId: string } | { kind: "none" } | { kind: "unclear" };

async function linkTypedDraft(store: OpsStore, o: ShopifyOrderNode): Promise<DraftLink> {
  const phone = tenDigits(o.phone) || tenDigits(o.shippingAddress?.phone ?? null);
  if (!phone) return { kind: "none" };
  const created = new Date(o.createdAt).getTime();
  const from = new Date(created - 4 * 86_400_000).toISOString();
  const { items } = await store.listOrders({ q: phone.slice(-4), stage: "all", from, limit: 100 });
  const total = minor(o.totalPriceSet.shopMoney.amount);
  const candidates = items.filter((order) => {
    if (order.shopifyOrderId || order.stage === "cancelled" || isTestName(order.customerName)) return false;
    if ((order.phone ?? "").replace(/\D/g, "").slice(-10) !== phone) return false;
    if (Math.abs(new Date(order.createdAt).getTime() - created) > 4 * 86_400_000) return false;
    // Deal price vs Shopify total: allow 5% for shipping, GST rounding or a small extra.
    return Math.abs(order.offeredTotalMinor - total) <= Math.max(50_000, total * 0.05);
  });
  if (!candidates.length) return { kind: "none" };
  if (candidates.length > 1) return { kind: "unclear" };
  const result = await setShopifyId(store, candidates[0].id, o.name, SHOPIFY_ACTOR);
  return result.ok ? { kind: "linked", orderId: candidates[0].id } : { kind: "unclear" };
}

/**
 * A practice website order for demos and tests: shaped exactly like a Shopify website order, so the real import and
 * CDE matching run on it, but nothing exists in Shopify. The customer is "TEST Website customer" (a test order: never
 * counted, removed by Clear test orders) and the number is #TEST-…, never a real #PIK.
 */
export function practiceOrderNode(phone: string, product: { sku: string | null; name: string; priceMinor: number }, now = new Date()): ShopifyOrderNode {
  const amount = (product.priceMinor / 100).toFixed(2);
  return {
    name: `#TEST-${now.getTime().toString(36).toUpperCase()}`,
    createdAt: now.toISOString(),
    cancelledAt: null,
    sourceName: "web",
    app: { name: "Online Store" },
    displayFinancialStatus: "PENDING",
    paymentGatewayNames: ["Cash on Delivery (COD)"],
    totalPriceSet: { shopMoney: { amount } },
    totalOutstandingSet: { shopMoney: { amount } },
    email: null,
    phone: `+91${phone}`,
    tags: ["practice"],
    shippingAddress: { name: "TEST Website customer", address1: "Practice order, not in Shopify", address2: null, city: "Bengaluru", province: "Karnataka", zip: "560001", phone: null },
    billingAddress: null,
    lineItems: { nodes: [{ title: product.name, sku: product.sku, quantity: 1, discountedTotalSet: { shopMoney: { amount } } }] },
  };
}

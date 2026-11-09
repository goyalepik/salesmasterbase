// CDE sale → Shopify draft order, and the #PIK number back once the team completes it.
// A draft is safe: the customer is not emailed and Shopify stock is not touched until someone clicks Complete.

import { recordShopifyEvent, setShopifyId, type Actor } from "@/lib/ops/service";
import type { OpsStore } from "@/lib/ops/store";
import type { OrderDetail } from "@/lib/ops/types";
import type { Graphql } from "./client";

/** Every draft we create carries this tag and the EPIK order id, so the finished Shopify order can be found again. */
export const EPIK_TAG = "epik-ops";
export const SHOPIFY_ACTOR: Actor = { name: "Shopify", slackUserId: null };

export type VariantInfo = { id: string; priceMinor: number };

const rupees = (minor: number) => (Math.round(minor) / 100).toFixed(2);

/** Indian mobile in the form Shopify accepts (+91XXXXXXXXXX), or null when it doesn't look like one. */
export function shopifyPhone(raw: string | null): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  const ten = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits.length === 11 && digits.startsWith("0") ? digits.slice(1) : digits;
  return /^[6-9]\d{9}$/.test(ten) ? `+91${ten}` : null;
}

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] } : { firstName: parts[0] ?? "", lastName: "" };
}

export type DraftPreview = {
  input: Record<string, unknown>;
  lines: Array<{ title: string; qty: number; shopifyPriceMinor: number | null; dealMinor: number; matched: boolean }>;
  warnings: string[];
};

/** What Shopify will receive for this order. Pure: no network, so the order page can show it as a preview. */
export function draftInputFor(order: OrderDetail, variants: Map<string, VariantInfo>, mode: "order" | "draft" = "draft"): DraftPreview {
  const warnings: string[] = [];
  const live = order.lines.filter((l) => l.status !== "cancelled" && l.status !== "rejected");
  const lines: DraftPreview["lines"] = [];
  const lineItems = live.map((line) => {
    const qty = Math.max(1, line.qty || 1);
    const extras = [
      line.accessories ? { key: "Accessories", value: line.accessories } : null,
      line.extendedWarranty ? { key: "Warranty", value: line.extendedWarranty } : null,
      line.installation ? { key: "Installation", value: line.installation } : null,
    ].filter((x): x is { key: string; value: string } => x !== null);
    const variant = line.sku ? variants.get(line.sku.toLowerCase()) : undefined;
    if (variant) {
      const listMinor = variant.priceMinor * qty;
      const item: Record<string, unknown> = { variantId: variant.id, quantity: qty };
      if (extras.length) item.customAttributes = extras;
      if (line.offeredPriceMinor < listMinor) {
        // A percentage avoids any doubt about "per unit" vs "per line"; rounding is at most a few paise.
        const pct = Number(((1 - line.offeredPriceMinor / listMinor) * 100).toFixed(4));
        item.appliedDiscount = { value: pct, valueType: "PERCENTAGE", title: "EPIK deal price" };
      } else if (line.offeredPriceMinor > listMinor) {
        warnings.push(`${line.productName}: the deal price is above the Shopify price, so Shopify's price is used.`);
      }
      lines.push({ title: line.productName, qty, shopifyPriceMinor: variant.priceMinor, dealMinor: line.offeredPriceMinor, matched: true });
      return item;
    }
    if (line.sku) warnings.push(`${line.productName}: SKU ${line.sku} is not in Shopify, so it goes in as a custom item.`);
    else warnings.push(`${line.productName}: no SKU yet, so it goes in as a custom item.`);
    lines.push({ title: line.productName, qty, shopifyPriceMinor: null, dealMinor: line.offeredPriceMinor, matched: false });
    return {
      title: line.productName,
      quantity: qty,
      originalUnitPriceWithCurrency: { amount: rupees(line.offeredPriceMinor / qty), currencyCode: "INR" },
      ...(line.sku ? { sku: line.sku } : {}),
      requiresShipping: true,
      taxable: true,
      ...(extras.length ? { customAttributes: extras } : {}),
    };
  });

  const phone = shopifyPhone(order.phone);
  if (order.phone && !phone) warnings.push("The phone number doesn't look like an Indian mobile, so it's left off.");
  const address = order.shippingAddress?.trim();
  const shippingAddress = address
    ? { ...splitName(order.customerName), address1: address.slice(0, 255), ...(order.pincode ? { zip: order.pincode } : {}), countryCode: "IN", ...(phone ? { phone } : {}) }
    : null;
  if (!address) warnings.push("No shipping address on the order.");

  const declared = [order.declaredPaymentStatus, order.declaredPaymentMode].filter(Boolean).join(", ");
  const origin = order.source === "slack" ? { label: "Slack sale", tag: "cde-sale" } : order.source === "desk" ? { label: "dashboard order", tag: "dashboard-order" } : { label: "imported order", tag: "imported-order" };
  const input: Record<string, unknown> = {
    lineItems,
    tags: [EPIK_TAG, order.id, origin.tag],
    note: `Created by EPIK Ops from ${order.id} (${origin.label}${order.poc ? ` by ${order.poc}` : ""}${order.hub ? `, ${order.hub}` : ""}). ${mode === "order" ? "Payment pending until RevOps confirms it." : "Check it, then click Complete."}${declared ? ` Payment declared by the CDE: ${declared}.` : ""}`,
    customAttributes: [
      { key: "EPIK order", value: order.id },
      ...(order.poc ? [{ key: "POC", value: order.poc }] : []),
      ...(order.hub ? [{ key: "Hub", value: order.hub }] : []),
    ],
    ...(order.email ? { email: order.email } : {}),
    ...(phone ? { phone } : {}),
    ...(shippingAddress ? { shippingAddress } : {}),
    ...(order.gst ? { poNumber: `GST ${order.gst}`.slice(0, 50) } : {}),
  };
  return { input, lines, warnings };
}

const VARIANTS_BY_SKU = `query VariantsBySku($q: String!) {
  productVariants(first: 25, query: $q) { nodes { id sku price } }
}`;

const CREATE_DRAFT = `mutation CreateDraft($input: DraftOrderInput!) {
  draftOrderCreate(input: $input) {
    draftOrder { id name paymentTerms { id } }
    userErrors { field message }
  }
}`;

/** Shopify product variants for these SKUs, keyed by lower-case SKU. */
export async function variantsForSkus(gql: Graphql, skus: string[]): Promise<Map<string, VariantInfo>> {
  const map = new Map<string, VariantInfo>();
  const unique = [...new Set(skus.filter(Boolean))];
  if (!unique.length) return map;
  const q = unique.map((s) => `sku:"${s.replace(/"/g, "")}"`).join(" OR ");
  const data = await gql<{ productVariants: { nodes: Array<{ id: string; sku: string | null; price: string }> } }>(VARIANTS_BY_SKU, { q });
  for (const v of data.productVariants.nodes) {
    if (!v.sku) continue;
    const key = v.sku.toLowerCase();
    if (!map.has(key)) map.set(key, { id: v.id, priceMinor: Math.round(Number(v.price) * 100) });
  }
  return map;
}

/** The draft's Shopify id written in the order history, if one was made. */
export function draftFromHistory(order: OrderDetail): { name: string; numericId: string | null } | null {
  const event = [...order.events].reverse().find((e) => e.type === "shopify_draft");
  if (!event) return null;
  const name = /draft (#D\d+)/i.exec(event.summary)?.[1] ?? "draft";
  const numericId = /\(id (\d+)\)/.exec(event.summary)?.[1] ?? null;
  return { name, numericId };
}

export type DraftOutcome =
  | { ok: true; message: string; draftName: string; orderName: string | null }
  | { ok: false; message: string };

/** Shopify's built-in "Due on receipt" payment terms: the order is created with payment pending, never marked paid. */
export const DUE_ON_RECEIPT = "gid://shopify/PaymentTermsTemplate/1";

const COMPLETE_DRAFT = `mutation CompleteDraft($id: ID!) {
  draftOrderComplete(id: $id) {
    draftOrder { id order { id name } }
    userErrors { field message }
  }
}`;

type CreateResult = { draftOrderCreate: { draftOrder: { id: string; name: string; paymentTerms: { id: string } | null } | null; userErrors: Array<{ field: string[] | null; message: string }> } };

/**
 * Sends one EPIK order to Shopify, once.
 * - "draft": a draft order the team checks and completes by hand.
 * - "order": a draft with "Due on receipt" payment terms, completed straight away, so Shopify gives the #PIK number
 *   now with payment pending. If Shopify won't take the payment terms, it stops at a draft: it is never completed
 *   without them, because completing without terms would mark the order paid.
 * Skips orders that are cancelled, already linked to a #PIK, or already have a draft. Every step and failure is
 * written to the order history.
 */
export async function pushOrderToShopify(store: OpsStore, gql: Graphql, orderId: string, mode: "order" | "draft", actor: Actor = SHOPIFY_ACTOR): Promise<DraftOutcome> {
  const order = await store.getOrder(orderId);
  if (!order) return { ok: false, message: "Order not found." };
  if (order.stage === "cancelled") return { ok: false, message: "This order is cancelled." };
  if (order.shopifyOrderId) return { ok: false, message: `Already linked to Shopify ${order.shopifyOrderId}.` };
  const existing = draftFromHistory(order);
  if (existing) return { ok: false, message: `A Shopify draft (${existing.name}) already exists for this order.` };
  if (!(await store.claimAction(`shopify-draft:${orderId}`))) return { ok: false, message: "This order is already being sent to Shopify." };

  let draft: { id: string; name: string } | null = null;
  try {
    const variants = await variantsForSkus(gql, order.lines.map((l) => l.sku ?? ""));
    const { input } = draftInputFor(order, variants, mode);
    let termsRefused = false;
    let data = await gql<CreateResult>(CREATE_DRAFT, { input: mode === "order" ? { ...input, paymentTerms: { paymentTermsTemplateId: DUE_ON_RECEIPT } } : input });
    if (mode === "order" && data.draftOrderCreate.userErrors.some((e) => /payment terms/i.test(e.message))) {
      // The app lacks the payment terms permission: make a plain draft so the sale is not lost.
      termsRefused = true;
      data = await gql<CreateResult>(CREATE_DRAFT, { input: draftInputFor(order, variants, "draft").input });
    }
    const errors = data.draftOrderCreate.userErrors;
    draft = data.draftOrderCreate.draftOrder;
    if (errors.length || !draft) throw new Error(errors.map((e) => e.message).join("; ") || "Shopify did not return the draft.");
    const numericId = draft.id.split("/").pop() ?? "";
    // Written first: even if completing fails below, this order can never get a second draft.
    await recordShopifyEvent(store, orderId, "shopify_draft", `Shopify draft ${draft.name} created (id ${numericId}).${mode === "draft" || termsRefused ? " Complete it in Shopify, Orders, Drafts." : ""}`, actor);

    if (mode === "draft") return { ok: true, message: `Shopify draft ${draft.name} created.`, draftName: draft.name, orderName: null };
    if (termsRefused || !data.draftOrderCreate.draftOrder?.paymentTerms) {
      const why = "Shopify needs the app to have the payment terms permission (write_payment_terms) to make it an order with payment pending.";
      await recordShopifyEvent(store, orderId, "shopify_error", `Made draft ${draft.name} instead of an order. ${why}`, actor);
      return { ok: true, message: `Shopify draft ${draft.name} created. ${why}`, draftName: draft.name, orderName: null };
    }

    const completed = await gql<{ draftOrderComplete: { draftOrder: { order: { id: string; name: string } | null } | null; userErrors: Array<{ message: string }> } }>(COMPLETE_DRAFT, { id: draft.id });
    const made = completed.draftOrderComplete.draftOrder?.order;
    if (completed.draftOrderComplete.userErrors.length || !made) {
      const why = completed.draftOrderComplete.userErrors.map((e) => e.message).join("; ") || "Shopify did not return the order.";
      await recordShopifyEvent(store, orderId, "shopify_error", `Draft ${draft.name} made but not completed: ${why}. Complete it in Shopify, Orders, Drafts.`, actor);
      return { ok: false, message: `Draft ${draft.name} made but not completed: ${why}` };
    }
    const linked = await setShopifyId(store, orderId, made.name, actor);
    if (!linked.ok) await recordShopifyEvent(store, orderId, "shopify_error", `Shopify order ${made.name} made but not linked: ${linked.error}`, actor);
    return { ok: true, message: `Shopify order ${made.name} created, payment pending.`, draftName: draft.name, orderName: made.name };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (draft) {
      // The draft exists (its event is written), so keep the claim: no second draft for this order.
      await recordShopifyEvent(store, orderId, "shopify_error", `Draft ${draft.name} made but not completed: ${message}. Complete it in Shopify, Orders, Drafts.`, actor);
      return { ok: false, message: `Draft ${draft.name} made but not completed: ${message}` };
    }
    // Nothing was made: let a later attempt try again.
    await store.releaseAction(`shopify-draft:${orderId}`);
    await recordShopifyEvent(store, orderId, "shopify_error", `Shopify draft not created: ${message}`, actor);
    return { ok: false, message: `Shopify draft not created: ${message}` };
  }
}

/** The one-line note posted in the sale's Slack thread after it was sent to Shopify. */
export function shopifyThreadNote(outcome: DraftOutcome): string {
  if (outcome.ok && outcome.orderName) return `Shopify order ${outcome.orderName} created, payment pending.`;
  if (outcome.ok) return `Shopify draft ${outcome.draftName} made. In Shopify, open Orders, Drafts, check it and click Complete.`;
  return `Shopify order not made: ${outcome.message.replace(/^Shopify draft not created: /, "")} Add it in Shopify by hand for now.`;
}

/** A draft for the team to complete by hand. */
export async function createShopifyDraft(store: OpsStore, gql: Graphql, orderId: string, actor: Actor = SHOPIFY_ACTOR): Promise<DraftOutcome> {
  return pushOrderToShopify(store, gql, orderId, "draft", actor);
}

const TAGGED_ORDERS = `query TaggedOrders($q: String!, $after: String) {
  orders(first: 50, after: $after, query: $q, sortKey: UPDATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes { name tags }
  }
}`;

/**
 * Finds Shopify orders completed from our drafts in the last `days` days and links their #PIK number
 * to the matching EPIK order. Only fills empty links; never overwrites one.
 */
export async function linkCompletedDrafts(store: OpsStore, gql: Graphql, now: Date, days = 14): Promise<{ checked: number; linked: string[] }> {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const q = `tag:${EPIK_TAG} updated_at:>='${since}'`;
  const linked: string[] = [];
  let checked = 0;
  let after: string | null = null;
  for (let page = 0; page < 10; page++) {
    const data: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Array<{ name: string; tags: string[] }> } } = await gql(TAGGED_ORDERS, { q, after });
    for (const node of data.orders.nodes) {
      checked++;
      const epk = node.tags.find((t) => /^EPK-\d+$/i.test(t.trim()))?.trim().toUpperCase();
      if (!epk) continue;
      const order = await store.getOrder(epk);
      if (!order || order.shopifyOrderId) continue;
      const result = await setShopifyId(store, epk, node.name, SHOPIFY_ACTOR);
      if (result.ok) linked.push(`${epk} → ${node.name}`);
    }
    if (!data.orders.pageInfo.hasNextPage) break;
    after = data.orders.pageInfo.endCursor;
  }
  return { checked, linked };
}

// CDE sale → Shopify draft order, and the #PIK number back once the team completes it.
// A draft is safe: the customer is not emailed and Shopify stock is not touched until someone clicks Complete.

import { recordShopifyEvent, setShopifyId, type Actor } from "@/lib/ops/service";
import type { OpsStore } from "@/lib/ops/store";
import type { OrderDetail } from "@/lib/ops/types";
import { placeFor } from "@/lib/india/address";
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

/**
 * What the CDE said was paid at the sale, for the Shopify payment status: "Full paid, ₹69,900 received" with
 * "UPI, UTR 4312…" → ₹69,900 by UPI. Website and imported orders, and "To be collected", declare nothing.
 */
export function declaredPayment(order: Pick<OrderDetail, "declaredPaymentStatus" | "declaredPaymentMode" | "offeredTotalMinor">): { kind: "none" | "partial" | "full"; paidMinor: number; method: string | null } {
  const status = order.declaredPaymentStatus ?? "";
  const method = (order.declaredPaymentMode ?? "").split(",")[0]?.trim() || null;
  const amount = /₹\s?([\d,]+(?:\.\d+)?)\s+received/i.exec(status);
  const paid = amount ? Math.round(Number(amount[1].replace(/,/g, "")) * 100) : /^full paid/i.test(status) ? order.offeredTotalMinor : 0;
  if (!/^(full paid|partial)/i.test(status) || !Number.isFinite(paid) || paid <= 0) return { kind: "none", paidMinor: 0, method };
  return { kind: paid >= order.offeredTotalMinor ? "full" : "partial", paidMinor: Math.min(paid, order.offeredTotalMinor), method };
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
        // Rupees off each unit, to the paisa. Shopify takes at most 2 decimals (a percentage like 4.1488 was refused).
        const offEachMinor = Math.round((listMinor - line.offeredPriceMinor) / qty);
        item.appliedDiscount = { value: Number(rupees(offEachMinor)), valueType: "FIXED_AMOUNT", title: "EPIK deal price" };
        if (offEachMinor * qty !== listMinor - line.offeredPriceMinor) warnings.push(`${line.productName}: the deal price splits unevenly over ${qty} units, so Shopify's total may differ by a few paise.`);
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
  const place = placeFor(address, order.pincode);
  const shippingAddress = address
    ? {
        ...splitName(order.customerName),
        address1: (place.street || address).slice(0, 255),
        ...(place.city ? { city: place.city } : {}),
        ...(place.state ? { provinceCode: place.state.code } : {}),
        ...(place.zip ? { zip: place.zip } : {}),
        countryCode: "IN",
        ...(phone ? { phone } : {}),
      }
    : null;
  if (!address) warnings.push("No shipping address on the order.");
  else {
    if (!place.state) warnings.push("No state: add a 6 digit pincode, or Shopify can't work out GST (it charges only CGST).");
    if (!place.city) warnings.push("No city found in the address or pincode.");
  }

  const declared = [order.declaredPaymentStatus, order.declaredPaymentMode].filter(Boolean).join(", ");
  const origin = order.source === "slack" ? { label: "Slack sale", tag: "cde-sale" } : order.source === "desk" ? { label: "dashboard order", tag: "dashboard-order" } : { label: "imported order", tag: "imported-order" };
  const input: Record<string, unknown> = {
    lineItems,
    tags: [EPIK_TAG, order.id, origin.tag],
    note: `Created by EPIK Ops from ${order.id} (${origin.label}${order.poc ? ` by ${order.poc}` : ""}${order.hub ? `, ${order.hub}` : ""}). ${mode === "order" ? (declaredPayment(order).paidMinor > 0 ? "Payment as declared by the CDE; RevOps still checks it against the bank." : "Payment pending until RevOps confirms it.") : "Check it, then click Complete."}${declared ? ` Payment declared by the CDE: ${declared}.` : ""}`,
    customAttributes: [
      { key: "EPIK order", value: order.id },
      ...(order.poc ? [{ key: "POC", value: order.poc }] : []),
      ...(order.hub ? [{ key: "Hub", value: order.hub }] : []),
      // Shown in Shopify's "Additional details", next to POC and Hub, so B2B orders show their GST number.
      ...(order.gst ? [{ key: "GSTIN", value: order.gst.slice(0, 120) }] : []),
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
    draftOrder { id name paymentTerms { id } totalPriceSet { shopMoney { amount } } }
    userErrors { field message }
  }
}`;

// Shopify works out GST on the draft; a part-paid order is then made from the draft's own numbers.
const DRAFT_DETAIL = `query DraftDetail($id: ID!) {
  draftOrder(id: $id) {
    taxesIncluded
    customer { id }
    lineItems(first: 50) { nodes {
      title sku quantity requiresShipping taxable
      variant { id }
      discountedTotalSet { shopMoney { amount } }
      taxLines { title rate priceSet { shopMoney { amount } } }
      customAttributes { key value }
    } }
  }
}`;
const ORDER_CREATE = `mutation OrderCreate($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
  orderCreate(order: $order, options: $options) { order { id name displayFinancialStatus } userErrors { field message } }
}`;
const DRAFT_DELETE = `mutation DraftDelete($input: DraftOrderDeleteInput!) { draftOrderDelete(input: $input) { deletedId userErrors { field message } } }`;
const MANUAL_PAYMENT = `mutation ManualPayment($id: ID!, $method: String) {
  orderCreateManualPayment(id: $id, paymentMethodName: $method) { order { displayFinancialStatus } userErrors { field message } }
}`;
const MARK_PAID = `mutation MarkPaid($input: OrderMarkAsPaidInput!) { orderMarkAsPaid(input: $input) { order { displayFinancialStatus } userErrors { field message } } }`;

type DraftDetail = {
  draftOrder: {
    taxesIncluded: boolean;
    customer: { id: string } | null;
    lineItems: { nodes: Array<{
      title: string; sku: string | null; quantity: number; requiresShipping: boolean; taxable: boolean;
      variant: { id: string } | null;
      discountedTotalSet: { shopMoney: { amount: string } };
      taxLines: Array<{ title: string; rate: number; priceSet: { shopMoney: { amount: string } } }>;
      customAttributes: Array<{ key: string; value: string | null }>;
    }> };
  } | null;
};

const inr = (amount: string | number) => ({ shopMoney: { amount: typeof amount === "number" ? amount.toFixed(2) : amount, currencyCode: "INR" } });

/** The orderCreate input for a part-paid order: the draft's prices and GST exactly, plus the payment the CDE took. Pure. */
export function partPaidOrderInput(detail: NonNullable<DraftDetail["draftOrder"]>, input: Record<string, unknown>, paidMinor: number, method: string | null): Record<string, unknown> {
  const shippingAddress = input.shippingAddress as Record<string, unknown> | undefined;
  return {
    currency: "INR",
    taxesIncluded: detail.taxesIncluded,
    lineItems: detail.lineItems.nodes.map((n) => ({
      ...(n.variant ? { variantId: n.variant.id } : { title: n.title }),
      ...(n.sku ? { sku: n.sku } : {}),
      quantity: n.quantity,
      priceSet: inr(Math.round((Number(n.discountedTotalSet.shopMoney.amount) * 100) / Math.max(1, n.quantity)) / 100),
      taxLines: n.taxLines.map((t) => ({ title: t.title, rate: t.rate, priceSet: inr(t.priceSet.shopMoney.amount) })),
      ...(n.customAttributes.length ? { properties: n.customAttributes.map((a) => ({ name: a.key, value: a.value ?? "" })) } : {}),
      requiresShipping: n.requiresShipping,
      taxable: n.taxable,
    })),
    financialStatus: "PARTIALLY_PAID",
    transactions: [{ kind: "SALE", status: "SUCCESS", gateway: method || "Other", amountSet: inr(rupees(paidMinor)) }],
    ...(detail.customer ? { customer: { toAssociate: { id: detail.customer.id } } } : {}),
    ...(input.email ? { email: input.email } : {}),
    ...(input.phone ? { phone: input.phone } : {}),
    note: input.note,
    tags: input.tags,
    customAttributes: input.customAttributes,
    ...(shippingAddress ? { shippingAddress, billingAddress: shippingAddress } : {}),
    ...(input.poNumber ? { poNumber: input.poNumber } : {}),
  };
}

const errorText = (errors: Array<{ message: string }> | undefined) => (errors ?? []).map((e) => e.message).join("; ");
const needsWriteOrders = (message: string) => /access denied|write_orders|not approved|scope/i.test(message);
const WRITE_ORDERS_HELP = "Shopify needs the app to have the write_orders permission (Dev Dashboard, the app, Configuration, scopes, then reinstall).";

/** Makes a part-paid #PIK order from the draft, then deletes the draft. Throws with Shopify's reason on failure. */
async function orderFromDraft(gql: Graphql, draftId: string, input: Record<string, unknown>, paidMinor: number, method: string | null): Promise<{ id: string; name: string; draftLeft: boolean }> {
  const detail = (await gql<DraftDetail>(DRAFT_DETAIL, { id: draftId })).draftOrder;
  if (!detail) throw new Error("Shopify did not return the draft.");
  const created = await gql<{ orderCreate: { order: { id: string; name: string } | null; userErrors: Array<{ message: string }> } }>(ORDER_CREATE, {
    order: partPaidOrderInput(detail, input, paidMinor, method),
    options: { inventoryBehaviour: "DECREMENT_IGNORING_POLICY", sendReceipt: false, sendFulfillmentReceipt: false },
  });
  const made = created.orderCreate.order;
  if (!made || created.orderCreate.userErrors.length) throw new Error(errorText(created.orderCreate.userErrors) || "Shopify did not return the order.");
  // The draft was only for the GST: remove it so nobody completes it into a second order.
  const deleted = await gql<{ draftOrderDelete: { deletedId: string | null } }>(DRAFT_DELETE, { input: { id: draftId } }).catch(() => null);
  return { ...made, draftLeft: !deleted?.draftOrderDelete.deletedId };
}

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
  | { ok: true; message: string; draftName: string; orderName: string | null; payment?: string }
  | { ok: false; message: string };

/** Shopify's built-in "Due on receipt" payment terms: the order is created with payment pending, never marked paid. */
export const DUE_ON_RECEIPT = "gid://shopify/PaymentTermsTemplate/1";

const COMPLETE_DRAFT = `mutation CompleteDraft($id: ID!) {
  draftOrderComplete(id: $id) {
    draftOrder { id order { id name } }
    userErrors { field message }
  }
}`;

type CreateResult = { draftOrderCreate: { draftOrder: { id: string; name: string; paymentTerms: { id: string } | null; totalPriceSet?: { shopMoney: { amount: string } } } | null; userErrors: Array<{ field: string[] | null; message: string }> } };

/**
 * Sends one EPIK order to Shopify, once.
 * - "draft": a draft order the team checks and completes by hand.
 * - "order": the #PIK order now, with the payment the CDE declared: Full paid shows Paid (with the method),
 *   Partial shows Partially paid with the amount, anything else shows Payment pending. Shopify works out GST on a
 *   draft first (it needs the state, which comes from the pincode). If Shopify refuses a payment step (for example
 *   the app lacks write_orders), the order is still made, with payment pending, and the reason is in the history.
 *   If Shopify won't take the payment terms, it stops at a draft: never completed without them, because that
 *   would mark the order paid.
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
    const preview = draftInputFor(order, variants, mode);
    let input = preview.input;
    const send = (body: Record<string, unknown>) => gql<CreateResult>(CREATE_DRAFT, { input: mode === "order" ? { ...body, paymentTerms: { paymentTermsTemplateId: DUE_ON_RECEIPT } } : body });
    let data = await send(input);
    const address = input.shippingAddress as Record<string, unknown> | undefined;
    if (address?.provinceCode && data.draftOrderCreate.userErrors.some((e) => /province|state|zip|address/i.test(e.message))) {
      // Shopify didn't accept the state worked out from the pincode: keep the sale, send it without the state.
      const { provinceCode: _drop, ...rest } = address;
      void _drop;
      input = { ...input, shippingAddress: rest };
      data = await send(input);
      await recordShopifyEvent(store, orderId, "shopify_error", "Shopify did not accept the state from the pincode, so the order went without it. Add the state in Shopify so GST is right.", actor);
    }
    let termsRefused = false;
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
    const shopifyTotal = Math.round(Number(data.draftOrderCreate.draftOrder?.totalPriceSet?.shopMoney.amount ?? NaN) * 100);
    const dealTotal = order.lines.filter((l) => l.status !== "cancelled" && l.status !== "rejected").reduce((sum, l) => sum + l.offeredPriceMinor, 0);
    if (Number.isFinite(shopifyTotal) && Math.abs(shopifyTotal - dealTotal) > 100) {
      await recordShopifyEvent(store, orderId, "shopify_error", `Shopify total ₹${(shopifyTotal / 100).toLocaleString("en-IN")} differs from the deal total ₹${(dealTotal / 100).toLocaleString("en-IN")}. Check the prices in Shopify.`, actor);
    }

    if (mode === "draft") return { ok: true, message: `Shopify draft ${draft.name} created.`, draftName: draft.name, orderName: null };
    if (termsRefused || !data.draftOrderCreate.draftOrder?.paymentTerms) {
      const why = "Shopify needs the app to have the payment terms permission (write_payment_terms) to make it an order with payment pending.";
      await recordShopifyEvent(store, orderId, "shopify_error", `Made draft ${draft.name} instead of an order. ${why}`, actor);
      return { ok: true, message: `Shopify draft ${draft.name} created. ${why}`, draftName: draft.name, orderName: null };
    }

    const declared = declaredPayment(order);
    const paidText = `₹${(declared.paidMinor / 100).toLocaleString("en-IN")}${declared.method ? ` by ${declared.method}` : ""}`;
    let made: { id: string; name: string } | null = null;
    let payment = "payment pending";
    if (declared.kind === "partial") {
      try {
        const fromDraft = await orderFromDraft(gql, draft.id, input, declared.paidMinor, declared.method);
        made = fromDraft;
        payment = `partially paid (${paidText} received)`;
        if (fromDraft.draftLeft) await recordShopifyEvent(store, orderId, "shopify_error", `Order ${fromDraft.name} made, but draft ${draft.name} could not be deleted. Delete it in Shopify, Orders, Drafts; do not complete it.`, actor);
      } catch (error) {
        const why = error instanceof Error ? error.message : "unknown";
        await recordShopifyEvent(store, orderId, "shopify_error", `Shopify could not show the part payment (${needsWriteOrders(why) ? WRITE_ORDERS_HELP : why}). Made it with payment pending.`, actor);
      }
    }
    if (!made) {
      const completed = await gql<{ draftOrderComplete: { draftOrder: { order: { id: string; name: string } | null } | null; userErrors: Array<{ message: string }> } }>(COMPLETE_DRAFT, { id: draft.id });
      made = completed.draftOrderComplete.draftOrder?.order ?? null;
      if (completed.draftOrderComplete.userErrors.length || !made) {
        const why = errorText(completed.draftOrderComplete.userErrors) || "Shopify did not return the order.";
        await recordShopifyEvent(store, orderId, "shopify_error", `Draft ${draft.name} made but not completed: ${why}. Complete it in Shopify, Orders, Drafts.`, actor);
        return { ok: false, message: `Draft ${draft.name} made but not completed: ${why}` };
      }
      if (declared.kind === "full") {
        const manual = await gql<{ orderCreateManualPayment: { userErrors: Array<{ message: string }> } }>(MANUAL_PAYMENT, { id: made.id, method: declared.method || "Other" })
          .then((r) => errorText(r.orderCreateManualPayment.userErrors))
          .catch((error: unknown) => (error instanceof Error ? error.message : "unknown"));
        // Stores without manual payment methods refuse that ("Payment provider is not configured on shop"):
        // then Shopify's plain "Mark as paid" (the button in Shopify) records the full amount. The method stays in the notes.
        const paidId = made.id;
        const paid = !manual ? "" : await gql<{ orderMarkAsPaid: { userErrors: Array<{ message: string }> } }>(MARK_PAID, { input: { id: paidId } })
          .then((r) => errorText(r.orderMarkAsPaid.userErrors))
          .catch((error: unknown) => (error instanceof Error ? error.message : "unknown"));
        if (paid) await recordShopifyEvent(store, orderId, "shopify_error", `Shopify ${made.name} left as payment pending: ${needsWriteOrders(paid) ? WRITE_ORDERS_HELP : paid}`, actor);
        else payment = `paid (${paidText})`;
      }
    }
    const linked = await setShopifyId(store, orderId, made.name, actor);
    if (!linked.ok) await recordShopifyEvent(store, orderId, "shopify_error", `Shopify order ${made.name} made but not linked: ${linked.error}`, actor);
    return { ok: true, message: `Shopify order ${made.name} created, ${payment}.`, draftName: draft.name, orderName: made.name, payment };
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
  if (outcome.ok && outcome.orderName) return `Shopify order ${outcome.orderName} created, ${outcome.payment ?? "payment pending"}.`;
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

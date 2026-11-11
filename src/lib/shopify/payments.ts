// The dashboard's payment status → the Shopify order, for orders EPIK made in Shopify (tagged epik-ops) only.
// Paid → the order is marked paid in Shopify. Partially paid → Shopify can only take part payments on Shopify Plus,
// so the order gets an "EPIK: Partially paid" tag instead. Website orders are never touched (no epik-ops tag).

import { PAYMENT_STATE_LABELS, type PaymentState } from "@/lib/ops/payment-status";
import type { Graphql } from "./client";
import { EPIK_TAG } from "./drafts";

export const PAYMENT_TAG_PREFIX = "EPIK: ";
const PAYMENT_TAGS = Object.values(PAYMENT_STATE_LABELS).map((label) => `${PAYMENT_TAG_PREFIX}${label}`);

const FIND = `query FindOrder($q: String!) {
  orders(first: 1, query: $q) { nodes { id name tags displayFinancialStatus } }
}`;
const TAGS_REMOVE = `mutation TagsRemove($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { field message } } }`;
const TAGS_ADD = `mutation TagsAdd($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { field message } } }`;
const MARK_PAID = `mutation MarkPaid($input: OrderMarkAsPaidInput!) { orderMarkAsPaid(input: $input) { order { displayFinancialStatus } userErrors { field message } } }`;

type UserErrors = Array<{ field: string[] | null; message: string }>;
const firstError = (errors: UserErrors | undefined) => errors?.[0]?.message ?? null;

export type PaymentPush = { ok: boolean; changed: boolean; message: string };

/** Makes the Shopify order say what the dashboard says. Safe to repeat: does nothing when Shopify already matches. */
export async function pushPaymentState(gql: Graphql, shopifyName: string, state: PaymentState): Promise<PaymentPush> {
  const found: { orders: { nodes: Array<{ id: string; name: string; tags: string[]; displayFinancialStatus: string | null }> } } = await gql(FIND, { q: `name:${JSON.stringify(shopifyName)}` });
  const order = found.orders.nodes.find((o) => o.name === shopifyName);
  if (!order) return { ok: false, changed: false, message: `Shopify order ${shopifyName} not found.` };
  if (!order.tags.some((t) => t.trim().toLowerCase() === EPIK_TAG)) return { ok: true, changed: false, message: `${shopifyName} was not made by EPIK Ops, so Shopify is left as it is.` };

  let changed = false;
  const wanted = `${PAYMENT_TAG_PREFIX}${PAYMENT_STATE_LABELS[state]}`;
  const stale = order.tags.filter((t) => PAYMENT_TAGS.includes(t) && t !== wanted);
  if (stale.length) {
    const removed: { tagsRemove: { userErrors: UserErrors } } = await gql(TAGS_REMOVE, { id: order.id, tags: stale });
    const error = firstError(removed.tagsRemove.userErrors);
    if (error) return { ok: false, changed, message: `Shopify refused the tag change: ${error}` };
    changed = true;
  }
  if (!order.tags.includes(wanted)) {
    const added: { tagsAdd: { userErrors: UserErrors } } = await gql(TAGS_ADD, { id: order.id, tags: [wanted] });
    const error = firstError(added.tagsAdd.userErrors);
    if (error) return { ok: false, changed, message: `Shopify refused the tag: ${error}` };
    changed = true;
  }
  if (state === "paid" && order.displayFinancialStatus !== "PAID") {
    const paid: { orderMarkAsPaid: { userErrors: UserErrors } } = await gql(MARK_PAID, { input: { id: order.id } });
    const error = firstError(paid.orderMarkAsPaid.userErrors);
    if (error) return { ok: false, changed, message: `Shopify did not mark ${shopifyName} paid: ${error}` };
    changed = true;
  }
  return { ok: true, changed, message: changed ? `Shopify ${shopifyName} now shows ${PAYMENT_STATE_LABELS[state]}.` : `Shopify ${shopifyName} already shows ${PAYMENT_STATE_LABELS[state]}.` };
}

// One payment status, said the same way on the Slack card, the dashboard and (for #PIK orders) Shopify.
// "Paid" counts only money RevOps verified and cash collected on delivery, never the offered price.

export type PaymentState = "pending" | "partially_paid" | "paid";

export const PAYMENT_STATE_LABELS: Record<PaymentState, string> = {
  pending: "Pending",
  partially_paid: "Partially paid",
  paid: "Paid",
};

export function paymentState(order: { paidMinor: number; offeredTotalMinor: number }): PaymentState {
  if (order.paidMinor <= 0) return "pending";
  return order.paidMinor >= order.offeredTotalMinor ? "paid" : "partially_paid";
}

/** The payment mode for a Shopify gateway name, when it is certain. Card gateways (Razorpay, PayU) can be UPI or card, so null. */
export function modeFromGateway(gateways: string | null): string | null {
  const names = [...new Set((gateways ?? "").toLowerCase().split("+").map((g) => g.trim()).filter(Boolean))];
  if (names.length !== 1) return null;
  const g = names[0];
  if (/snapmint/.test(g)) return "Snapmint";
  if (/bajaj/.test(g)) return "Bajaj";
  if (/cash on delivery|\bcod\b/.test(g)) return "Cash";
  return null;
}

/**
 * For a website order: what Shopify says was paid and how, so the Verify payment form starts filled in.
 * RevOps still checks it against the bank or finance report and presses Verify. Null when Shopify shows nothing paid.
 */
export function shopifyPaymentHint(order: { createdBy: string | null; declaredPaymentStatus: string | null; declaredPaymentMode: string | null; paidMinor: number }):
  | { amountMinor: number; mode: string | null; gateway: string | null }
  | null {
  if (order.createdBy !== "Shopify") return null;
  const match = /₹([\d,]+(?:\.\d+)?) paid/.exec(order.declaredPaymentStatus ?? "");
  if (!match) return null;
  const shopifyPaid = Math.round(Number(match[1].replace(/,/g, "")) * 100);
  const amountMinor = shopifyPaid - order.paidMinor;
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) return null;
  return { amountMinor, mode: modeFromGateway(order.declaredPaymentMode), gateway: order.declaredPaymentMode };
}

/** What Shopify says about a website order's payment ("Shopify: paid, ₹59,999 paid"), when it says paid. */
export function shopifySaysPaid(declaredPaymentStatus: string | null): boolean {
  return /^shopify:\s*(paid|partially paid)/i.test(declaredPaymentStatus ?? "");
}

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

/** What Shopify says about a website order's payment ("Shopify: paid, ₹59,999 paid"), when it says paid. */
export function shopifySaysPaid(declaredPaymentStatus: string | null): boolean {
  return /^shopify:\s*(paid|partially paid)/i.test(declaredPaymentStatus ?? "");
}

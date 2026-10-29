import type { QuestionKind } from "@/lib/ai/classify";

export type BriefFacts = {
  kind: QuestionKind;
  messages: number;
  paymentMentions: number;
  paymentsWithAmount: number;
  missingCustomer: number;
  needsReview: number;
  openItems: number;
  topName: string | null;
  topOrders: number;
  unnamedSenders: number;
};

function finding(facts: BriefFacts): string {
  if (facts.kind === "contributors") {
    if (facts.messages === 0) return "See, this is what I found. No salesperson posted in the last 5 days.";
    if (!facts.topName) return `See, this is what I found. The busiest sender in the last 5 days is still a Slack id, across ${facts.messages} messages.`;
    if (facts.topOrders > 0) return `See, this is what I found. ${facts.topName} posted ${facts.topOrders} order sheet${facts.topOrders === 1 ? "" : "s"} in the last 5 days.`;
    return `See, this is what I found. ${facts.topName} is the busiest sender in the last 5 days, and none of those posts is an order sheet.`;
  }
  if (facts.kind === "needs_review" || facts.kind === "missing_amounts") {
    const count = facts.kind === "missing_amounts" ? facts.openItems : facts.needsReview;
    if (count === 0) return "See, this is what I found. Nothing is waiting for review.";
    return `See, this is what I found. ${count} item${count === 1 ? " is" : "s are"} waiting for review.`;
  }
  if (facts.kind === "payment_today") {
    if (facts.paymentMentions === 0) return "See, this is what I found. No payment mention is stored for today.";
    return `See, this is what I found. Today has ${facts.paymentMentions} payment mention${facts.paymentMentions === 1 ? "" : "s"}, and ${facts.paymentsWithAmount} include an amount. Those amounts are not verified.`;
  }
  if (facts.messages === 0) return "See, this is what I found. Nothing is stored in this range.";
  return `See, this is what I found. ${facts.messages} messages are stored in this range, including ${facts.paymentMentions} payment mention${facts.paymentMentions === 1 ? "" : "s"}.`;
}

function gaps(facts: BriefFacts): string[] {
  const lines: string[] = [];
  if (facts.kind === "contributors" && facts.unnamedSenders > 0) {
    lines.push(`${facts.unnamedSenders} sender${facts.unnamedSenders === 1 ? " is" : "s are"} still a Slack id, so incentive cannot be tied to a person.`);
  }
  if (facts.missingCustomer > 0) lines.push(`${facts.missingCustomer} message${facts.missingCustomer === 1 ? " has" : "s have"} no customer name.`);
  const missingAmount = facts.paymentMentions - facts.paymentsWithAmount;
  if (facts.paymentMentions > 0 && missingAmount > 0) lines.push(`${missingAmount} payment mention${missingAmount === 1 ? " has" : "s have"} no amount.`);
  return lines;
}

export function founderBrief(facts: BriefFacts): string {
  const missing = gaps(facts);
  const parts = [finding(facts)];
  if (missing.length > 0) {
    parts.push(`This is not organized. ${missing.join(" ")}`);
    const ask = facts.unnamedSenders > 0
      ? "We can improve this if you give me each salesperson's name on the Salespeople page, or add the Slack users:read scope and reinstall the app. Order posts should also include Name, Product, and Offered price."
      : "We can improve this if you give me order posts with Name, Product, and Offered price, and keep each advance in that order's thread.";
    parts.push(ask);
  }
  return parts.join(" ");
}

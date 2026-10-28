import type { FieldExtract, MessageIntent } from "@/lib/types";

const PAYMENT_INTENT = /\b(paid|payment|advance|utr|neft|razorpay|cashfree|pinelabs|snapmint|upi|collected)\b/i;
const CUSTOMER = /(?:customer|client|name|cx)\s*[:\-]\s*([A-Za-z][A-Za-z .'()-]{1,80})/i;
const ORDER_HASH = /#PIK-?[A-Z0-9-]{3,}/gi;
const ORDER_DEMO = /\bDEMO-\d{3,}\b/gi;
const ORDER_LABELLED = /\border(?:\s+id|\s+ref(?:erence)?|\s+no|\s+number)?\s*[:#-]?\s*([A-Z][A-Z0-9-]{3,})/gi;
const AMOUNT =
  /(?:₹|rs\.?|inr)\s*(\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)|(\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(?:rs|inr)\b/gi;

const MODES: Array<[RegExp, string]> = [
  [/\brazorpay\b/i, "razorpay"],
  [/\bcashfree\b/i, "cashfree"],
  [/\bpinelabs\b/i, "pinelabs"],
  [/\bsnapmint\b/i, "snapmint"],
  [/\bneft\b/i, "NEFT"],
  [/\bupi\b/i, "UPI"],
  [/\bcash\b/i, "cash"],
  [/\bpos\b/i, "POS"],
  [/\bbajaj\b/i, "bajaj"],
];

export function toMinorUnits(amount: string): number | null {
  const normalized = amount.replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const paise = fraction.padEnd(2, "0").slice(0, 2);
  const minor = Number(whole) * 100 + Number(paise);
  if (!Number.isSafeInteger(minor)) return null;
  return minor;
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(key.startsWith("#") ? key : value.toUpperCase());
  }
  return result;
}

export function parseMessageText(text: string): FieldExtract {
  const orderReferences = unique([
    ...text.matchAll(ORDER_HASH).map((match) => match[0]),
    ...text.matchAll(ORDER_DEMO).map((match) => match[0]),
    ...text.matchAll(ORDER_LABELLED).map((match) => match[1] ?? ""),
  ].filter(Boolean));

  const amounts: FieldExtract["amounts"] = [];
  const seenMinors = new Set<string>();
  for (const match of text.matchAll(AMOUNT)) {
    const raw = match[1] ?? match[2];
    if (!raw) continue;
    const minor = toMinorUnits(raw);
    const key = minor == null ? raw : String(minor);
    if (seenMinors.has(key)) continue;
    seenMinors.add(key);
    amounts.push({ text: raw.replace(/\s+/g, ""), minor });
  }

  const customerMatch = text.match(CUSTOMER);
  const customerName = customerMatch?.[1]?.trim().replace(/[.,;:]+$/, "") || null;
  const paymentModeMention = MODES.find(([pattern]) => pattern.test(text))?.[1] ?? null;

  let intent: MessageIntent = "unclassified";
  if (PAYMENT_INTENT.test(text)) intent = "payment_mention";
  else if (orderReferences.length > 0) intent = "order_update";

  return {
    customerName,
    orderReferences,
    amounts,
    paymentModeMention,
    intent,
    preview: text.replace(/\s+/g, " ").trim().slice(0, 180),
    source: "rules",
  };
}

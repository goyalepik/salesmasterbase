import type { FieldExtract, MessageIntent } from "@/lib/types";

const PAYMENT_INTENT = /\b(paid|payment|advance|utr|neft|razorpay|cashfree|pinelabs|snapmint|upi|collected|received)\b/i;
const ORDER_SIGNAL = /\b(creat(?:e)?\s+order|order\s+for|dispatch)\b/i;
const CUSTOMER = /(?:customer|client|name|cx)\s*[:\-]\s*([A-Za-z][A-Za-z0-9 .'()-]{1,80})/i;
const ORDER_HASH = /#PIK-?[A-Z0-9-]{3,}/gi;
const ORDER_DEMO = /\bDEMO-\d{3,}\b/gi;
const ORDER_LABELLED = /\border(?:\s+id|\s+ref(?:erence)?|\s+no|\s+number)?\s*[:#-]?\s*([A-Z][A-Z0-9-]{3,})/gi;
const AMOUNT =
  /(?:₹|rs\.?|inr)\s*(\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)|(\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(?:rs|inr)\b/gi;
const ADVANCE_AMOUNT = /\b(\d{2,7})\s+advance\b|\badvance(?:\s+received)?\s+(\d{2,7})\b/gi;

const LABELS: Array<[string, keyof LabelBag]> = [
  ["offered price", "offeredPrice"],
  ["customer name", "customerName"],
  ["customer e-mail", "email"],
  ["customer email", "email"],
  ["customer type", "customerType"],
  ["mobile number", "phone"],
  ["phone number", "phone"],
  ["sample reference", "reference"],
  ["mobile", "phone"],
  ["phone", "phone"],
  ["gmail", "email"],
  ["e-mail", "email"],
  ["email", "email"],
  ["address", "address"],
  ["product", "product"],
  ["price", "price"],
  ["name", "customerName"],
  ["reference", "reference"],
];

type LabelBag = {
  customerName?: string;
  phone?: string;
  email?: string;
  address?: string;
  product?: string;
  price?: string;
  offeredPrice?: string;
  customerType?: string;
  reference?: string;
};

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

function unwrapSlack(value: string): string {
  return value
    .replace(/<mailto:([^|>]+)\|[^>]+>/gi, "$1")
    .replace(/<tel:([^|>]+)\|[^>]+>/gi, "$1")
    .replace(/<@([A-Z0-9]+)>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function readLabels(text: string): LabelBag {
  const found: LabelBag = {};
  for (const rawLine of text.split(/\n+/)) {
    const line = rawLine.replace(/^[\s•*-]+/, "").trim();
    if (!line) continue;
    const lower = line.toLowerCase();
    for (const [label, key] of LABELS) {
      if (!lower.startsWith(label)) continue;
      const rest = line.slice(label.length).trim().replace(/^[:\-]\s*/, "").trim();
      if (!rest || found[key]) break;
      found[key] = unwrapSlack(rest);
      break;
    }
  }
  return found;
}

function rupees(minor: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(minor / 100);
}

function safePreview(text: string, labels: LabelBag, offeredMinor: number | null): string {
  if (labels.customerName || labels.product || offeredMinor != null) {
    const parts = [
      labels.customerName,
      labels.product,
      offeredMinor != null ? `offered ${rupees(offeredMinor)}` : null,
      labels.customerType ? labels.customerType : null,
    ].filter(Boolean);
    return parts.join(" · ").slice(0, 180);
  }
  return unwrapSlack(text)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "")
    .replace(/\b\d{10,}\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

export function parseMessageText(text: string): FieldExtract {
  const labels = readLabels(text);
  const orderReferences = unique([
    ...text.matchAll(ORDER_HASH).map((match) => match[0]),
    ...text.matchAll(ORDER_DEMO).map((match) => match[0]),
    ...text.matchAll(ORDER_LABELLED).map((match) => match[1] ?? ""),
  ].filter(Boolean));

  const listPriceMinor = labels.price ? toMinorUnits(labels.price.replace(/[^\d.]/g, "")) : null;
  const offeredFromLabel = labels.offeredPrice ? toMinorUnits(labels.offeredPrice.replace(/[^\d.]/g, "")) : null;
  const offeredPriceMinor = offeredFromLabel ?? listPriceMinor;

  const amounts: FieldExtract["amounts"] = [];
  if (offeredPriceMinor != null && (labels.offeredPrice || labels.price)) {
    const raw = (labels.offeredPrice ?? labels.price ?? "").replace(/[^\d.]/g, "");
    amounts.push({ text: raw, minor: offeredPriceMinor });
  } else {
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
    for (const match of text.matchAll(ADVANCE_AMOUNT)) {
      const raw = match[1] ?? match[2];
      if (!raw) continue;
      const minor = toMinorUnits(raw);
      if (minor == null || seenMinors.has(String(minor))) continue;
      seenMinors.add(String(minor));
      amounts.push({ text: raw, minor });
    }
  }

  const customerName = labels.customerName
    || text.match(CUSTOMER)?.[1]?.trim().replace(/[.,;:]+$/, "")
    || null;
  const paymentModeMention = MODES.find(([pattern]) => pattern.test(text))?.[1] ?? null;

  const orderSheet = Boolean(labels.product || labels.price || labels.offeredPrice);
  let intent: MessageIntent = "unclassified";
  if (!orderSheet && /\b(advance|paid|payment|collected|received)\b/i.test(text)) intent = "payment_mention";
  else if (orderSheet || orderReferences.length > 0 || ORDER_SIGNAL.test(text)) intent = "order_update";
  else if (PAYMENT_INTENT.test(text)) intent = "payment_mention";

  return {
    customerName,
    orderReferences,
    amounts,
    paymentModeMention,
    intent,
    preview: safePreview(text, labels, offeredPriceMinor),
    source: "rules",
    product: labels.product ?? null,
    phone: labels.phone ?? null,
    email: labels.email ?? null,
    address: labels.address ?? null,
    customerType: labels.customerType ?? null,
    listPriceMinor,
    offeredPriceMinor,
    referenceNote: labels.reference ?? null,
  };
}

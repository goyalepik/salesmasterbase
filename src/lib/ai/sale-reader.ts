// The AI sale reader: a salesperson writes a sale in their own words in the sales channel (no /sale form). The AI
// reads the message, fills the same fields the long Slack form asks for, and the same checks as the form decide what
// is still missing. Pure apart from the model call, which is passed in (tests use a fake).

import { STATE_NAMES } from "@/lib/india/address";
import { POC_NAMES } from "@/lib/ops/pocs";
import { rankProducts } from "@/lib/ops/product-search";
import { normalisePhone } from "@/lib/ops/sale-input";
import type { Product } from "@/lib/ops/types";
import {
  COLLECT_BY,
  CX_TYPES,
  HUBS,
  INSTALLATIONS,
  PAID_BY,
  readOrderFields,
  SALE_TYPES,
  SLACK_PAYMENT_STATUSES,
  SLACK_SALE_SOURCES,
  WARRANTIES,
  type OpsSaleSubmission,
  type SaleProduct,
} from "@/lib/slack/sale-form";

/** One structured-output call: system prompt, user text, JSON schema → parsed JSON. */
export type SaleModel = (request: { name: string; system: string; user: string; schema: Record<string, unknown> }) => Promise<unknown>;

const text = (description: string) => ({ type: ["string", "null"], description });

const READ_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "isNewSale", "customer", "phone", "email", "address", "city", "state", "pincode", "billingAddress", "gst", "products", "hub", "poc",
    "cxType", "saleSource", "saleType", "paymentStatus", "paymentMode", "amountReceived", "utr", "expectedDelivery", "accessories",
    "extendedWarranty", "installation", "notes",
  ],
  properties: {
    isNewSale: { type: "boolean", description: "True only when the conversation books a NEW sale for a customer." },
    customer: text("Customer name."),
    phone: text("Customer mobile number, digits only."),
    email: text("Customer email."),
    address: text("Shipping address: house, street, area. Without city, state or pincode."),
    city: text("City, e.g. Bengaluru."),
    state: text("Indian state, full name, e.g. Karnataka. Infer it from the city or pincode when obvious."),
    pincode: text("6 digit pincode."),
    billingAddress: text("Billing address only if different from shipping."),
    gst: text("GSTIN or company GST details for a B2B sale."),
    products: {
      type: "array",
      description: "Each product sold, at most 3.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "model", "offeredPrice", "qty"],
        properties: {
          name: { type: "string", description: "Product as the salesperson wrote it." },
          model: { type: "string", description: "Brand and model only, short, for a catalogue search. e.g. 'Dreame L10s Ultra', 'iPhone 16 128GB'." },
          offeredPrice: { type: ["number", "null"], description: "Final price per unit in rupees after discount. Convert 65k to 65000, 1.2L to 120000." },
          qty: { type: "integer", minimum: 1 },
        },
      },
    },
    hub: text(`Seller's hub. One of: ${HUBS.join(", ")}.`),
    poc: text("Name of the salesperson (POC / CDE) who made the sale, if written."),
    cxType: text("New or Repeat customer."),
    saleSource: text(`One of: ${SLACK_SALE_SOURCES.join(", ")}.`),
    saleType: text(`One of: ${SALE_TYPES.join(", ")}.`),
    paymentStatus: text(`One of: ${SLACK_PAYMENT_STATUSES.join(", ")}.`),
    paymentMode: text(`If paid: one of ${PAID_BY.join(", ")}. If to be collected: one of ${COLLECT_BY.join(", ")}.`),
    amountReceived: { type: ["number", "null"], description: "Rupees received so far, for a partial payment." },
    utr: text("UTR / transaction ID if given."),
    expectedDelivery: text("Expected delivery date as YYYY-MM-DD."),
    accessories: text("Accessories included, if any."),
    extendedWarranty: text(`One of: ${WARRANTIES.join(", ")}.`),
    installation: text(`${INSTALLATIONS.join(" or ")}: Added when installation was sold or promised.`),
    notes: text("Anything else useful for the team, short."),
  },
} as const;

export type AiSaleRead = {
  isNewSale: boolean;
  customer: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  billingAddress: string | null;
  gst: string | null;
  products: Array<{ name: string; model: string; offeredPrice: number | null; qty: number }>;
  hub: string | null;
  poc: string | null;
  cxType: string | null;
  saleSource: string | null;
  saleType: string | null;
  paymentStatus: string | null;
  paymentMode: string | null;
  amountReceived: number | null;
  utr: string | null;
  expectedDelivery: string | null;
  accessories: string | null;
  extendedWarranty: string | null;
  installation: string | null;
  notes: string | null;
};

function readPrompt(today: string): string {
  return `You read sales messages from EPIK, a consumer electronics retailer in Bengaluru (robot vacuums, phones, TVs, appliances).
Salespeople (CDEs) post in a Slack channel in short, messy English or Hinglish, often with typos and no labels.
Today is ${today} (IST).

Decide whether the conversation books a NEW sale for a customer. Not a new sale: payment updates on an earlier order,
questions, delivery or stock talk, greetings, reminders, targets. A new sale names a customer and a product being sold.

Then fill every field you can. Rules:
- Use only what is written. Never invent a phone, address, price or name. Leave unknown fields null.
- The conversation may have a first message and later replies answering the bot's questions: combine them, later replies win.
- Prices are in rupees. "65k" = 65000, "1.2L" or "1.2 lakh" = 120000. offeredPrice is per unit.
- "paid", "full payment done" = Full paid. "advance", "token", "part payment" = Partial. "COD", "pending", "will pay on delivery" = To be collected.
- GPay, PhonePe, Paytm = UPI. "home demo", "demo at home" = Home Demo. "video call", "virtual", "online demo" = Virtual Demo.
- A free case, cover, mop pads or other add-on without its own price goes in accessories, not products.
- Dates like "tomorrow" or "Monday" become YYYY-MM-DD from today.
- Keep notes short. Do not repeat fields in notes.`;
}

/** Reads the conversation (first message plus any replies) into sale fields. Throws when the model fails. */
export async function readSaleConversation(conversation: string, model: SaleModel, today: string): Promise<AiSaleRead> {
  const raw = (await model({ name: "sale", system: readPrompt(today), user: conversation.slice(0, 6000), schema: READ_SCHEMA as unknown as Record<string, unknown> })) as Partial<AiSaleRead> | null;
  if (!raw || typeof raw !== "object") throw new Error("The AI gave no answer.");
  const s = (value: unknown) => (typeof value === "string" && value.trim() ? value.replace(/\s+/g, " ").trim().slice(0, 300) : null);
  const n = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null);
  return {
    isNewSale: raw.isNewSale === true,
    customer: s(raw.customer),
    phone: s(raw.phone),
    email: s(raw.email),
    address: s(raw.address),
    city: s(raw.city),
    state: s(raw.state),
    pincode: s(raw.pincode),
    billingAddress: s(raw.billingAddress),
    gst: s(raw.gst),
    products: (Array.isArray(raw.products) ? raw.products : [])
      .filter((p) => p && typeof p === "object" && s(p.name))
      .slice(0, 3)
      .map((p) => ({ name: s(p.name)!, model: s(p.model) ?? s(p.name)!, offeredPrice: n(p.offeredPrice), qty: Number.isInteger(p.qty) && p.qty > 0 ? Math.min(p.qty, 3) : 1 })),
    hub: s(raw.hub),
    poc: s(raw.poc),
    cxType: s(raw.cxType),
    saleSource: s(raw.saleSource),
    saleType: s(raw.saleType),
    paymentStatus: s(raw.paymentStatus),
    paymentMode: s(raw.paymentMode),
    amountReceived: n(raw.amountReceived),
    utr: s(raw.utr),
    expectedDelivery: s(raw.expectedDelivery),
    accessories: s(raw.accessories),
    extendedWarranty: s(raw.extendedWarranty),
    installation: s(raw.installation),
    notes: s(raw.notes),
  };
}

// ── Snapping loose words onto the form's choices ─────────────────────────────

const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The option the value means: exact (ignoring case and spaces), an alias, or the one option it starts. */
export function snap(value: string | null, options: readonly string[], aliases: Record<string, string> = {}): string | null {
  if (!value) return null;
  const key = squash(value);
  if (!key) return null;
  const exact = options.find((o) => squash(o) === key);
  if (exact) return exact;
  for (const [alias, option] of Object.entries(aliases)) if (key === squash(alias) || key.includes(squash(alias))) return option;
  const starts = options.filter((o) => squash(o).startsWith(key) || key.startsWith(squash(o)));
  return starts.length === 1 ? starts[0]! : null;
}

const HUB_ALIASES = { hsr: "HSR HQ", mahadevapura: "Mahadevpura", whitefield: "Mahadevpura", headoffice: "HQ", jaynagar: "Jayanagar" };
const SOURCE_ALIASES = { home: "Home Demo", virtual: "Virtual Demo", video: "Virtual Demo", online: "Virtual Demo" };
const STATUS_ALIASES = { fullpayment: "Full paid", paid: "Full paid", advance: "Partial", token: "Partial", partpayment: "Partial", cod: "To be collected", pending: "To be collected", collect: "To be collected" };
const PAID_ALIASES = { gpay: "UPI", phonepe: "UPI", paytm: "UPI", googlepay: "UPI", creditcard: "Card", debitcard: "Card", rtgs: "NEFT", imps: "NEFT", banktransfer: "NEFT" };
const COLLECT_ALIASES = {
  cod: "Cash on delivery", cash: "Cash on delivery", upi: "UPI on delivery", gpay: "UPI on delivery", phonepe: "UPI on delivery",
  card: "Card on delivery", link: "Payment link",
};
const WARRANTY_ALIASES = { no: "None", nil: "None", "1yr": "1 year", "2yr": "2 year", "3yr": "3 year", "1": "1 year", "2": "2 year", "3": "3 year" };

/** The POC as the team list spells it: full name, or the one person with that first name. Otherwise as written. */
export function snapPoc(value: string | null): string | null {
  if (!value) return null;
  const key = squash(value);
  const exact = POC_NAMES.find((p) => squash(p) === key);
  if (exact) return exact;
  const first = POC_NAMES.filter((p) => squash(p.split(" ")[0]!) === key);
  if (first.length === 1) return first[0]!;
  return value.length >= 2 ? value : null;
}

/** Only a name that is on the team list (used when the message names no POC: the person who posted it). */
export function knownPoc(value: string | null): string | null {
  const snapped = snapPoc(value);
  return snapped && POC_NAMES.includes(snapped) ? snapped : null;
}

function stateFor(read: AiSaleRead): string | null {
  const named = snap(read.state, STATE_NAMES);
  if (named) return named;
  if (/bengaluru|bangalore/i.test(read.city ?? "") || /^56\d{4}$/.test((read.pincode ?? "").replace(/\s/g, ""))) return "Karnataka";
  return null;
}

// ── Products ─────────────────────────────────────────────────────────────────

/** A product line after the catalogue search. `choices` is set when the salesperson must tap the right one. */
export type ProductSlot = { name: string; model: string; offeredMinor: number | null; sku: string | null; choices: Product[] };

/** A product the salesperson tapped: a SKU, or null for "not in the list" (kept as written). */
export type ProductPick = { sku: string | null; name: string };

const ROUGH = 10;

function words(value: string): string[] {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
}

/** The catalogue products a written model could be: every word first, then fewer words if nothing matches. */
export function candidates(catalogue: Product[], model: string): Product[] {
  const terms = words(model);
  for (let size = terms.length; size >= Math.min(2, terms.length); size -= 1) {
    const found = rankProducts(catalogue, terms.slice(0, size).join(" "), ROUGH, { preferActive: true });
    if (found.length) return found;
  }
  return [];
}

/** One clear winner: the only match, or a name that holds exactly the written words and nothing more. */
function clearWinner(found: Product[], model: string): Product | null {
  if (found.length === 1) return found[0]!;
  const want = words(model).join(" ");
  const exact = found.filter((p) => words(p.name).join(" ") === want || words(p.sku).join(" ") === want);
  return exact.length === 1 ? exact[0]! : null;
}

const CHOOSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sku", "sure"],
  properties: {
    sku: { type: ["string", "null"], description: "The SKU of the product the salesperson means, or null." },
    sure: { type: "boolean", description: "True only when the message clearly means exactly this product (model, size, variant)." },
  },
} as const;

/** Asks the AI which catalogue product the salesperson meant. Null unless it is sure. */
async function chooseWithAi(model: SaleModel, written: string, found: Product[]): Promise<Product | null> {
  try {
    const list = found.map((p) => `${p.sku} | ${p.name}`).join("\n");
    const raw = (await model({
      name: "pick_product",
      system: "You match a product a salesperson wrote to one catalogue product. Pick only when the model, size and variant clearly match. If two could fit, say not sure.",
      user: `Written: ${written}\n\nCatalogue (SKU | name):\n${list}`,
      schema: CHOOSE_SCHEMA as unknown as Record<string, unknown>,
    })) as { sku?: unknown; sure?: unknown } | null;
    if (!raw || raw.sure !== true || typeof raw.sku !== "string") return null;
    return found.find((p) => p.sku === raw.sku) ?? null;
  } catch {
    return null;
  }
}

/**
 * Turns the written products into catalogue lines. Picks the salesperson already tapped win. A product with no match
 * at all is kept as written (like "Product not in the list" on the form); inventory maps it later.
 */
export async function resolveProducts(
  read: AiSaleRead,
  catalogue: Product[],
  picks: Map<number, ProductPick>,
  model: SaleModel | null,
  /** The full product list, when the Shopify catalogue has no match (as the form's product search does). */
  fallback?: (q: string) => Promise<Product[]>,
): Promise<ProductSlot[]> {
  const lines = read.products.flatMap((p) => Array.from({ length: p.qty }, () => p)).slice(0, 3);
  const slots: ProductSlot[] = [];
  for (const [index, line] of lines.entries()) {
    const offeredMinor = line.offeredPrice != null && line.offeredPrice < 100_000_000 ? Math.round(line.offeredPrice * 100) : null;
    const base = { name: line.name, model: line.model, offeredMinor };
    const pick = picks.get(index + 1);
    if (pick) {
      slots.push({ ...base, name: pick.name || line.name, sku: pick.sku, choices: [] });
      continue;
    }
    let found = candidates(catalogue, line.model);
    if (!found.length && fallback) found = await fallback(line.model).catch(() => []);
    if (!found.length) {
      slots.push({ ...base, sku: null, choices: [] });
      continue;
    }
    const winner = clearWinner(found, line.model) ?? (model ? await chooseWithAi(model, `${line.name} (${line.model})`, found) : null);
    slots.push(winner ? { ...base, name: winner.name, sku: winner.sku, choices: [] } : { ...base, sku: null, choices: found.slice(0, 3) });
  }
  return slots;
}

// ── From the read to the form's sale, or the list of what is missing ─────────

export type SaleGap = { key: string; question: string };

const QUESTIONS: Record<string, string> = {
  customer: "Customer name",
  phone: "Customer phone (10 digits)",
  product: "Product and offered price",
  shipping_address: "Shipping address (house, street, area)",
  city: "City",
  state: "State",
  pincode: "Pincode (6 digits)",
  hub: `Hub: ${HUBS.join(", ")}`,
  poc: "POC (who sold it)",
  cx_type: "New or repeat customer",
  sale_source: "Home Demo or Virtual Demo",
  sale_type: "Follow up or same day",
  offered_price: "Offered price",
  payment_status: "Payment: full paid, partial or to be collected",
  paid_by: "Paid by: cash, UPI, card, NEFT, Snapmint or Bajaj",
  collect_by: "How it will be collected: cash on delivery, UPI on delivery, card on delivery, payment link, Snapmint or Bajaj",
  amount_received: "Amount received so far",
};

function rupees(minor: number): string {
  return `₹${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function minorText(minor: number): string {
  const r = minor / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}

export type BuiltSale = { ok: true; sale: OpsSaleSubmission } | { ok: false; gaps: SaleGap[]; choose: Array<{ index: number; slot: ProductSlot }> };

/**
 * Applies the long form's own checks (`readOrderFields`) to what the AI read. Add-ons default to None, as on the form.
 * `fallbackPoc`: the person who posted, used only when the message names no POC and they are on the team list.
 */
export function buildSale(read: AiSaleRead, slots: ProductSlot[], opts: { salespersonId: string; fallbackPoc: string | null }): BuiltSale {
  const status = snap(read.paymentStatus, SLACK_PAYMENT_STATUSES, STATUS_ALIASES) ?? "";
  const paid = status === "Full paid" || status === "Partial";
  const mode = status ? (paid ? snap(read.paymentMode, PAID_BY, PAID_ALIASES) : snap(read.paymentMode, COLLECT_BY, COLLECT_ALIASES)) ?? "" : "";
  const first = slots[0];
  const fields = readOrderFields(
    {
      customer: read.customer ?? "",
      product: first?.name ?? "",
      email: read.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(read.email) ? read.email : "",
      shippingAddress: read.address ?? "",
      pincode: read.pincode ?? "",
      city: read.city ?? "",
      state: stateFor(read) ?? "",
      billingAddress: read.billingAddress ?? "",
      hub: snap(read.hub, HUBS, HUB_ALIASES) ?? "",
      cxType: snap(read.cxType, CX_TYPES, { returning: "Repeat", old: "Repeat", existing: "Repeat" }) ?? "",
      poc: snapPoc(read.poc) ?? opts.fallbackPoc ?? "",
      saleSource: snap(read.saleSource, SLACK_SALE_SOURCES, SOURCE_ALIASES) ?? "",
      saleType: snap(read.saleType, SALE_TYPES, { followup: "Follow up", sameday: "Same day", today: "Same day" }) ?? "",
      listPrice: "",
      offeredPrice: first?.offeredMinor != null ? minorText(first.offeredMinor) : "",
      paymentStatus: status,
      paymentMode: mode,
      gst: read.gst ?? "",
      notes: read.notes ?? "",
      accessories: read.accessories ?? "",
      extendedWarranty: snap(read.extendedWarranty, WARRANTIES, WARRANTY_ALIASES) ?? "None",
      installation: /^(added|yes|y|included|free|paid|done)/i.test(read.installation ?? "") ? "Added" : "None",
    },
    { listPriceRequired: false, placeRequired: true, saleSources: SLACK_SALE_SOURCES, paymentStatuses: SLACK_PAYMENT_STATUSES, paymentModes: paid ? PAID_BY : COLLECT_BY },
  );

  const gaps: SaleGap[] = [];
  const add = (key: string, question = QUESTIONS[key] ?? key) => {
    if (!gaps.some((g) => g.key === key)) gaps.push({ key, question });
  };
  if (!fields.ok) {
    for (const key of Object.keys(fields.errors)) {
      if (key === "email" || key === "extended_warranty" || key === "installation") continue;
      if (key === "payment_mode") {
        if (status) add(paid ? "paid_by" : "collect_by");
        continue;
      }
      if (key === "product" || key === "offered_price") continue; // asked per product below
      add(key);
    }
  }
  const phone = normalisePhone(read.phone);
  if (!phone) add("phone");
  if (!slots.length) add("product");
  for (const [index, slot] of slots.entries()) {
    if (slot.offeredMinor == null) add(`offered_price_${index + 1}`, `Offered price for ${slot.name}`);
  }
  const amount = status === "Partial" && read.amountReceived ? Math.round(read.amountReceived * 100) : null;
  if (status === "Partial" && amount == null) add("amount_received");
  const choose = slots.flatMap((slot, i) => (slot.choices.length ? [{ index: i + 1, slot }] : []));
  // Keep the order of the form: name and phone first.
  const order = Object.keys(QUESTIONS);
  gaps.sort((a, b) => (order.indexOf(a.key) + 1 || 50) - (order.indexOf(b.key) + 1 || 50));

  if (gaps.length || choose.length || !fields.ok || !phone || !first) return { ok: false, gaps, choose };
  if (!/^U[A-Z0-9]{6,}$/.test(opts.salespersonId)) return { ok: false, gaps: [{ key: "poster", question: "Slack did not say who posted this" }], choose: [] };

  const offered = first.offeredMinor ?? 0;
  const received = amount ?? (status === "Full paid" ? slots.reduce((sum, s) => sum + (s.offeredMinor ?? 0), 0) : null);
  const utr = (read.utr ?? "").replace(/\s+/g, "");
  const validUtr = /^[A-Za-z0-9-]{4,40}$/.test(utr) ? utr : "";
  const expected = /^\d{4}-\d{2}-\d{2}$/.test(read.expectedDelivery ?? "") ? read.expectedDelivery! : null;
  const products: SaleProduct[] = slots.map((slot) => ({ sku: slot.sku, name: slot.name, offeredMinor: slot.offeredMinor ?? 0 }));
  return {
    ok: true,
    sale: {
      fields: {
        ...fields.fields,
        offeredPrice: minorText(offered),
        paymentStatus: paid && received != null ? `${status}, ${rupees(received)} received` : status,
        paymentMode: paid && validUtr ? `${mode}, UTR ${validUtr}` : mode,
        notes: [fields.fields.notes, "Read from a Slack message by the AI"].filter(Boolean).join(". "),
        salespersonId: opts.salespersonId,
        ...(expected ? { expectedDelivery: expected } : {}),
      },
      phone,
      products,
    },
  };
}

// ── The Slack thread: markers the bot leaves, and the conversation for the AI ─

export const AI_SALE_ASK = "(epik-ai-sale:ask)";
export const AI_SALE_DONE = "(epik-ai-sale:done)";
const PICK_RE = /\(epik-ai-sale:pick n=(\d) sku=([^)\s]*)\)/;

export function pickMarker(index: number, sku: string | null): string {
  return `(epik-ai-sale:pick n=${index} sku=${sku ? encodeURIComponent(sku) : "-"})`;
}

export type ThreadMessage = { ts: string; user?: string; bot_id?: string; text?: string };

/** The products tapped in the thread, latest tap wins. */
export function picksFrom(messages: ThreadMessage[]): Map<number, ProductPick> {
  const picks = new Map<number, ProductPick>();
  for (const m of messages) {
    if (!m.bot_id) continue;
    const match = PICK_RE.exec(m.text ?? "");
    if (!match) continue;
    const name = (m.text ?? "").replace(PICK_RE, "").trim().replace(/^Product \d: /, "").replace(/ · SKU .*$/, "").replace(/ \(not in the list\)$/, "").trim();
    picks.set(Number(match[1]), { sku: match[2] && match[2] !== "-" ? decodeURIComponent(match[2]) : null, name });
  }
  return picks;
}

/** What the thread says about the reader: is it waiting for answers, finished, how many times it has asked. */
export function threadState(messages: ThreadMessage[]): { asked: number; done: boolean } {
  let asked = 0;
  let done = false;
  for (const m of messages) {
    if (!m.bot_id) continue;
    if (m.text?.includes(AI_SALE_ASK)) asked += 1;
    if (m.text?.includes(AI_SALE_DONE)) done = true;
  }
  return { asked, done };
}

/** The conversation as the AI reads it: the first message, then the bot's questions and the replies, in order. */
export function conversationText(messages: ThreadMessage[], names: Map<string, string>): string {
  return messages
    .map((m, i) => {
      const body = (m.text ?? "").replace(/\(epik-ai-sale:[^)]*\)/g, "").trim();
      if (!body) return null;
      if (m.bot_id) return `Bot: ${body}`;
      const who = (m.user && names.get(m.user)) || "Salesperson";
      return i === 0 ? `First message, posted by ${who}:\n${body}` : `Reply from ${who}: ${body}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

/** Worth asking the AI at all: a sale always has some digits (phone, price) and a few words. */
export function mightBeSale(message: string): boolean {
  const body = message.replace(/<[^>]+>/g, " ").trim();
  return body.length >= 20 && /\d{3,}/.test(body.replace(/[\s,.-]/g, ""));
}

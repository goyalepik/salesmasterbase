// The CD tracking page and the app's order status follow the Sales Masterbase (SMB) "Sales Tracker" tab, where
// logistics sets the status. This file reads its rows (by heading, so columns can move), maps each Logistic Status
// code to plain words, and joins them to the app's own orders (Shopify and Slack) by #PIK, so every order shows once.
// Pure (no "server-only"): tests use it.

import { deliveryStatusOf, type DeliveryStatus } from "@/lib/ops/delivery-status";
import type { OrderSummary } from "@/lib/ops/types";

export type TrackStatus =
  | "new" | "not_confirmed" | "confirmed" | "arranging" | "waiting" | "hub" | "on_the_way" | "brand" | "delivered"
  | "on_hold" | "cancelled" | "other";

export const TRACK_LABELS: Record<TrackStatus, string> = {
  new: "New sale",
  not_confirmed: "Not confirmed yet",
  confirmed: "Confirmed",
  arranging: "Being arranged",
  waiting: "Waiting for stock",
  hub: "At the hub",
  on_the_way: "On the way",
  brand: "Brand delivers",
  delivered: "Delivered",
  on_hold: "On hold",
  cancelled: "Cancelled",
  other: "See status",
};

/** One line a CD can read out to the customer. */
export const TRACK_MEANING: Record<TrackStatus, string> = {
  new: "Sale recorded. Logistics will confirm it soon.",
  not_confirmed: "The order isn't confirmed yet. Our team will confirm it.",
  confirmed: "Order confirmed. Our team is arranging the product.",
  arranging: "Our team is arranging the product for this order.",
  waiting: "Waiting for the product to reach our warehouse.",
  hub: "The product is at our hub and goes out next.",
  on_the_way: "Dispatched and on the way to the customer.",
  brand: "The brand delivers this one directly to the customer.",
  delivered: "Delivered to the customer.",
  on_hold: "Paused for now. Logistics will update it.",
  cancelled: "This order is cancelled.",
  other: "Ask logistics what this status means.",
};

export const TRACK_TONE: Record<TrackStatus, string> = {
  new: "tone-info",
  not_confirmed: "tone-warn",
  confirmed: "tone-info",
  arranging: "tone-violet",
  waiting: "tone-violet",
  hub: "tone-accent",
  on_the_way: "tone-teal",
  brand: "tone-teal",
  delivered: "tone-good",
  on_hold: "tone-warn",
  cancelled: "tone-muted",
  other: "tone-muted",
};

/** The chart on the CD page: four plain stages, in the order an order moves. */
export const STAGES = [
  { id: "starting", label: "Not started", colour: "#f2a93b", statuses: ["new", "not_confirmed", "confirmed", "on_hold", "other"] },
  { id: "stock", label: "Arranging stock", colour: "#8a66f3", statuses: ["arranging", "waiting"] },
  { id: "moving", label: "Hub or on the way", colour: "#23bec9", statuses: ["hub", "on_the_way", "brand"] },
  { id: "delivered", label: "Delivered", colour: "#22a565", statuses: ["delivered"] },
] as const satisfies ReadonlyArray<{ id: string; label: string; colour: string; statuses: readonly TrackStatus[] }>;
export type StageId = (typeof STAGES)[number]["id"];

export const stageOf = (s: TrackStatus): StageId | null => STAGES.find((g) => (g.statuses as readonly TrackStatus[]).includes(s))?.id ?? null;

/** The Logistic Status codes logistics uses in the SMB. */
const CODES: Record<string, TrackStatus> = {
  NOTCONFIRMED: "not_confirmed",
  CONFIRMED: "confirmed",
  EPIKRTS: "arranging",
  EPIKRTSHUB: "arranging",
  EPIKRTSOUT: "waiting",
  EPIKHUB: "hub",
  EPIKINTRANSITCX: "on_the_way",
  EPIKOFD: "on_the_way",
  EPIKDELIVERED: "delivered",
  BRANDDELCX: "brand",
  CXCANCELLED: "cancelled",
  EPIKCANCELLED: "cancelled",
};

/** Plain words in "Delivery Status", used only when "Logistic Status" is empty. */
function fromWords(raw: string): TrackStatus | null {
  const s = raw.toLowerCase();
  if (!s.trim()) return null;
  if (/cancel/.test(s)) return "cancelled";
  if (/delivered/.test(s)) return "delivered";
  if (/not confirmed/.test(s)) return "not_confirmed";
  if (/hub/.test(s)) return "hub";
  if (/inventory|stock/.test(s)) return "waiting";
  if (/confirm/.test(s)) return "confirmed";
  return "other";
}

export function trackStatusOf(logistic: string, delivery = ""): TrackStatus {
  const code = logistic.toUpperCase().replace(/[^A-Z]/g, "");
  if (code) return CODES[code] ?? fromWords(logistic) ?? "other";
  return fromWords(delivery) ?? "not_confirmed";
}

/** The app's own status for an order the SMB doesn't have yet. */
export function trackStatusFromApp(status: DeliveryStatus): TrackStatus {
  const map: Record<DeliveryStatus, TrackStatus> = {
    new: "new", waiting_stock: "waiting", ready: "hub", out_for_delivery: "on_the_way", delivered: "delivered", on_hold: "on_hold", cancelled: "cancelled",
  };
  return map[status];
}

/** The app status an SMB status moves an order to; null leaves the order where it is. */
export function deliveryStatusFromSheet(status: TrackStatus): DeliveryStatus | null {
  const map: Partial<Record<TrackStatus, DeliveryStatus>> = {
    arranging: "waiting_stock", waiting: "waiting_stock", hub: "ready", on_the_way: "out_for_delivery", brand: "out_for_delivery",
    delivered: "delivered", cancelled: "cancelled",
  };
  return map[status] ?? null;
}

/** Not delivered and not cancelled: the orders a customer may call about. */
export const isOpen = (s: TrackStatus) => s !== "delivered" && s !== "cancelled";

export type TrackProduct = { name: string; serial: string | null };

export type TrackOrder = {
  /** Used in the link to the order: the #PIK number, else the app order or sheet row. */
  id: string;
  /** Where it came from: the SMB, the app, or both (matched by #PIK). */
  source: "sheet" | "app" | "both";
  /** Row of the order's first line in the SMB, as the sheet numbers it. */
  row: number | null;
  appOrderId: string | null;
  shopify: string | null;
  customer: string;
  phone: string | null;
  poc: string | null;
  hub: string | null;
  products: TrackProduct[];
  logisticStatus: string;
  deliveryStatus: string;
  status: TrackStatus;
  date: string | null;
  /** For sorting, newest first (ms). */
  sortAt: number;
  dispatchedOn: string | null;
  deliveredOn: string | null;
  paymentStatus: string | null;
  update: string | null;
  updateBy: string | null;
  city: string | null;
  address: string | null;
};

type Field =
  | "shopify" | "date" | "customer" | "phone" | "product" | "poc" | "hub" | "payment" | "logistic" | "delivery"
  | "serial" | "owner" | "remarks" | "city" | "address" | "dispatched" | "delivered";

/** The Sales Tracker headings (and close spellings). Matching ignores case, spaces and punctuation. */
const HEADINGS: Record<Field, string[]> = {
  shopify: ["Shopify Order ID", "Shopify Order", "Order ID"],
  date: ["Invoice Date", "Order Date", "Date"],
  customer: ["Customer Name", "Customer"],
  phone: ["Phone Number", "Phone", "Mobile", "Mobile Number"],
  product: ["Product Name", "Product"],
  poc: ["POC", "POC Name"],
  hub: ["HUB"],
  payment: ["Payment Status"],
  logistic: ["Logistic Status", "Logistics Status"],
  delivery: ["Delivery Status"],
  serial: ["Product Serial number", "Serial number", "Serial"],
  owner: ["Action Owner"],
  remarks: ["Action Owner's Remarks", "Action Owner Remarks", "Remarks"],
  city: ["Delivery City Cohort", "City"],
  address: ["Delivery Address", "Address"],
  dispatched: ["Dipatch Date", "Dispatch Date", "Dispatched On"],
  delivered: ["Delivery date", "Delivered On"],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const LOOKUP = new Map<string, Field>();
for (const [field, names] of Object.entries(HEADINGS) as Array<[Field, string[]]>) for (const n of names) if (!LOOKUP.has(norm(n))) LOOKUP.set(norm(n), field);

function columnsOf(headings: string[]): Partial<Record<Field, number>> {
  const out: Partial<Record<Field, number>> = {};
  headings.forEach((h, i) => {
    const field = LOOKUP.get(norm(h ?? ""));
    if (field && out[field] == null) out[field] = i;
  });
  return out;
}

const clean = (v: string | undefined) => (v ?? "").replace(/\s+/g, " ").trim();
const orNull = (v: string) => (v ? v : null);

/** "01/11/2026" (the SMB's day/month/year) at noon IST, in ms; null when it isn't a date. */
export function sheetDateMs(v: string | null | undefined): number | null {
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(clean(v ?? ""));
  if (!m) return null;
  const ms = Date.parse(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T12:00:00+05:30`);
  return Number.isFinite(ms) ? ms : null;
}

/** Every #PIK number in a cell ("#PIK5082/#PIK5447" has two). */
export const pikNumbers = (v: string | null | undefined) => (v ?? "").match(/\d{3,}/g) ?? [];

/** The last 10 digits of a phone number. */
const phoneKey = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "").slice(-10);

/**
 * The Sales Tracker rows as orders, newest (lowest in the sheet) first. The heading row is the one among the first
 * rows with "Shopify Order ID" and "POC". One row per product: rows with the same #PIK right after each other are one
 * order. Rows with no #PIK, customer or product are skipped. A "Sheet row" column (first), when present, gives the
 * row numbers.
 */
export function readSmbOrders(rows: string[][]): TrackOrder[] {
  let headerAt = -1;
  let col: Partial<Record<Field, number>> = {};
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const found = columnsOf(rows[i] ?? []);
    if (found.shopify != null && found.poc != null) {
      headerAt = i;
      col = found;
      break;
    }
  }
  if (headerAt < 0) return [];
  const at = (row: string[], field: Field) => (col[field] == null ? "" : clean(row[col[field]!]));

  const orders: TrackOrder[] = [];
  const seen = new Map<string, number>();
  let last: TrackOrder | null = null;
  rows.forEach((row, i) => {
    if (i <= headerAt) return;
    const shopify = at(row, "shopify");
    const customer = at(row, "customer");
    const product = at(row, "product");
    if (!shopify && !customer && !product) return;
    const serial = orNull(at(row, "serial"));
    if (last && shopify && last.shopify === shopify) {
      if (product) last.products.push({ name: product, serial });
      return;
    }
    const logisticStatus = at(row, "logistic");
    const deliveryStatus = at(row, "delivery");
    const base = pikNumbers(shopify)[0] ?? `r${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const date = orNull(at(row, "date"));
    const order: TrackOrder = {
      id: n > 1 ? `${base}-${n}` : base,
      source: "sheet",
      row: i + 1,
      appOrderId: null,
      shopify: orNull(shopify),
      customer: customer || "Customer not named",
      phone: orNull(at(row, "phone")),
      poc: orNull(at(row, "poc")),
      hub: orNull(at(row, "hub")),
      products: product ? [{ name: product, serial }] : [],
      logisticStatus,
      deliveryStatus,
      status: trackStatusOf(logisticStatus, deliveryStatus),
      date,
      // Same day: the lower row is newer.
      sortAt: (sheetDateMs(date) ?? 0) + i,
      dispatchedOn: orNull(at(row, "dispatched")),
      deliveredOn: orNull(at(row, "delivered")),
      paymentStatus: orNull(at(row, "payment")),
      update: orNull(at(row, "remarks")),
      updateBy: orNull(at(row, "owner")),
      city: orNull(at(row, "city")),
      address: orNull(at(row, "address")),
    };
    orders.push(order);
    last = order;
  });
  return orders.reverse();
}

const ddmmyyyy = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso)) : null;

/** An app order (Shopify or Slack) the SMB doesn't have yet, in the same shape. */
export function trackOrderFromApp(o: OrderSummary): TrackOrder {
  const lines = o.lines.filter((l) => l.status !== "cancelled" && l.status !== "rejected");
  return {
    id: pikNumbers(o.shopifyOrderId)[0] ?? o.id,
    source: "app",
    row: null,
    appOrderId: o.id,
    shopify: o.shopifyOrderId,
    customer: o.customerName,
    phone: o.phone,
    poc: o.poc,
    hub: o.hub,
    products: (lines.length ? lines : o.lines).map((l) => ({ name: `${l.productName}${l.qty > 1 ? ` ×${l.qty}` : ""}`, serial: l.serialNo })),
    logisticStatus: "",
    deliveryStatus: "",
    status: trackStatusFromApp(deliveryStatusOf(o.stage)),
    date: ddmmyyyy(o.createdAt),
    sortAt: Date.parse(o.createdAt),
    dispatchedOn: ddmmyyyy(o.dispatchedAt),
    deliveredOn: ddmmyyyy(o.deliveredAt),
    paymentStatus: null,
    update: null,
    updateBy: null,
    city: null,
    address: o.shippingAddress,
  };
}

/**
 * Every order once: the SMB's orders (its status is the truth), joined to the app's orders by #PIK, or by phone when
 * the app order has no #PIK yet. App orders the SMB doesn't have yet (a sale made today) are added with the app's
 * status. Newest first.
 */
export function mergeOrders(sheetOrders: TrackOrder[], app: OrderSummary[]): TrackOrder[] {
  // Copies: the sheet's orders are cached between visits and must not change.
  const sheet = sheetOrders.map((s) => ({ ...s }));
  const byPik = new Map<string, TrackOrder>();
  const byPhone = new Map<string, TrackOrder>();
  for (const s of sheet) {
    for (const n of pikNumbers(s.shopify)) if (!byPik.has(n)) byPik.set(n, s);
    const p = phoneKey(s.phone);
    if (p.length === 10 && !byPhone.has(p)) byPhone.set(p, s);
  }
  const out = [...sheet];
  const taken = new Set<TrackOrder>();
  for (const o of app) {
    const piks = pikNumbers(o.shopifyOrderId);
    let match = piks.map((n) => byPik.get(n)).find(Boolean) ?? null;
    if (!match && !piks.length) {
      const p = phoneKey(o.phone);
      const candidate = p.length === 10 ? byPhone.get(p) : undefined;
      // Same customer within a week: the same sale typed in both places.
      if (candidate && !candidate.appOrderId && Math.abs(candidate.sortAt - Date.parse(o.createdAt)) < 7 * 86_400_000) match = candidate;
    }
    if (match && !taken.has(match)) {
      taken.add(match);
      match.source = "both";
      match.appOrderId = o.id;
      match.poc ??= o.poc;
      match.phone ??= o.phone;
      match.address ??= o.shippingAddress;
      continue;
    }
    if (match) continue;
    out.push(trackOrderFromApp(o));
  }
  return out.sort((a, b) => b.sortAt - a.sortAt);
}

// ── Names ────────────────────────────────────────────────────────────────────

/** Website orders carry "Shopify direct" in the POC column instead of a person (this is its key). */
export const WEBSITE_POC = "direct shopify";

/**
 * One key per person: "Prasanth D - CDE", "D Prasanth" and "d prasanth " are the same. The role after " - " is
 * dropped and the words are sorted, so the order of first name and initial doesn't matter.
 */
export function pocKey(name: string | null | undefined): string {
  const base = clean(name ?? "").replace(/\s+-\s+.*$/, "").replace(/\(.*?\)/g, "");
  return base.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).sort().join(" ");
}

export type PocRow = { key: string; name: string; total: number; open: number; stages: Record<StageId, number> };

const emptyStages = (): Record<StageId, number> => ({ starting: 0, stock: 0, moving: 0, delivered: 0 });

/** One row per CD, A to Z, with how many of their orders are still open. Website orders and blanks are left out. */
export function pocRows(orders: TrackOrder[], aliases: Record<string, string> = {}): PocRow[] {
  const byKey = new Map<string, { names: Map<string, number>; total: number; open: number; stages: Record<StageId, number> }>();
  for (const o of orders) {
    const key = personKey(o.poc, aliases);
    if (!key || key === WEBSITE_POC) continue;
    const entry = byKey.get(key) ?? { names: new Map(), total: 0, open: 0, stages: emptyStages() };
    // The SMB's spelling is the one shown (the team's list); app spellings only when the SMB has none.
    const weight = o.source === "app" ? 0.01 : 1;
    entry.names.set(o.poc!, (entry.names.get(o.poc!) ?? 0) + weight);
    entry.total++;
    if (isOpen(o.status)) entry.open++;
    const stage = stageOf(o.status);
    if (stage) entry.stages[stage]++;
    byKey.set(key, entry);
  }
  const best = (names: Map<string, number>) =>
    [...names.entries()].sort((a, b) => b[1] - a[1] || Number(/[A-Z]/.test(b[0])) - Number(/[A-Z]/.test(a[0])))[0][0].replace(/\s+-\s+.*$/, "");
  return [...byKey.entries()]
    .map(([key, e]) => ({ key, name: best(e.names), total: e.total, open: e.open, stages: e.stages }))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

/** The person an order belongs to, after the spellings OpenAI matched (aliases: key → key). */
export function personKey(poc: string | null | undefined, aliases: Record<string, string> = {}): string {
  const key = pocKey(poc);
  return aliases[key] ?? key;
}

/** How many orders are in each chart stage. */
export function stageCounts(orders: TrackOrder[]): Record<StageId, number> {
  const out = emptyStages();
  for (const o of orders) {
    const s = stageOf(o.status);
    if (s) out[s]++;
  }
  return out;
}

/**
 * Does a name match what the CD typed? Each typed word starts a word of the name ("bal", "baljeet s"), or the letters
 * are the name's initials ("bs" for Baljeet Singh).
 */
export function nameMatches(name: string, typed: string): boolean {
  const q = typed.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
  if (!q) return true;
  const words = name.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const parts = q.split(/\s+/);
  if (parts.every((p) => words.some((w) => w.startsWith(p)))) return true;
  if (parts.length === 1 && q.length >= 2) return words.map((w) => w[0]).join("").startsWith(q);
  return false;
}

/** Does an order match what the CD typed: part of the customer's name or product, the #PIK, or 4+ phone digits? */
export function orderMatches(o: TrackOrder, typed: string): boolean {
  const q = typed.toLowerCase().replace(/#/g, "").trim();
  if (!q) return true;
  const digits = q.replace(/\D/g, "");
  if (digits.length >= 3 && pikNumbers(o.shopify).some((n) => n.includes(digits))) return true;
  if (digits.length >= 4 && (o.phone ?? "").replace(/\D/g, "").includes(digits)) return true;
  const text = `${o.customer} ${o.products.map((p) => p.name).join(" ")} ${o.shopify ?? ""}`.toLowerCase();
  return q.split(/\s+/).every((w) => text.includes(w));
}

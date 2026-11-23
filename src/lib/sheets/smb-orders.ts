// The CD tracking page reads the Sales Masterbase (SMB) "Sales Tracker" tab, where logistics sets the status.
// This file turns its rows into orders a CD can look up by their own name (the POC column).
// Columns are found by their heading (row 2 of the tab), so moving columns in the sheet doesn't break it.
// The status comes from "Logistic Status" (the codes logistics keeps current); "Delivery Status" is shown with it.
// Pure (no "server-only"): tests use it.

export type TrackStatus =
  | "not_confirmed" | "confirmed" | "arranging" | "waiting" | "hub" | "on_the_way" | "brand" | "delivered" | "cancelled" | "other";

export const TRACK_LABELS: Record<TrackStatus, string> = {
  not_confirmed: "Not confirmed yet",
  confirmed: "Confirmed",
  arranging: "Being arranged",
  waiting: "Waiting for stock",
  hub: "At the hub",
  on_the_way: "On the way",
  brand: "Brand delivers",
  delivered: "Delivered",
  cancelled: "Cancelled",
  other: "See status",
};

/** One line a CD can read out to the customer. */
export const TRACK_MEANING: Record<TrackStatus, string> = {
  not_confirmed: "The order isn't confirmed yet. Our team will confirm it.",
  confirmed: "Order confirmed. Our team is arranging the product.",
  arranging: "Our team is arranging the product for this order.",
  waiting: "Waiting for the product to reach our warehouse.",
  hub: "The product is at our hub and goes out next.",
  on_the_way: "Dispatched and on the way to the customer.",
  brand: "The brand delivers this one directly to the customer.",
  delivered: "Delivered to the customer.",
  cancelled: "This order is cancelled.",
  other: "Ask logistics what this status means.",
};

export const TRACK_TONE: Record<TrackStatus, string> = {
  not_confirmed: "tone-warn",
  confirmed: "tone-info",
  arranging: "tone-violet",
  waiting: "tone-violet",
  hub: "tone-accent",
  on_the_way: "tone-teal",
  brand: "tone-teal",
  delivered: "tone-good",
  cancelled: "tone-muted",
  other: "tone-muted",
};

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

/** Not delivered and not cancelled: the orders a customer may call about. */
export const isOpen = (s: TrackStatus) => s !== "delivered" && s !== "cancelled";

export type TrackProduct = { name: string; serial: string | null };

export type TrackOrder = {
  /** Used in the link to the order: the #PIK number, or the sheet row when there is none. */
  id: string;
  /** Row of the order's first line in the sheet, as the sheet numbers it. */
  row: number;
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

/** Which column holds which field. The first column with a heading wins. */
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

/** "Prasanth D" and "prasanth d " are the same person. */
export const pocKey = (name: string | null | undefined) => clean(name ?? "").toLowerCase();

/** Website orders carry this in the POC column instead of a person. */
export const WEBSITE_POC = "shopify direct";

/** Every #PIK number in a cell ("#PIK5082/#PIK5447" has two). */
export const pikNumbers = (v: string | null | undefined) => (v ?? "").match(/\d{3,}/g) ?? [];

/**
 * The Sales Tracker rows as orders, newest (lowest in the sheet) first. The heading row is the one among the first
 * rows with "Shopify Order ID" and "POC" (row 2 in the SMB; row 1 holds totals). One row per product: rows with the
 * same #PIK right after each other are one order. Rows with no #PIK, customer or product are skipped.
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
    const order: TrackOrder = {
      id: n > 1 ? `${base}-${n}` : base,
      row: i + 1,
      shopify: orNull(shopify),
      customer: customer || "Customer not named",
      phone: orNull(at(row, "phone")),
      poc: orNull(at(row, "poc")),
      hub: orNull(at(row, "hub")),
      products: product ? [{ name: product, serial }] : [],
      logisticStatus,
      deliveryStatus,
      status: trackStatusOf(logisticStatus, deliveryStatus),
      date: orNull(at(row, "date")),
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

export type PocRow = { key: string; name: string; total: number; open: number };

/** One row per CD, A to Z, with how many of their orders are still open. Website orders and blanks are left out. */
export function pocRows(orders: TrackOrder[]): PocRow[] {
  const byKey = new Map<string, { names: Map<string, number>; total: number; open: number }>();
  for (const o of orders) {
    const key = pocKey(o.poc);
    if (!key || key === WEBSITE_POC) continue;
    const entry = byKey.get(key) ?? { names: new Map(), total: 0, open: 0 };
    entry.names.set(o.poc!, (entry.names.get(o.poc!) ?? 0) + 1);
    entry.total++;
    if (isOpen(o.status)) entry.open++;
    byKey.set(key, entry);
  }
  const best = (names: Map<string, number>) =>
    [...names.entries()].sort((a, b) => b[1] - a[1] || Number(/[A-Z]/.test(b[0])) - Number(/[A-Z]/.test(a[0])))[0][0];
  return [...byKey.entries()]
    .map(([key, e]) => ({ key, name: best(e.names), total: e.total, open: e.open }))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
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

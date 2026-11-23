// The CD tracking page reads the Sales Masterbase (SMB) sheet, where logistics changes the delivery status. This file
// turns the sheet's rows into orders a CD can look up: by their own name (POC), or by the customer's name, phone or
// #PIK. Headings are matched by name (sales-sheet-map.ts), so the team can move or add columns freely.
// Pure (no "server-only"): tests use it.

import { findHeaderRow, layoutFor, type SheetField } from "@/lib/sheets/sales-sheet-map";

export type TrackStatus = "new" | "waiting" | "ready" | "out" | "brand" | "delivered" | "on_hold" | "returns" | "cancelled" | "other";

export const TRACK_LABELS: Record<TrackStatus, string> = {
  new: "New sale",
  waiting: "Waiting for stock",
  ready: "Ready to dispatch",
  out: "Out for delivery",
  brand: "Brand delivers",
  delivered: "Delivered",
  on_hold: "On hold",
  returns: "Return or replacement",
  cancelled: "Cancelled",
  other: "See status",
};

/** One line a CD can read out to the customer. */
export const TRACK_MEANING: Record<TrackStatus, string> = {
  new: "Order received. Logistics will check stock.",
  waiting: "Waiting for the product to reach our warehouse.",
  ready: "In stock and packed. It goes out soon.",
  out: "On the way to the customer.",
  brand: "The brand delivers this one directly to the customer.",
  delivered: "Delivered to the customer.",
  on_hold: "Paused. See the note.",
  returns: "Being returned or replaced.",
  cancelled: "Order cancelled.",
  other: "Ask logistics what this status means.",
};

export const TRACK_TONE: Record<TrackStatus, string> = {
  new: "tone-info",
  waiting: "tone-violet",
  ready: "tone-accent",
  out: "tone-teal",
  brand: "tone-teal",
  delivered: "tone-good",
  on_hold: "tone-warn",
  returns: "tone-warn",
  cancelled: "tone-muted",
  other: "tone-muted",
};

/** Not delivered and not cancelled: the orders a customer may call about. */
export const OPEN_STATUSES: TrackStatus[] = ["new", "waiting", "ready", "out", "brand", "on_hold", "returns", "other"];

/** The status text in the sheet (EPIK_OFD, "Delivered", "waiting for stock"…) as one of the statuses above. */
export function trackStatusOf(raw: string): TrackStatus {
  const s = raw.toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return "new";
  if (/cancel/.test(s)) return "cancelled";
  if (/\brtv\b|return|replace|refund|rto\b/.test(s)) return "returns";
  if (/brand del|brand ship|brand direct|\bdel cx\b/.test(s)) return "brand";
  if (/\bofd\b|out for|dispatch|shipped|in transit|transit|on the way|picked/.test(s)) return "out";
  if (/deliver|installed|install done|completed|\bdone\b/.test(s)) return "delivered";
  if (/hold|paused/.test(s)) return "on_hold";
  if (/wait|stock|procure|\bpo\b|backorder|pending stock/.test(s)) return "waiting";
  if (/confirm|ready|packed|allocat|reserved/.test(s)) return "ready";
  if (/\bnew\b|booked|received|pending/.test(s)) return "new";
  return "other";
}

export type TrackProduct = { name: string; qty: string };

export type TrackOrder = {
  /** Row number of the order's first line in the sheet (1-based, as the sheet shows it). */
  row: number;
  key: string;
  shopify: string | null;
  customer: string;
  phone: string | null;
  poc: string | null;
  hub: string | null;
  products: TrackProduct[];
  statusText: string;
  status: TrackStatus;
  date: string | null;
  expected: string | null;
  driver: string | null;
  dispatchedOn: string | null;
  deliveredOn: string | null;
  paymentStatus: string | null;
  address: string | null;
  notes: string | null;
};

const clean = (v: string | undefined) => (v ?? "").replace(/\s+/g, " ").trim();
const orNull = (v: string) => (v ? v : null);

/** "Prasanth D - CDE" and "prasanth d  - cde" are the same person. */
export const pocKey = (name: string | null | undefined) => clean(name ?? "").toLowerCase();

/** "#PIK5420", "PIK 5420" and "5420" all look up the same order. */
export const pikDigits = (v: string | null | undefined) => (v ?? "").replace(/[^0-9]/g, "");

/**
 * The sheet's rows as orders, newest (lowest in the sheet) first. The heading row is found among the first rows.
 * One row per product: rows with the same #PIK (or, without one, the same customer and phone) right after each other
 * are one order. Rows with no customer, product or #PIK are skipped (totals, blank lines).
 */
export function readSmbOrders(rows: string[][]): TrackOrder[] {
  if (!rows.length) return [];
  const headerAt = findHeaderRow(rows.slice(0, 10));
  const layout = layoutFor(rows[headerAt] ?? []);
  const col = (field: SheetField, line = 1) => layout.columns.find((c) => c.field === field && c.line === line)?.index;
  const at = (row: string[], field: SheetField, line = 1) => {
    const i = col(field, line);
    return i == null ? "" : clean(row[i]);
  };
  const productLines = Math.max(1, ...layout.columns.filter((c) => c.field === "product").map((c) => c.line));

  const orders: TrackOrder[] = [];
  let last: TrackOrder | null = null;
  rows.forEach((row, i) => {
    if (i <= headerAt) return;
    const shopify = at(row, "shopify");
    const customer = at(row, "customer");
    const phone = at(row, "phone");
    const products: TrackProduct[] = [];
    for (let line = 1; line <= productLines; line++) {
      const name = at(row, "product", line) || (line === 1 ? at(row, "sku") : "");
      if (name) products.push({ name, qty: at(row, "qty", line) });
    }
    if (!shopify && !customer && !products.length) return;
    const key = shopify ? `pik:${pikDigits(shopify) || shopify.toLowerCase()}` : `cx:${customer.toLowerCase()}|${phone.replace(/\D/g, "")}`;
    // The next product row of the same order: add the product and keep the order's own details.
    if (last && last.key === key && (shopify || customer)) {
      last.products.push(...products);
      if (!last.statusText) {
        const statusText = at(row, "status");
        if (statusText) Object.assign(last, { statusText, status: trackStatusOf(statusText) });
      }
      return;
    }
    const statusText = at(row, "status");
    const order: TrackOrder = {
      row: i + 1,
      key,
      shopify: orNull(shopify),
      customer: customer || "Customer not named",
      phone: orNull(phone),
      poc: orNull(at(row, "poc")),
      hub: orNull(at(row, "hub")),
      products,
      statusText,
      status: trackStatusOf(statusText),
      date: orNull(at(row, "date")),
      expected: orNull(at(row, "expected")),
      driver: orNull(at(row, "driver")),
      dispatchedOn: orNull(at(row, "dispatchedOn")),
      deliveredOn: orNull(at(row, "deliveredOn")),
      paymentStatus: orNull(at(row, "paymentStatus")),
      address: orNull(at(row, "address")),
      notes: orNull(at(row, "notes")),
    };
    orders.push(order);
    last = order;
  });
  return orders.reverse();
}

export type PocRow = { key: string; name: string; total: number; open: number; delivered: number };

/** One row per POC, A to Z, with how many of their orders are still open. Orders with no POC are left out. */
export function pocRows(orders: TrackOrder[]): PocRow[] {
  const byKey = new Map<string, { names: Map<string, number>; total: number; open: number; delivered: number }>();
  for (const o of orders) {
    const key = pocKey(o.poc);
    if (!key) continue;
    const entry = byKey.get(key) ?? { names: new Map(), total: 0, open: 0, delivered: 0 };
    entry.names.set(o.poc!, (entry.names.get(o.poc!) ?? 0) + 1);
    entry.total++;
    if (OPEN_STATUSES.includes(o.status)) entry.open++;
    if (o.status === "delivered") entry.delivered++;
    byKey.set(key, entry);
  }
  return [...byKey.entries()]
    .map(([key, e]) => ({ key, name: [...e.names.entries()].sort((a, b) => b[1] - a[1] || Number(/[A-Z]/.test(b[0])) - Number(/[A-Z]/.test(a[0])))[0][0], total: e.total, open: e.open, delivered: e.delivered }))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

/** Orders matching what the CD typed: part of the customer's name, 4+ digits of the phone, or the #PIK. */
export function searchOrders(orders: TrackOrder[], query: string): TrackOrder[] {
  const q = clean(query).toLowerCase();
  if (q.length < 2) return [];
  const digits = q.replace(/\D/g, "");
  const words = q.replace(/#/g, "").split(" ").filter(Boolean);
  return orders.filter((o) => {
    if (digits.length >= 3 && o.shopify && pikDigits(o.shopify) === digits) return true;
    if (digits.length >= 4 && o.phone && o.phone.replace(/\D/g, "").includes(digits)) return true;
    const name = o.customer.toLowerCase();
    return words.length > 0 && words.every((w) => name.includes(w));
  });
}

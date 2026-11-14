// Which sales sheet column gets which order field. The sheet keeps its own columns and order: the app finds the
// heading row (the SMB sheet has a note on row 1 and its headings on row 2), matches each heading by name (below),
// and writes only the columns it recognises. Columns the team keeps for themselves (CD Incentive Math, Mobile
// Exchange Amt…) are never touched. Pure (no "server-only"), so tests can check the mapping.

import { DELIVERY_CODES, deliveryStatusOf } from "@/lib/ops/delivery-status";
import type { OrderLine, OrderSummary } from "@/lib/ops/types";

export type SheetField =
  | "orderId" | "shopify" | "date" | "month" | "time" | "customer" | "phone" | "email" | "address" | "billingAddress" | "pincode" | "gst"
  | "product" | "sku" | "brand" | "category" | "qty" | "listPrice" | "offeredPrice" | "discount" | "total" | "accessories" | "warranty" | "installation"
  | "poc" | "hub" | "saleSource" | "saleType" | "cxType" | "paymentStatus" | "paymentMode" | "amountPaid" | "balance" | "notes"
  | "status" | "expected" | "driver" | "dispatchedOn" | "deliveredOn" | "updated";

/** Headings as the team might write them. Matching ignores case, spaces, line breaks and punctuation. */
const ALIASES: Record<SheetField, string[]> = {
  orderId: ["EPIK order", "EPIK order ID", "EPIK ID", "Order ID", "App order", "SMB ID"],
  shopify: ["Shopify", "Shopify order", "Shopify order ID", "Shopify order no", "Shopify ID", "PIK", "PIK no", "Order no", "Order number"],
  date: ["Date", "Order date", "Sale date", "Invoice date", "Booking date", "Created"],
  month: ["Month", "Sale month"],
  time: ["Time", "Order time"],
  customer: ["Customer", "Customer name", "Name", "CX name", "Client", "Client name"],
  phone: ["Phone", "Phone no", "Phone number", "Mobile", "Mobile no", "Mobile number", "Contact", "Contact no", "Customer phone", "CX phone", "Number"],
  email: ["Email", "Email ID", "Customer email"],
  address: ["Address", "Shipping address", "Delivery address", "Customer address"],
  billingAddress: ["Billing address"],
  pincode: ["Pincode", "Pin code", "PIN", "Zip"],
  gst: ["GST", "GSTIN", "GST no", "GST number"],
  product: ["Product", "Products", "Product name", "Model", "Item", "Item name"],
  sku: ["SKU", "SKU code", "Product SKU"],
  brand: ["Brand"],
  category: ["Category", "Product category"],
  qty: ["Qty", "Quantity", "Units"],
  listPrice: ["MRP", "List price", "Website price", "Undiscounted GMV", "Undiscounted GMV (Epik's)", "GMV"],
  offeredPrice: ["Offered price", "Offer price", "Deal price", "Selling price", "Sale price", "Price", "Final price"],
  discount: ["Discount (%)", "Discount %", "Discount percent", "Discount"],
  total: ["Total", "Order value", "Order total", "Amount", "Total amount"],
  accessories: ["Accessories", "Add ons", "Addons"],
  warranty: ["Warranty", "Extended warranty", "EW"],
  installation: ["Installation"],
  poc: ["POC", "POC name", "Sold by", "Salesperson", "Sales person", "CDE", "CD name", "Executive"],
  hub: ["Hub", "Store", "Branch", "Location"],
  saleSource: ["Sale source", "Sales source", "Source", "Lead source", "Channel"],
  saleType: ["Sale type", "Sales type", "Order type"],
  cxType: ["CX type", "Customer type"],
  paymentStatus: ["Payment status", "Payment", "Paid status"],
  paymentMode: ["Payment mode", "Mode", "Mode of payment", "Payment method"],
  amountPaid: ["Amount paid", "Paid amount", "Amount received", "Advance"],
  balance: ["Balance pending", "Balance", "Pending amount", "Amount pending", "COD"],
  notes: ["Notes", "Note", "Remarks", "Remark", "Comments", "Comment", "Sales notes"],
  status: ["Status", "Delivery status", "Order status", "Logistics status", "Dispatch status"],
  expected: ["Expected delivery", "Expected date", "Expected delivery date", "ETA", "Delivery ETA"],
  driver: ["Driver", "Delivered by", "Delivery person", "Rider"],
  dispatchedOn: ["Dispatched on", "Dispatch date", "Out for delivery on"],
  deliveredOn: ["Delivered on", "Delivery date", "Delivered date"],
  updated: ["Last updated", "Updated", "Updated at", "Status updated"],
};

/** Columns the app needs and adds at the end of the heading row when the sheet has none. */
export const REQUIRED_HEADERS: Array<{ field: SheetField; header: string }> = [
  { field: "status", header: "Status" },
  { field: "orderId", header: "EPIK order" },
];

/** Per-product columns. On a numbered sheet ("Product 2", "SKU 3") they repeat across one row per order. */
const PER_LINE: SheetField[] = ["product", "sku", "brand", "category", "qty", "listPrice", "offeredPrice", "discount", "accessories", "warranty", "installation"];
/** Money for the whole order: written once, on the order's first row, so sheet totals don't count it twice. */
const ORDER_MONEY: SheetField[] = ["total", "amountPaid", "balance"];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const LOOKUP = new Map<string, SheetField>();
for (const [field, names] of Object.entries(ALIASES) as Array<[SheetField, string[]]>) for (const n of names) LOOKUP.set(norm(n), field);

export type Column = { index: number; header: string; field: SheetField; line: number };
export type SheetLayout = { columns: Column[]; unknown: string[]; keyColumn: Column | null; perLine: boolean };

/** Reads a heading row. The order key is the EPIK order column. */
export function layoutFor(headers: string[]): SheetLayout {
  const columns: Column[] = [];
  const unknown: string[] = [];
  const taken = new Set<string>();
  headers.forEach((raw, index) => {
    const header = String(raw ?? "").replace(/\s+/g, " ").trim();
    if (!header) return;
    const n = norm(header);
    const numbered = /^(.*?)(\d)$/.exec(n);
    let field = LOOKUP.get(n);
    let line = 1;
    if (!field && numbered) {
      const base = LOOKUP.get(numbered[1]);
      if (base && PER_LINE.includes(base)) [field, line] = [base, Number(numbered[2])];
    }
    if (!field) return void unknown.push(header);
    const key = `${field}:${line}`;
    if (taken.has(key)) return void unknown.push(header); // the first column with a heading wins
    taken.add(key);
    columns.push({ index, header, field, line });
  });
  const perLine = columns.some((c) => c.line > 1);
  const keyColumn = columns.find((c) => c.field === "orderId") ?? null;
  return { columns, unknown, keyColumn, perLine };
}

/** The heading row among the first rows: the one with the most headings the app knows (at least 3), else row 1. */
export function findHeaderRow(rows: string[][]): number {
  let best = 0;
  let bestCount = 0;
  rows.forEach((row, i) => {
    const count = layoutFor(row ?? []).columns.length;
    if (count > bestCount) [best, bestCount] = [i, count];
  });
  return bestCount >= 3 ? best : 0;
}

// ── Rows ─────────────────────────────────────────────────────────────────────

export type SheetRow = { key: string; order: OrderSummary; line: OrderLine | null; first: boolean };

/**
 * One row per product (the SMB way: brand, category and offer price per product), keyed "EPK-000390/1",
 * "EPK-000390/2". A sheet with numbered columns ("Product 2") gets one row per order instead, keyed "EPK-000390".
 */
export function rowsFor(order: OrderSummary, perLine: boolean): SheetRow[] {
  if (perLine) return [{ key: order.id, order, line: null, first: true }];
  const lines = [...order.lines].sort((a, b) => a.lineNo - b.lineNo);
  if (!lines.length) return [{ key: `${order.id}/1`, order, line: null, first: true }];
  return lines.map((line, i) => ({ key: `${order.id}/${i + 1}`, order, line, first: i === 0 }));
}

export type ProductInfo = { brand: string | null; category: string | null };

const IST = "Asia/Kolkata";
const day = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { timeZone: IST, day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso)) : "");
const monthOf = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: IST, month: "short", year: "numeric" }).format(new Date(iso));
const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: IST, hour: "2-digit", minute: "2-digit", hour12: true }).format(new Date(iso));
const rupees = (minor: number | null | undefined) => (minor == null ? "" : String(Math.round(minor) / 100));
const ymdToDay = (ymd: string | null) => (ymd ? day(`${ymd}T12:00:00+05:30`) : "");

/** What the CDE said was received ("Full paid, ₹65,000 received"), or money verified since, whichever is more. */
export function paidSoFar(order: Pick<OrderSummary, "declaredPaymentStatus" | "offeredTotalMinor" | "paidMinor">): number {
  const status = order.declaredPaymentStatus ?? "";
  const amount = /₹\s?([\d,]+(?:\.\d+)?)\s+(received|paid)/i.exec(status);
  const declared = amount ? Math.round(Number(amount[1].replace(/,/g, "")) * 100) : /^full paid/i.test(status) ? order.offeredTotalMinor : 0;
  return Math.min(order.offeredTotalMinor, Math.max(Number.isFinite(declared) ? declared : 0, order.paidMinor));
}

function liveLines(order: OrderSummary): OrderLine[] {
  const live = order.lines.filter((l) => l.status !== "cancelled" && l.status !== "rejected");
  return live.length ? live : order.lines;
}

function lineValue(field: SheetField, line: OrderLine | undefined | null, product: ProductInfo | null | undefined): string {
  if (!line) return "";
  switch (field) {
    case "product": return line.productName;
    case "sku": return line.sku ?? "";
    case "brand": return product?.brand ?? "";
    case "category": return product?.category ?? "";
    case "qty": return String(line.qty);
    case "listPrice": return rupees(line.listPriceMinor != null ? line.listPriceMinor * line.qty : null);
    case "offeredPrice": return rupees(line.offeredPriceMinor);
    case "discount": {
      const list = line.listPriceMinor != null ? line.listPriceMinor * line.qty : null;
      if (!list || list <= 0) return "";
      return String(Math.round(((list - line.offeredPriceMinor) / list) * 1000) / 10);
    }
    case "accessories": return line.accessories ?? "";
    case "warranty": return line.extendedWarranty ?? "";
    case "installation": return line.installation ?? "";
    default: return "";
  }
}

export type CellContext = { line: OrderLine | null; first: boolean; perLine: boolean; products?: Map<string, ProductInfo> };

/** The text for one cell. Money in rupees (plain numbers, so sheet formulas can add them), dates in IST. */
export function cellValue(order: OrderSummary, column: Pick<Column, "field" | "line">, ctx: CellContext): string {
  const productOf = (line: OrderLine | null | undefined) => (line?.sku ? ctx.products?.get(line.sku) : null);
  if (PER_LINE.includes(column.field)) {
    if (!ctx.perLine) return lineValue(column.field, ctx.line, productOf(ctx.line));
    const line = liveLines(order)[column.line - 1];
    return lineValue(column.field, line, productOf(line));
  }
  if (ORDER_MONEY.includes(column.field) && !ctx.first) return "";
  const status = deliveryStatusOf(order.stage);
  switch (column.field) {
    case "orderId": return order.id;
    case "shopify": return order.shopifyOrderId ?? "";
    case "date": return day(order.createdAt);
    case "month": return monthOf(order.createdAt);
    case "time": return time(order.createdAt);
    case "customer": return order.customerName;
    case "phone": return order.phone ?? "";
    case "email": return order.email ?? "";
    case "address": return order.shippingAddress ?? "";
    case "billingAddress": return order.billingAddress ?? "";
    case "pincode": return order.pincode ?? "";
    case "gst": return order.gst ?? "";
    case "total": return rupees(order.offeredTotalMinor);
    case "amountPaid": return rupees(paidSoFar(order));
    case "balance": return rupees(order.offeredTotalMinor - paidSoFar(order));
    case "poc": return order.poc ?? "";
    case "hub": return order.hub ?? "";
    case "saleSource": return order.saleSource ?? "";
    case "saleType": return order.saleType ?? "";
    case "cxType": return order.cxType ?? "";
    case "paymentStatus": return (order.declaredPaymentStatus ?? "").split(",")[0].trim();
    case "paymentMode": return order.declaredPaymentMode ?? "";
    case "notes": return order.notes ?? "";
    case "status": {
      const why = status === "on_hold" ? order.holdReason : status === "cancelled" ? order.cancelReason : null;
      return why ? `${DELIVERY_CODES[status]}: ${why}` : DELIVERY_CODES[status];
    }
    case "expected": return ymdToDay(order.expectedDeliveryDate);
    case "driver": return order.driver ?? "";
    case "dispatchedOn": return day(order.dispatchedAt);
    case "deliveredOn": return day(order.deliveredAt);
    case "updated": return `${day(order.updatedAt)} ${time(order.updatedAt)}`;
    default: return "";
  }
}

/** "A", "B", … "AA": the letter of a 0-based column. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

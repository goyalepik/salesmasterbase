import { LINE_LABELS, STAGE_LABELS, type Installation, type OrderSummary, type PurchaseOrder, type StockLevel } from "@/lib/ops/types";
import type { OpsStore } from "@/lib/ops/store";

// Spreadsheet downloads, so finance and anyone who misses the sheets can still open one.
// CSV with a byte-order mark opens straight in Excel and Google Sheets with ₹ and names intact.

export const EXPORT_KINDS = ["orders", "dispatch", "stock", "purchase-orders", "installations"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

type Cell = string | number | null | undefined;

/** Quotes every cell, and stops a cell starting with = + - @ from running as a formula in Excel. */
export function toCsv(header: string[], rows: Cell[][]): string {
  const cell = (value: Cell) => {
    if (value == null) return "";
    let text = String(value);
    if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return "﻿" + [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

const rupees = (minor: number | null | undefined) => (minor == null ? null : Math.round(minor) / 100);

function ist(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

async function allOrders(store: OpsStore, stage: "all" | "ready_to_dispatch" | "out_for_delivery"): Promise<OrderSummary[]> {
  const out: OrderSummary[] = [];
  for (let offset = 0; offset < 50_000; offset += 1000) {
    const page = await store.listOrders({ stage, limit: 1000, offset });
    out.push(...page.items);
    if (page.items.length < 1000) break;
  }
  return out;
}

function orderRows(orders: OrderSummary[]): Cell[][] {
  return orders.flatMap((o) =>
    (o.lines.length ? o.lines : [null]).map((l) => [
      o.id, o.shopifyOrderId, ist(o.createdAt), STAGE_LABELS[o.stage], o.customerName, o.phone, o.shippingAddress, o.pincode, o.hub, o.poc,
      l?.productName, l?.sku, l?.qty, rupees(l?.offeredPriceMinor), l ? LINE_LABELS[l.status] : null, l?.serialNo,
      rupees(o.offeredTotalMinor), rupees(o.paidMinor), rupees(o.codDueMinor), o.driver, ist(o.dispatchedAt), ist(o.deliveredAt), o.holdReason ?? o.cancelReason,
    ]),
  );
}

const ORDER_HEADER = [
  "Order", "Shopify", "Created (IST)", "Stage", "Customer", "Phone", "Address", "Pincode", "Hub", "POC",
  "Product", "SKU", "Qty", "Offered (₹)", "Line status", "Serial",
  "Order offered (₹)", "Paid (₹)", "COD due (₹)", "Driver", "Dispatched (IST)", "Delivered (IST)", "Hold or cancel reason",
];

export async function buildExport(store: OpsStore, kind: ExportKind): Promise<string> {
  switch (kind) {
    case "orders":
      return toCsv(ORDER_HEADER, orderRows(await allOrders(store, "all")));
    case "dispatch": {
      const [ready, out] = await Promise.all([allOrders(store, "ready_to_dispatch"), allOrders(store, "out_for_delivery")]);
      return toCsv(ORDER_HEADER, orderRows([...ready, ...out]));
    }
    case "stock": {
      const levels: StockLevel[] = await store.stockLevels({ only: "all", limit: 100_000 });
      return toCsv(
        ["SKU", "Product", "Brand", "Category", "On hand", "Reserved", "Free", "Incoming", "Next ETA", "Unit cost (₹)", "Value at cost (₹)"],
        levels.map((s) => [s.sku, s.name, s.brand, s.category, s.onHand, s.reserved, s.available, s.incoming, s.nextEta, rupees(s.unitCostMinor), s.unitCostMinor == null ? null : rupees(s.unitCostMinor * s.onHand)]),
      );
    }
    case "purchase-orders": {
      const pos: PurchaseOrder[] = await store.listPurchaseOrders({ status: "all" });
      return toCsv(
        ["PO", "Vendor", "SKU", "Product", "Ordered", "Received", "Pending", "ETA", "Status", "Added (IST)"],
        pos.map((p) => [p.poNumber, p.vendor, p.sku, p.productName, p.qtyOrdered, p.qtyReceived, Math.max(0, p.qtyOrdered - p.qtyReceived), p.eta, p.status, ist(p.createdAt)]),
      );
    }
    case "installations": {
      const items: Installation[] = await store.listInstallations({ status: "all" });
      return toCsv(
        ["Order", "Product", "SKU", "Customer", "Phone", "Address", "Status", "Due", "Done (IST)", "Technician", "Note"],
        items.map((i) => [i.orderId, i.productName, i.sku, i.customerName, i.phone, i.address, i.status, i.dueDate, ist(i.doneAt), i.technician, i.note]),
      );
    }
  }
}

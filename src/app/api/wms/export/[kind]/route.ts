import { NextResponse, type NextRequest } from "next/server";
import { getWms } from "@/features/wms";
import { rmaNetCost } from "@/features/wms/flows";
import { replenishment } from "@/features/wms/insights";
import { canSeeCost } from "@/features/wms/service";
import { CONDITION_LABELS, UNIT_STATUS_LABELS } from "@/features/wms/domain/unit";
import { RMA_STATUS_LABELS, RMA_TYPE_LABELS } from "@/features/wms/domain/types";
import { REORDER_LABELS } from "@/features/wms/domain/replenish";
import { currentActor } from "@/lib/ops-ui/actor";

const cell = (v: unknown) => {
  const t = v == null ? "" : String(v);
  // Stop spreadsheet formulas in a cell (=, +, -, @) and quote anything with commas or quotes.
  const safe = /^[=+\-@]/.test(t) ? `'${t}` : t;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const rupees = (minor: number | null | undefined) => (minor == null ? "" : (minor / 100).toFixed(2));

/** Warehouse lists as CSV (opens in Excel and Google Sheets): units, shipments, returns, reorder. Costs only for procurement and admin. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const ctx = await getWms();
  if (!ctx) return NextResponse.json({ error: "The warehouse screens aren't switched on." }, { status: 404 });
  const { kind } = await params;
  const money = await canSeeCost(ctx.ops, await currentActor());
  let rows: unknown[][] = [];
  if (kind === "units") {
    rows = [["Serial", "SKU", "Status", "Condition", "Hub", "PO", "GRN", "Vendor", "Invoice", ...(money ? ["Cost incl. GST (₹)"] : []), "Received", "Received by", "Remark"]];
    for (const u of await ctx.wms.listUnits({ limit: 200_000 })) rows.push([u.serial, u.sku, UNIT_STATUS_LABELS[u.status], CONDITION_LABELS[u.condition], u.hub, u.poNumber, u.grnNumber, u.vendor, u.invoiceNo, ...(money ? [rupees(u.unitCostMinor)] : []), u.receivedAt, u.receivedBy, u.remark]);
  } else if (kind === "shipments") {
    rows = [["Shipment", "Kind", "Order", "Serials", "Carrier", "Partner", "AWB", "Tracking link", "Driver", "Status", "Dispatched", "Delivered", "By"]];
    for (const s of await ctx.wms.listRecords("shipment", { limit: 50_000 })) rows.push([s.number, s.kind, s.orderId, s.serials.join(" "), s.carrier, s.partner, s.awb, s.trackingUrl, s.driver, s.status, s.dispatchedAt, s.deliveredAt, s.dispatchedBy]);
  } else if (kind === "returns") {
    rows = [["Return", "Type", "Status", "Serial", "SKU", "Order", "Customer", "Reason", "Opened", "Closed", ...(money ? ["Net cost (₹)", "Recovered (₹)"] : [])]];
    for (const r of await ctx.wms.listRecords("rma", { limit: 50_000 })) rows.push([r.number, RMA_TYPE_LABELS[r.type], RMA_STATUS_LABELS[r.status], r.serial, r.sku, r.orderId, r.customer, r.reason, r.createdAt, r.closedAt, ...(money ? [rupees(await rmaNetCost(ctx, r)), rupees(r.recoveredMinor)] : [])]);
  } else if (kind === "reorder") {
    rows = [["SKU", "Product", "In stock", "On the way", "Sold 7d", "Sold 30d", "Days of stock", "Cover days", "Status", "Suggested", ...(money ? ["Value (₹)"] : [])]];
    for (const r of await replenishment(ctx)) rows.push([r.sku, r.name, r.warehouse, r.inTransit, r.sold7, r.sold30, r.doh30, r.cover, REORDER_LABELS[r.status], r.suggested, ...(money ? [rupees(r.reorderValueMinor)] : [])]);
  } else {
    return NextResponse.json({ error: "Unknown list." }, { status: 404 });
  }
  const csv = "﻿" + rows.map((r) => r.map(cell).join(",")).join("\n");
  return new NextResponse(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="epik-warehouse-${kind}.csv"`, "cache-control": "private, no-store" } });
}

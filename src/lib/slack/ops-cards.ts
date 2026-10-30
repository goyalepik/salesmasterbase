import { nextStep } from "@/lib/ops/service";
import { LINE_LABELS, OPEN_STAGES, STAGE_LABELS, type OrderDetail, type OrderLine, type OrderStage, type Product, type StockLevel } from "@/lib/ops/types";
import { formatSale, nameFromOptionText, PRODUCT_SEARCH_ACTION, productOptionText, type SaleFields } from "@/lib/slack/sale-form";

export { nameFromOptionText, PRODUCT_SEARCH_ACTION, productOptionText };

/**
 * Pure Block Kit builders for the live order card. No I/O here: callers pass the order,
 * the stock levels for its SKUs, and the dashboard URL.
 */

export type Block = Record<string, unknown>;

export const OPS_PREFIX = "ops:";
export const OPS_MORE_ACTION = "ops:more";
export const OPS_OPEN_ACTION = "ops:open";

/** Every step a person can take from Slack. Action ids are `ops:<kind>`, modal callback ids too. */
export const OPS_KINDS = [
  "verify",
  "clear",
  "reserve",
  "brand_direct",
  "procure",
  "hold_po",
  "reject",
  "map_sku",
  "proc_ordered",
  "proc_received",
  "dispatch",
  "delivered",
  "cancel",
  "shopify",
] as const;
export type OpsKind = (typeof OPS_KINDS)[number];

/** Buttons that change the order straight away, without a form. */
export const DIRECT_KINDS: readonly OpsKind[] = ["reserve", "brand_direct"];

export type ActionValue = { o: string; l?: string };
export type OverflowValue = { k: OpsKind; o: string };

const MAX_LINES_SHOWN = 20;
const UNDECIDED: OrderLine["status"][] = ["pending", "rejected"];
const DECIDING_STAGES = ["awaiting_inventory", "awaiting_stock", "on_hold"];

export function isOpsKind(value: string): value is OpsKind {
  return (OPS_KINDS as readonly string[]).includes(value);
}

export function plain(text: string, max = 75): { type: "plain_text"; text: string; emoji: boolean } {
  return { type: "plain_text", text: clip(text, max), emoji: false };
}

export function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, Math.max(1, max - 1))}…`;
}

/** Escapes the three characters Slack mrkdwn treats as control characters. */
export function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function inr(minor: number): string {
  const rupees = minor / 100;
  return `₹${rupees.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2 })}`;
}

/** Rupees as a plain string for prefilled inputs: 2500000 → "25000". */
export function rupeesText(minor: number): string {
  const rupees = minor / 100;
  return Number.isInteger(rupees) ? String(rupees) : rupees.toFixed(2);
}

/** The channel is large: show only the last four digits. */
export function maskPhone(phone: string | null): string {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "••••";
  return `••••••${digits.slice(-4)}`;
}

export function shortDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: iso.length === 10 ? "UTC" : "Asia/Kolkata" }).format(date);
}

/** Options for an external_select of products (Slack allows at most 100). */
export function productOptions(products: Array<Pick<Product, "sku" | "name">>) {
  return products.slice(0, 100).map((product) => ({ text: plain(productOptionText(product)), value: product.sku.slice(0, 150) }));
}

function button(kind: OpsKind, label: string, value: ActionValue, style?: "primary" | "danger"): Block {
  return {
    type: "button",
    action_id: `${OPS_PREFIX}${kind}`,
    text: plain(label),
    value: JSON.stringify(value),
    ...(style ? { style } : {}),
  };
}

export function lineLabel(line: Pick<OrderLine, "productName" | "sku">): string {
  return `${line.productName}${line.sku ? ` (${line.sku})` : ""}`;
}

function stockText(line: OrderLine, stock: Record<string, StockLevel | null>): string {
  if (!line.sku) return "_No SKU yet. Map it to check stock._";
  const level = stock[line.sku];
  if (!level) return "Available 0 · Reserved 0 · Incoming 0";
  const eta = level.incoming > 0 && level.nextEta ? ` (next ${shortDate(level.nextEta)})` : "";
  return `Available ${level.available} · Reserved ${level.reserved} · Incoming ${level.incoming}${eta}`;
}

function lineStatusText(order: OrderDetail, line: OrderLine): string {
  let status = LINE_LABELS[line.status];
  if (line.status === "procuring" && line.procurementId) {
    const request = order.procurement.find((p) => p.id === line.procurementId);
    if (request) {
      status = `${request.status === "ordered" ? "Ordered" : "Procuring"} from ${request.vendor}${request.poNumber ? ` on ${request.poNumber}` : ""}${request.eta ? ` · ETA ${shortDate(request.eta)}` : ""}`;
    }
  }
  if (line.status === "rejected" && line.rejectReason) status += `: ${line.rejectReason}`;
  if (line.serialNo) status += ` · Serial ${line.serialNo}`;
  return status;
}

/** Buttons for one product line, or an empty list when nothing can be done to it now. */
export function lineButtons(order: OrderDetail, line: OrderLine, stock: Record<string, StockLevel | null>): Block[] {
  if (!DECIDING_STAGES.includes(order.stage)) return [];
  const value = { o: order.id, l: line.id };
  if (UNDECIDED.includes(line.status)) {
    if (!line.sku) {
      return [
        button("map_sku", "Map SKU", value, "primary"),
        button("procure", "Procure", value),
        button("brand_direct", "Brand direct", value),
        button("reject", "Reject", value, "danger"),
      ];
    }
    const level = stock[line.sku];
    const buttons: Block[] = [];
    if (level && level.available >= line.qty) buttons.push(button("reserve", "Reserve", value, "primary"));
    if (level && level.incoming > 0) buttons.push(button("hold_po", "Hold on PO", value));
    buttons.push(button("procure", "Procure", value));
    buttons.push(button("brand_direct", "Brand direct", value));
    if (line.status !== "rejected") buttons.push(button("reject", "Reject", value, "danger"));
    return buttons;
  }
  if (line.status === "awaiting_po") {
    const level = line.sku ? stock[line.sku] : null;
    const buttons: Block[] = [];
    if (level && level.available >= line.qty) buttons.push(button("reserve", "Reserve now", value, "primary"));
    buttons.push(button("procure", "Procure instead", value));
    return buttons;
  }
  if (line.status === "procuring") {
    const request = order.procurement.find((p) => p.id === line.procurementId);
    if (!request || (request.status !== "requested" && request.status !== "ordered")) return [];
    const buttons: Block[] = [];
    if (request.status === "requested") buttons.push(button("proc_ordered", "Mark ordered", value));
    buttons.push(button("proc_received", "Received", value, "primary"));
    return buttons;
  }
  return [];
}

function stageButtons(order: OrderDetail): Block[] {
  const value = { o: order.id };
  switch (order.stage) {
    case "awaiting_payment":
      return [button("verify", "Verify payment", value, "primary"), button("clear", "Clear without payment", value)];
    case "ready_to_dispatch":
      return [button("dispatch", "Out for delivery", value, "primary")];
    case "out_for_delivery":
      return [button("delivered", "Delivered", value, "primary")];
    default:
      return [];
  }
}

function overflow(order: OrderDetail): Block | null {
  const options: Array<{ text: ReturnType<typeof plain>; value: string }> = [];
  const cancellable: OrderStage[] = OPEN_STAGES.filter((s) => s !== "out_for_delivery");
  if (cancellable.includes(order.stage)) options.push({ text: plain("Cancel order"), value: JSON.stringify({ k: "cancel", o: order.id } satisfies OverflowValue) });
  if (order.stage !== "cancelled") options.push({ text: plain(order.shopifyOrderId ? "Change Shopify #PIK" : "Link Shopify #PIK"), value: JSON.stringify({ k: "shopify", o: order.id } satisfies OverflowValue) });
  if (!options.length) return null;
  return { type: "overflow", action_id: OPS_MORE_ACTION, options };
}

export function dashboardUrl(appBaseUrl: string | null, orderId: string): string | null {
  if (!appBaseUrl) return null;
  const base = appBaseUrl.replace(/\/+$/, "");
  if (!/^https?:\/\//.test(base)) return null;
  return `${base}/orders/${encodeURIComponent(orderId)}`;
}

export type CardContext = { stock: Record<string, StockLevel | null>; appBaseUrl: string | null };

/** The live order card. Slack limits: ≤50 blocks, ≤25 elements per actions block (we keep ≤5). */
export function orderCard(order: OrderDetail, ctx: CardContext): { text: string; blocks: Block[] } {
  const blocks: Block[] = [];
  blocks.push({ type: "header", text: plain(`${order.id} · ${STAGE_LABELS[order.stage]}`, 150) });

  const fields = [
    `*Customer*\n${esc(clip(order.customerName, 200))}`,
    `*Phone*\n${maskPhone(order.phone)}`,
    `*Hub*\n${esc(order.hub ?? "—")}`,
    `*POC*\n${esc(order.poc ?? "—")}`,
  ];
  if (order.shopifyOrderId) fields.push(`*Shopify*\n${esc(order.shopifyOrderId)}`);
  if (order.driver && (order.stage === "out_for_delivery" || order.stage === "delivered")) {
    fields.push(`*Delivery*\n${esc(order.driver)}${order.expectedDeliveryDate ? ` · ${shortDate(order.expectedDeliveryDate)}` : ""}`);
  }
  blocks.push({ type: "section", block_id: "customer", fields: fields.map((text) => ({ type: "mrkdwn", text })) });
  blocks.push({ type: "divider" });

  const shown = order.lines.slice(0, MAX_LINES_SHOWN);
  for (const line of shown) {
    const head = `*${line.lineNo}. ${esc(clip(line.productName, 150))}*${line.sku ? ` \`${esc(line.sku)}\`` : ""} · ${inr(line.offeredPriceMinor)}${line.qty > 1 ? ` × ${line.qty}` : ""}`;
    const rows = [head, `Status: ${esc(lineStatusText(order, line))}`];
    const deciding = DECIDING_STAGES.includes(order.stage) && (UNDECIDED.includes(line.status) || line.status === "awaiting_po");
    if (deciding) rows.push(stockText(line, ctx.stock));
    blocks.push({ type: "section", block_id: `line:${line.lineNo}`, text: { type: "mrkdwn", text: clip(rows.join("\n"), 2900) } });
    const buttons = lineButtons(order, line, ctx.stock);
    if (buttons.length) blocks.push({ type: "actions", block_id: `line_actions:${line.lineNo}`, elements: buttons.slice(0, 5) });
  }
  if (order.lines.length > shown.length) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `+${order.lines.length - shown.length} more products. Open the dashboard to see them.` }] });
  }
  blocks.push({ type: "divider" });

  const balance = Math.max(0, order.offeredTotalMinor - order.paidMinor);
  const money = [
    `*Offered*\n${inr(order.offeredTotalMinor)}`,
    `*Verified paid*\n${inr(order.paidMinor)}`,
    `*Balance*\n${inr(balance)}${order.codDueMinor > 0 ? ` (COD due ${inr(order.codDueMinor)})` : ""}`,
  ];
  blocks.push({ type: "section", block_id: "money", fields: money.map((text) => ({ type: "mrkdwn", text })) });
  const extra = order.stage === "cancelled" && order.cancelReason ? ` Reason: ${order.cancelReason}` : "";
  blocks.push({ type: "context", block_id: "next", elements: [{ type: "mrkdwn", text: clip(`*Next:* ${esc(nextStep(order))}${esc(extra)}`, 2000) }] });

  const elements: Block[] = [...stageButtons(order)];
  const url = dashboardUrl(ctx.appBaseUrl, order.id);
  if (url) elements.push({ type: "button", action_id: OPS_OPEN_ACTION, text: plain("Open in dashboard"), url });
  const more = overflow(order);
  if (more) elements.push(more);
  if (elements.length) blocks.push({ type: "actions", block_id: "order_actions", elements });

  return { text: `${order.id} · ${STAGE_LABELS[order.stage]} · ${order.customerName}`, blocks: blocks.slice(0, 50) };
}

function minorToRupeeText(minor: number | null): string {
  return minor == null ? "" : rupeesText(minor);
}

/**
 * Rebuilds the legacy sale text for a Slack order, so that `chat.update` keeps the message
 * text the old dashboard and the backfill script parse. Products are joined with " + " and
 * the offered price is the order total, the same as the text first posted.
 */
export function legacyTextForOrder(order: OrderDetail): string | null {
  if (!order.createdBy || !/^U[A-Z0-9]{6,}$/.test(order.createdBy)) return null;
  const first = order.lines[0];
  if (!first) return null;
  const fields: SaleFields = {
    customer: order.customerName,
    product: order.lines.map((line) => line.productName).join(" + "),
    email: order.email ?? "",
    shippingAddress: order.shippingAddress ?? "",
    pincode: order.pincode ?? "",
    billingAddress: order.billingAddress ?? "Same as shipping",
    hub: order.hub ?? "",
    cxType: order.cxType ?? "",
    poc: order.poc ?? "",
    saleSource: order.saleSource ?? "",
    saleType: order.saleType ?? "",
    listPrice: minorToRupeeText(first.listPriceMinor),
    offeredPrice: minorToRupeeText(order.offeredTotalMinor),
    paymentStatus: order.declaredPaymentStatus ?? "",
    paymentMode: order.declaredPaymentMode ?? "",
    gst: order.gst ?? "Not available",
    notes: order.notes ?? "",
    accessories: first.accessories ?? "None",
    extendedWarranty: first.extendedWarranty ?? "None",
    installation: first.installation ?? "None",
    salespersonId: order.createdBy,
  };
  return formatSale(fields);
}

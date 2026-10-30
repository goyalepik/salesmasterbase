import { rupeesToMinor } from "@/lib/ops/sale-input";
import type { LineDecision } from "@/lib/ops/service";
import { PAYMENT_MODES, type OrderDetail, type OrderLine, type PaymentKind, type ProcurementRequest, type PurchaseOrder } from "@/lib/ops/types";
import { clip, inr, lineLabel, plain, PRODUCT_SEARCH_ACTION, rupeesText, shortDate, type Block, type OpsKind, OPS_PREFIX } from "@/lib/slack/ops-cards";

/** What a modal carries between opening and submission. */
export type ModalMeta = { o: string; l?: string };

export const SEND_TO_INVENTORY = "send_to_inventory";
const KIND_OPTIONS: Array<{ value: PaymentKind; label: string }> = [
  { value: "advance", label: "Advance" },
  { value: "full", label: "Full payment" },
  { value: "finance", label: "Finance" },
];
const DELIVERY_MODES = ["Cash", "UPI", "Card", "NEFT", "Other"] as const;

// ── Building blocks ──────────────────────────────────────────────────────────

function textInput(blockId: string, label: string, opts: { placeholder?: string; optional?: boolean; initial?: string; max?: number; multiline?: boolean } = {}): Block {
  return {
    type: "input",
    block_id: blockId,
    optional: opts.optional ?? false,
    label: plain(label, 2000),
    element: {
      type: "plain_text_input",
      action_id: "value",
      ...(opts.placeholder ? { placeholder: plain(opts.placeholder, 150) } : {}),
      ...(opts.initial ? { initial_value: opts.initial } : {}),
      ...(opts.multiline ? { multiline: true } : {}),
      max_length: opts.max ?? 150,
    },
  };
}

function selectInput(blockId: string, label: string, options: Array<{ value: string; label: string }>, opts: { initial?: string; optional?: boolean } = {}): Block {
  const built = options.slice(0, 100).map((o) => ({ text: plain(o.label), value: o.value.slice(0, 150) }));
  const initial = built.find((o) => o.value === opts.initial);
  return {
    type: "input",
    block_id: blockId,
    optional: opts.optional ?? false,
    label: plain(label, 2000),
    element: { type: "static_select", action_id: "value", placeholder: plain("Choose"), options: built, ...(initial ? { initial_option: initial } : {}) },
  };
}

function dateInput(blockId: string, label: string, opts: { initial?: string | null; optional?: boolean } = {}): Block {
  return {
    type: "input",
    block_id: blockId,
    optional: opts.optional ?? true,
    label: plain(label, 2000),
    element: { type: "datepicker", action_id: "value", ...(opts.initial && /^\d{4}-\d{2}-\d{2}$/.test(opts.initial) ? { initial_date: opts.initial } : {}) },
  };
}

export function productSearchInput(blockId: string, label: string, optional: boolean): Block {
  return {
    type: "input",
    block_id: blockId,
    optional,
    label: plain(label, 2000),
    element: { type: "external_select", action_id: PRODUCT_SEARCH_ACTION, placeholder: plain("Type 2+ letters of the name or SKU", 150), min_query_length: 2 },
  };
}

function context(text: string): Block {
  return { type: "context", elements: [{ type: "mrkdwn", text: clip(text, 2000) }] };
}

function modal(kind: OpsKind, title: string, submit: string, meta: ModalMeta, blocks: Block[]): Block {
  return {
    type: "modal",
    callback_id: `${OPS_PREFIX}${kind}`,
    private_metadata: JSON.stringify(meta),
    title: plain(title, 24),
    submit: plain(submit, 24),
    close: plain("Cancel", 24),
    blocks: blocks.slice(0, 100),
  };
}

function orderContext(order: OrderDetail, line?: OrderLine): Block {
  const what = line ? lineLabel(line) : order.lines.map((l) => l.productName).join(", ");
  return context(`*${order.id}* · ${order.customerName.replace(/[<>&]/g, "")} · ${what.replace(/[<>&]/g, "")}`);
}

// ── Modals ───────────────────────────────────────────────────────────────────

export function verifyPaymentModal(order: OrderDetail): Block {
  const balance = Math.max(0, order.offeredTotalMinor - order.paidMinor);
  const declared = (PAYMENT_MODES as readonly string[]).includes(order.declaredPaymentMode ?? "") ? order.declaredPaymentMode! : undefined;
  return modal("verify", "Verify payment", "Verify", { o: order.id }, [
    orderContext(order),
    context(`Offered ${inr(order.offeredTotalMinor)} · Verified so far ${inr(order.paidMinor)} · Sales said: ${order.declaredPaymentStatus ?? "—"}`),
    textInput("amount", "Amount received (₹)", { placeholder: "25000", initial: balance ? rupeesText(balance) : undefined, max: 15 }),
    selectInput("mode", "Payment mode", PAYMENT_MODES.map((m) => ({ value: m, label: m })), { initial: declared }),
    selectInput("kind", "Payment type", KIND_OPTIONS, { initial: "advance" }),
    textInput("reference", "UTR / reference", { placeholder: "Bank UTR, card slip or finance ID", optional: true, max: 80 }),
    {
      type: "input",
      block_id: "send",
      optional: true,
      label: plain("Next step"),
      element: {
        type: "checkboxes",
        action_id: "value",
        options: [{ text: plain("Send to inventory"), value: SEND_TO_INVENTORY }],
        initial_options: [{ text: plain("Send to inventory"), value: SEND_TO_INVENTORY }],
      },
    },
  ]);
}

export function reasonModal(kind: "clear" | "reject" | "cancel", order: OrderDetail, line?: OrderLine): Block {
  const copy = {
    clear: { title: "Clear without payment", submit: "Send to inventory", label: "Why is it cleared without payment?", placeholder: "Finance approved, trusted repeat customer…" },
    reject: { title: "Reject product", submit: "Reject", label: "Why is it rejected?", placeholder: "Discontinued, price mismatch…" },
    cancel: { title: "Cancel order", submit: "Cancel order", label: "Why is it cancelled?", placeholder: "Customer changed their mind…" },
  }[kind];
  return modal(kind, copy.title, copy.submit, { o: order.id, ...(line ? { l: line.id } : {}) }, [
    orderContext(order, line),
    textInput("reason", copy.label, { placeholder: copy.placeholder, max: 300, multiline: true }),
  ]);
}

export function procureModal(order: OrderDetail, line: OrderLine): Block {
  return modal("procure", "Procure for customer", "Procure", { o: order.id, l: line.id }, [
    orderContext(order, line),
    textInput("vendor", "Vendor", { placeholder: "Vendor or distributor" , max: 100 }),
    textInput("cost", "Cost per unit (₹)", { placeholder: "Leave blank if not known", optional: true, max: 15 }),
    dateInput("eta", "Expected arrival"),
  ]);
}

export function poOptionLabel(po: PurchaseOrder): string {
  const left = po.qtyOrdered - po.qtyReceived;
  return clip(`${po.poNumber}${po.vendor ? ` · ${po.vendor}` : ""} · ETA ${po.eta ? shortDate(po.eta) : "not set"} · ${left} due`, 75);
}

export function holdPoModal(order: OrderDetail, line: OrderLine, pos: PurchaseOrder[]): Block {
  const open = pos.filter((po) => po.status === "open" && po.qtyOrdered > po.qtyReceived);
  return modal("hold_po", "Hold on PO", "Hold", { o: order.id, l: line.id }, [
    orderContext(order, line),
    selectInput("po", "Purchase order", open.map((po) => ({ value: po.id, label: poOptionLabel(po) }))),
  ]);
}

export function mapSkuModal(order: OrderDetail, line: OrderLine): Block {
  return modal("map_sku", "Map SKU", "Save SKU", { o: order.id, l: line.id }, [
    context(`*${order.id}* · Sales wrote “${line.productName.replace(/[<>&]/g, "")}”. Pick the catalogue product.`),
    productSearchInput("sku", "Catalogue product", false),
  ]);
}

export function procOrderedModal(order: OrderDetail, line: OrderLine, request: ProcurementRequest): Block {
  return modal("proc_ordered", "Mark ordered", "Save", { o: order.id, l: line.id }, [
    orderContext(order, line),
    context(`Vendor: ${request.vendor.replace(/[<>&]/g, "")}`),
    textInput("po_number", "Vendor PO / order no.", { placeholder: "Leave blank if none", optional: true, max: 60 }),
    dateInput("eta", "Expected arrival", { initial: request.eta }),
  ]);
}

export function procReceivedModal(order: OrderDetail, line: OrderLine): Block {
  return modal("proc_received", "Goods received", "Received", { o: order.id, l: line.id }, [
    orderContext(order, line),
    textInput("serial", "Serial / IMEI", { placeholder: "Leave blank if none", optional: true, max: 80 }),
  ]);
}

export function dispatchModal(order: OrderDetail, today: string): Block {
  const serialBlocks = order.lines
    .filter((line) => line.status === "reserved")
    .slice(0, 20)
    .map((line) => textInput(`serial:${line.id}`, `Serial / IMEI · ${clip(line.productName, 60)}`, { optional: true, initial: line.serialNo ?? undefined, max: 80 }));
  return modal("dispatch", "Out for delivery", "Dispatch", { o: order.id }, [
    orderContext(order),
    context(order.codDueMinor ? `Collect *${inr(order.codDueMinor)}* on delivery.` : "Nothing to collect on delivery."),
    textInput("driver", "Delivery person", { placeholder: "Name of who is delivering", max: 80 }),
    ...serialBlocks,
    dateInput("expected", "Expected delivery date", { initial: today }),
  ]);
}

export function deliveredModal(order: OrderDetail): Block {
  return modal("delivered", "Mark delivered", "Delivered", { o: order.id }, [
    orderContext(order),
    textInput("collected", "Amount collected (₹)", { initial: rupeesText(order.codDueMinor), placeholder: "0 if nothing was collected", max: 15 }),
    selectInput("mode", "Collected by", DELIVERY_MODES.map((m) => ({ value: m, label: m })), { initial: "Cash" }),
  ]);
}

export function shopifyModal(order: OrderDetail): Block {
  return modal("shopify", "Link Shopify order", "Save", { o: order.id }, [
    orderContext(order),
    textInput("shopify", "Shopify order number", { placeholder: "#PIK3918", initial: order.shopifyOrderId ?? undefined, max: 20 }),
  ]);
}

// ── Reading submissions ──────────────────────────────────────────────────────

type ElementState = {
  value?: string | null;
  selected_option?: { value?: string; text?: { text?: string } } | null;
  selected_date?: string | null;
  selected_options?: Array<{ value?: string }> | null;
};

/** Reads the single element in a block of `view.state.values`, whatever its action_id. */
export function readState(values: unknown, blockId: string): { text: string; selected: string | null; selectedText: string | null; date: string | null; checked: string[] } {
  const empty = { text: "", selected: null, selectedText: null, date: null, checked: [] as string[] };
  if (!values || typeof values !== "object") return empty;
  const block = (values as Record<string, unknown>)[blockId];
  if (!block || typeof block !== "object") return empty;
  const element = Object.values(block as Record<string, unknown>)[0] as ElementState | undefined;
  if (!element || typeof element !== "object") return empty;
  return {
    text: typeof element.value === "string" ? element.value.replace(/\s+/g, " ").trim() : "",
    selected: typeof element.selected_option?.value === "string" ? element.selected_option.value : null,
    selectedText: typeof element.selected_option?.text?.text === "string" ? element.selected_option.text.text : null,
    date: typeof element.selected_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(element.selected_date) ? element.selected_date : null,
    checked: Array.isArray(element.selected_options) ? element.selected_options.map((o) => o?.value).filter((v): v is string => typeof v === "string") : [],
  };
}

export function blockIds(values: unknown): string[] {
  return values && typeof values === "object" ? Object.keys(values as Record<string, unknown>) : [];
}

function amount(text: string, allowZero = false): number | null {
  const minor = rupeesToMinor(text);
  if (minor == null) return null;
  if (minor < 0 || (!allowZero && minor === 0) || minor > 1_000_000_000) return null;
  return minor;
}

export type ParsedSubmission =
  | { kind: "verify"; amountMinor: number; mode: string; payKind: PaymentKind; reference: string | null; clear: boolean }
  | { kind: "clear" | "reject" | "cancel"; reason: string }
  | { kind: "procure"; decision: Extract<LineDecision, { type: "procure" }> }
  | { kind: "hold_po"; poId: string }
  | { kind: "map_sku"; sku: string }
  | { kind: "proc_ordered"; poNumber: string | null; eta: string | null }
  | { kind: "proc_received"; serialNo: string | null }
  | { kind: "dispatch"; driver: string; serials: Record<string, string>; expectedDate: string | null }
  | { kind: "delivered"; collectedMinor: number; mode: string }
  | { kind: "shopify"; shopify: string };

/** The block that service errors are shown under, i.e. the first input of each modal. */
export const FIRST_INPUT: Record<Exclude<OpsKind, "reserve" | "brand_direct">, string> = {
  verify: "amount",
  clear: "reason",
  reject: "reason",
  cancel: "reason",
  procure: "vendor",
  hold_po: "po",
  map_sku: "sku",
  proc_ordered: "po_number",
  proc_received: "serial",
  dispatch: "driver",
  delivered: "collected",
  shopify: "shopify",
};

export function parseSubmission(kind: OpsKind, values: unknown): { ok: true; value: ParsedSubmission } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const done = (value: ParsedSubmission) => (Object.keys(errors).length ? { ok: false as const, errors } : { ok: true as const, value });
  switch (kind) {
    case "verify": {
      const amountMinor = amount(readState(values, "amount").text);
      const mode = readState(values, "mode").selected ?? "";
      const payKind = readState(values, "kind").selected ?? "";
      if (amountMinor == null) errors.amount = "Enter the amount received in rupees, like 25000.";
      if (!(PAYMENT_MODES as readonly string[]).includes(mode)) errors.mode = "Choose the payment mode.";
      if (!KIND_OPTIONS.some((k) => k.value === payKind)) errors.kind = "Choose advance, full or finance.";
      const reference = readState(values, "reference").text || null;
      const clear = readState(values, "send").checked.includes(SEND_TO_INVENTORY);
      return done({ kind, amountMinor: amountMinor ?? 0, mode, payKind: payKind as PaymentKind, reference, clear });
    }
    case "clear":
    case "reject":
    case "cancel": {
      const reason = readState(values, "reason").text;
      if (reason.length < 3) errors.reason = "Write a short reason.";
      return done({ kind, reason });
    }
    case "procure": {
      const vendor = readState(values, "vendor").text;
      const costText = readState(values, "cost").text;
      const costMinor = costText ? amount(costText) : null;
      if (vendor.length < 2) errors.vendor = "Enter the vendor.";
      if (costText && costMinor == null) errors.cost = "Enter the cost in rupees, or leave it blank.";
      return done({ kind, decision: { type: "procure", vendor, costMinor, eta: readState(values, "eta").date } });
    }
    case "hold_po": {
      const poId = readState(values, "po").selected;
      if (!poId) errors.po = "Choose the purchase order.";
      return done({ kind, poId: poId ?? "" });
    }
    case "map_sku": {
      const sku = readState(values, "sku").selected;
      if (!sku) errors.sku = "Pick the catalogue product.";
      return done({ kind, sku: sku ?? "" });
    }
    case "proc_ordered":
      return done({ kind, poNumber: readState(values, "po_number").text || null, eta: readState(values, "eta").date });
    case "proc_received":
      return done({ kind, serialNo: readState(values, "serial").text || null });
    case "dispatch": {
      const driver = readState(values, "driver").text;
      if (driver.length < 2) errors.driver = "Enter who is delivering.";
      const serials: Record<string, string> = {};
      for (const id of blockIds(values)) {
        if (!id.startsWith("serial:")) continue;
        const serial = readState(values, id).text;
        if (serial) serials[id.slice("serial:".length)] = serial;
      }
      return done({ kind, driver, serials, expectedDate: readState(values, "expected").date });
    }
    case "delivered": {
      const text = readState(values, "collected").text || "0";
      const collectedMinor = amount(text, true);
      const mode = readState(values, "mode").selected ?? "";
      if (collectedMinor == null) errors.collected = "Enter the amount collected in rupees, or 0.";
      if (!(DELIVERY_MODES as readonly string[]).includes(mode)) errors.mode = "Choose how it was collected.";
      return done({ kind, collectedMinor: collectedMinor ?? 0, mode });
    }
    case "shopify": {
      const shopify = readState(values, "shopify").text;
      if (!/^#?\s*PIK\s*\d{3,}$/i.test(shopify)) errors.shopify = "Shopify order numbers look like #PIK3918.";
      return done({ kind, shopify: shopify.replace(/\s+/g, "") });
    }
    case "reserve":
    case "brand_direct":
      return { ok: false, errors: {} };
  }
}

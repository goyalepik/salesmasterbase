import { normalisePhone } from "@/lib/ops/sale-input";

export const SALE_CALLBACK_ID = "epik_sale";
export const SALE_FORM_MARKER = "Form: epik-sale";
/** The pinned button and /sale: asks how the customer is buying, then opens the right form. */
export const SALE_BUTTON_ACTION = "open_sale_form";
export const SALE_CHOICE_CALLBACK_ID = "epik_sale_choice";
/** Short form: the customer orders on the website themselves. */
export const WEB_SALE_CALLBACK_ID = "epik_web_sale";
export const WEB_SALE_BUTTON_ACTION = "open_web_sale_form";
/** Long form: we create the order (dashboard + Shopify). */
export const FULL_SALE_BUTTON_ACTION = "open_full_sale_form";
/** action_id of every product external_select; its options come from a block_suggestion request. */
export const PRODUCT_SEARCH_ACTION = "product_search";
export const EXTRA_PRODUCT_SLOTS = [2, 3] as const;

export const HUBS = ["Hebbal", "HQ", "HSR HQ", "Jayanagar", "Kengeri", "Mahadevpura"] as const;
export const CX_TYPES = ["New", "Repeat"] as const;
export const SALE_SOURCES = ["Walk-in", "WhatsApp", "Instagram", "Facebook", "Reference", "Website", "Other"] as const;
export const SALE_TYPES = ["Follow up", "Same day"] as const;
export const PAYMENT_STATUSES = ["Pending", "Advance payment realized", "Refunded"] as const;
export const PAYMENT_MODES = ["Cash", "UPI", "Card", "NEFT", "Snapmint", "Bajaj", "Other"] as const;
export const WARRANTIES = ["None", "1 year", "2 year", "3 year"] as const;

// Slack forms (the dashboard New order form keeps the lists above).
export const WEB_SALE_SOURCES = ["Home Demo", "Virtual Demo"] as const;
export const SLACK_SALE_SOURCES = ["Home Demo", "Virtual Demo"] as const;
export const SLACK_PAYMENT_STATUSES = ["To be collected", "Full paid", "Partial"] as const;
/** When money was received: how it was paid. */
export const PAID_BY = ["Cash", "UPI", "Card", "NEFT", "Snapmint", "Bajaj", "Other"] as const;
/** When nothing was received yet: how it will be collected. */
export const COLLECT_BY = ["Cash on delivery", "UPI on delivery", "Card on delivery", "Payment link", "Snapmint", "Bajaj", "Other"] as const;
/** Digital payments need a UTR / transaction id so RevOps can match the bank. */
export const UTR_NEEDED: readonly string[] = ["UPI", "Card", "NEFT"];
export const INSTALLATIONS = ["None", "Added"] as const;

export type SaleFields = {
  customer: string;
  product: string;
  email: string;
  shippingAddress: string;
  pincode: string;
  billingAddress: string;
  hub: string;
  cxType: string;
  poc: string;
  saleSource: string;
  saleType: string;
  listPrice: string;
  offeredPrice: string;
  paymentStatus: string;
  paymentMode: string;
  gst: string;
  notes: string;
  accessories: string;
  extendedWarranty: string;
  installation: string;
  salespersonId: string;
  /** YYYY-MM-DD, from the long Slack form. */
  expectedDelivery?: string;
};

type SlackText = { type: "plain_text"; text: string; emoji?: boolean };

function plain(text: string): SlackText {
  return { type: "plain_text", text, emoji: false };
}

function textInput(blockId: string, label: string, placeholder: string, optional = false, maxLength = 80) {
  return {
    type: "input",
    block_id: blockId,
    optional,
    label: plain(label),
    element: {
      type: "plain_text_input",
      action_id: "value",
      placeholder: plain(placeholder),
      max_length: maxLength,
    },
  };
}

function choice(blockId: string, label: string, options: readonly string[], initial?: string, dispatch = false) {
  return {
    type: "input",
    block_id: blockId,
    ...(dispatch ? { dispatch_action: true } : {}),
    label: plain(label),
    element: {
      type: "static_select",
      action_id: "value",
      placeholder: plain("Choose"),
      ...(initial ? { initial_option: { text: plain(initial), value: initial } } : {}),
      options: options.map((option) => ({ text: plain(option), value: option })),
    },
  };
}

function productSelect(blockId: string, label: string, optional: boolean) {
  return {
    type: "input",
    block_id: blockId,
    optional,
    label: plain(label),
    element: {
      type: "external_select",
      action_id: PRODUCT_SEARCH_ACTION,
      placeholder: plain("Type 2+ letters of the name or SKU"),
      min_query_length: 2,
    },
  };
}

function textInputWithHint(blockId: string, label: string, placeholder: string, hint: string, optional = false, maxLength = 80) {
  return { ...textInput(blockId, label, placeholder, optional, maxLength), hint: plain(hint) };
}

/** The payment questions under "Payment status": what was paid and how, or how it will be collected. */
function paymentBlocks(status: string | null) {
  if (status === "Full paid" || status === "Partial") {
    return [
      choice("paid_by", "Paid by", PAID_BY),
      status === "Partial"
        ? textInput("amount_received", "Amount received so far (₹)", "20000", false, 15)
        : textInputWithHint("amount_received", "Amount received (₹)", "Leave blank if it is the full offered price", "Blank means the full offered price.", true, 15),
      textInputWithHint("utr", "UTR / transaction ID", "e.g. 431298765432", "Needed for UPI, card and NEFT. RevOps matches it with the bank.", true, 40),
    ];
  }
  if (status === "To be collected") return [choice("collect_by", "How will it be collected?", COLLECT_BY)];
  return [{ type: "context", elements: [{ type: "mrkdwn", text: "Pick the payment status. The payment questions appear here." }] }];
}

/**
 * The long form: we create the order (dashboard order + Shopify order). `paymentStatus` redraws the payment
 * questions after the CDE picks a status (Slack keeps what was already typed).
 */
export function saleModal(channelId: string, opts: { paymentStatus?: string | null } = {}) {
  const status = opts.paymentStatus && (SLACK_PAYMENT_STATUSES as readonly string[]).includes(opts.paymentStatus) ? opts.paymentStatus : null;
  return {
    type: "modal",
    callback_id: SALE_CALLBACK_ID,
    private_metadata: JSON.stringify({ channel: channelId }),
    title: plain("Manual order (CDE)"),
    submit: plain("Post order"),
    close: plain("Cancel"),
    blocks: [
      textInput("customer", "Customer name", "Customer name"),
      textInput("phone", "Customer phone", "98450 12345", false, 20),
      textInput("email", "Email", "name@email.com", true),
      productSelect("product", "Product", true),
      textInput("offered_price", "Offered price (₹)", "69900"),
      textInput("product_other", "Product not in the list", "Type it only if you cannot find it above", true, 150),
      textInput("shipping_address", "Shipping address", "House, street, area", false, 200),
      textInput("pincode", "Pincode", "560001"),
      textInput("billing_address", "Billing address", "Leave blank if same as shipping", true, 200),
      textInput("gst", "GST details", "Leave blank if not available", true, 120),
      choice("hub", "Hub", HUBS),
      textInput("poc", "POC name", "Salesperson name"),
      choice("cx_type", "CX type", CX_TYPES),
      choice("sale_source", "Sale source", SLACK_SALE_SOURCES),
      choice("sale_type", "Sale type", SALE_TYPES),
      choice("payment_status", "Payment status", SLACK_PAYMENT_STATUSES, status ?? undefined, true),
      ...paymentBlocks(status),
      { type: "header", text: plain("Add-ons") },
      textInput("accessories", "Accessories", "Leave blank if none", true, 80),
      choice("extended_warranty", "Extended warranty", WARRANTIES, "None"),
      choice("installation", "Installation", INSTALLATIONS, "None"),
      {
        type: "input",
        block_id: "expected_delivery",
        optional: true,
        label: plain("Expected delivery date"),
        element: { type: "datepicker", action_id: "value", placeholder: plain("Pick a date") },
      },
      textInput("notes", "Notes", "Anything else", true, 300),
    ],
  };
}

/** First screen of /sale and the pinned button: how is the customer buying? */
export function saleChoiceModal(channelId: string) {
  return {
    type: "modal",
    callback_id: SALE_CHOICE_CALLBACK_ID,
    private_metadata: JSON.stringify({ channel: channelId }),
    title: plain("New sale"),
    submit: plain("Next"),
    close: plain("Cancel"),
    blocks: [
      {
        type: "input",
        block_id: "sale_kind",
        label: plain("How is the customer buying?"),
        element: {
          type: "radio_buttons",
          action_id: "value",
          options: [
            { text: plain("Order placed on website"), value: "web", description: plain("Short form. The customer places the order on the website.") },
            { text: plain("Place order manually (CDE)"), value: "full", description: plain("Full form. The order goes to the dashboard and Shopify.") },
          ],
        },
      },
    ],
  };
}

/** The chosen form, or null when nothing was picked. */
export function formForChoice(values: unknown, channelId: string) {
  const kind = field(values, "sale_kind");
  if (kind === "web") return webSaleModal(channelId);
  if (kind === "full") return saleModal(channelId);
  return null;
}

/** The short form: the customer will order on the website. Nothing is created in Shopify. */
export function webSaleModal(channelId: string) {
  return {
    type: "modal",
    callback_id: WEB_SALE_CALLBACK_ID,
    private_metadata: JSON.stringify({ channel: channelId }),
    title: plain("Website order"),
    submit: plain("Post"),
    close: plain("Cancel"),
    blocks: [
      { type: "context", elements: [{ type: "mrkdwn", text: "The customer orders on the website. When the order arrives, it is credited to you." }] },
      textInput("customer", "Customer name", "Customer name"),
      textInputWithHint("phone", "Customer phone", "98450 12345", "The number they will use on the website. This is how the order is matched to you.", false, 20),
      productSelect("product", "Product they are buying", false),
      textInput("poc", "POC name", "Your name"),
      choice("sale_source", "Sale source", WEB_SALE_SOURCES),
      textInput("notes", "Notes", "Anything else", true, 300),
    ],
  };
}

export function saleButtonMessage() {
  return {
    text: "New sale",
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: "*New sale*\nPick how the customer is buying. Fill the boxes. Press Post." },
      },
      {
        type: "actions",
        elements: [
          { type: "button", style: "primary", action_id: FULL_SALE_BUTTON_ACTION, text: plain("Place order manually (CDE)") },
          { type: "button", action_id: WEB_SALE_BUTTON_ACTION, text: plain("Order placed on website") },
        ],
      },
    ],
  };
}

/** Global shortcuts (the lightning menu in any message box). Callback IDs as set in the Slack app. */
export const SALE_SHORTCUTS: Record<string, "choice" | "web" | "full"> = {
  new_sale: "choice",
  website_order: "web",
  create_order: "full",
};

/** The form a pinned button, Home tab button or shortcut opens. */
export function openerView(kind: "choice" | "web" | "full", channelId: string) {
  return kind === "full" ? saleModal(channelId) : kind === "web" ? webSaleModal(channelId) : saleChoiceModal(channelId);
}

/** The SalesMasterbase Home tab: the same two buttons, always one tap away in the Slack sidebar. */
export function saleHomeView() {
  return {
    type: "home",
    blocks: [
      { type: "header", text: plain("New sale") },
      { type: "section", text: { type: "mrkdwn", text: "Pick how the customer is buying. Fill the boxes. Press Post.\nThe sale is posted in the sales channel." } },
      {
        type: "actions",
        elements: [
          { type: "button", style: "primary", action_id: FULL_SALE_BUTTON_ACTION, text: plain("Place order manually (CDE)") },
          { type: "button", action_id: WEB_SALE_BUTTON_ACTION, text: plain("Order placed on website") },
        ],
      },
      { type: "divider" },
      { type: "context", elements: [{ type: "mrkdwn", text: "Also works: the pinned buttons in the sales channel, *New sale* in the lightning menu of any message box, or `/sale`." }] },
    ],
  };
}

function money(value: string): string | null {
  const digits = value.replace(/[₹,\s]/g, "").replace(/rs\.?/i, "");
  if (!/^\d+(\.\d{1,2})?$/.test(digits)) return null;
  const amount = Number(digits);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) return null;
  return digits;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function field(values: unknown, blockId: string): string {
  if (!values || typeof values !== "object") return "";
  const block = (values as Record<string, unknown>)[blockId];
  if (!block || typeof block !== "object") return "";
  const element = (block as Record<string, unknown>).value;
  if (!element || typeof element !== "object") return "";
  const selected = (element as Record<string, unknown>).selected_option;
  if (selected && typeof selected === "object") {
    const picked = (selected as Record<string, unknown>).value;
    if (typeof picked === "string") return oneLine(picked);
  }
  const date = (element as Record<string, unknown>).selected_date;
  if (typeof date === "string") return date;
  const raw = (element as Record<string, unknown>).value;
  return typeof raw === "string" ? oneLine(raw) : "";
}

function oneOf(value: string, options: readonly string[]): boolean {
  return options.includes(value);
}

export function readOrderFields(input: {
  customer: string;
  product: string;
  email: string;
  shippingAddress: string;
  pincode: string;
  billingAddress: string;
  hub: string;
  cxType: string;
  poc: string;
  saleSource: string;
  saleType: string;
  listPrice: string;
  offeredPrice: string;
  paymentStatus: string;
  paymentMode: string;
  gst: string;
  notes: string;
  accessories: string;
  extendedWarranty: string;
  installation: string;
}, opts: { listPriceRequired?: boolean; saleSources?: readonly string[]; paymentStatuses?: readonly string[]; paymentModes?: readonly string[] } = {}): { ok: true; fields: Omit<SaleFields, "salespersonId"> } | { ok: false; errors: Record<string, string> } {
  const customer = oneLine(input.customer);
  const product = oneLine(input.product);
  const email = oneLine(input.email);
  const shippingAddress = oneLine(input.shippingAddress);
  const pincode = oneLine(input.pincode).replace(/\s+/g, "");
  const billingAddress = oneLine(input.billingAddress);
  const hub = oneLine(input.hub);
  const cxType = oneLine(input.cxType);
  const poc = oneLine(input.poc);
  const saleSource = oneLine(input.saleSource);
  const saleType = oneLine(input.saleType);
  const listPrice = money(input.listPrice);
  const offered = money(input.offeredPrice);
  const paymentStatus = oneLine(input.paymentStatus);
  const paymentMode = oneLine(input.paymentMode);
  const gst = oneLine(input.gst);
  const notes = oneLine(input.notes);
  const accessories = oneLine(input.accessories);
  const extendedWarranty = oneLine(input.extendedWarranty);
  const installation = oneLine(input.installation);
  const errors: Record<string, string> = {};
  if (customer.length < 2) errors.customer = "Enter the customer name.";
  if (product.length < 2) errors.product = "Enter the product.";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Enter the email, or leave it blank.";
  if (shippingAddress.length < 5) errors.shipping_address = "Enter the shipping address.";
  if (!/^\d{6}$/.test(pincode)) errors.pincode = "Enter the 6 digit pincode.";
  if (!oneOf(hub, HUBS)) errors.hub = "Choose the hub.";
  if (!oneOf(cxType, CX_TYPES)) errors.cx_type = "Choose New or Repeat.";
  if (poc.length < 2) errors.poc = "Enter the POC name.";
  if (!oneOf(saleSource, opts.saleSources ?? SALE_SOURCES)) errors.sale_source = "Choose the sale source.";
  if (!oneOf(saleType, SALE_TYPES)) errors.sale_type = "Choose Follow up or Same day.";
  if (!listPrice && opts.listPriceRequired !== false) errors.list_price = "Enter the product price as a number.";
  if (!offered) errors.offered_price = "Enter the offered price as a number.";
  if (!oneOf(paymentStatus, opts.paymentStatuses ?? PAYMENT_STATUSES)) errors.payment_status = "Choose the payment status.";
  if (!oneOf(paymentMode, opts.paymentModes ?? PAYMENT_MODES)) errors.payment_mode = "Choose the payment mode.";
  if (!oneOf(extendedWarranty, WARRANTIES)) errors.extended_warranty = "Choose the warranty, or None.";
  if (!oneOf(installation, INSTALLATIONS)) errors.installation = "Choose installation, or None.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    fields: {
      customer,
      product,
      email,
      shippingAddress,
      pincode,
      billingAddress: billingAddress || "Same as shipping",
      hub,
      cxType,
      poc,
      saleSource,
      saleType,
      listPrice: listPrice ?? "",
      offeredPrice: offered ?? "",
      paymentStatus,
      paymentMode,
      gst: gst || "Not available",
      notes,
      accessories: accessories || "None",
      extendedWarranty,
      installation,
    },
  };
}

export function readSaleSubmission(values: unknown, salespersonId: string): { ok: true; fields: SaleFields } | { ok: false; errors: Record<string, string> } {
  const read = readOrderFields({
    customer: field(values, "customer"),
    product: field(values, "product"),
    email: field(values, "email"),
    shippingAddress: field(values, "shipping_address"),
    pincode: field(values, "pincode"),
    billingAddress: field(values, "billing_address"),
    hub: field(values, "hub"),
    cxType: field(values, "cx_type"),
    poc: field(values, "poc"),
    saleSource: field(values, "sale_source"),
    saleType: field(values, "sale_type"),
    listPrice: field(values, "list_price"),
    offeredPrice: field(values, "offered_price"),
    paymentStatus: field(values, "payment_status"),
    paymentMode: field(values, "payment_mode"),
    gst: field(values, "gst"),
    notes: field(values, "notes"),
    accessories: field(values, "accessories"),
    extendedWarranty: field(values, "extended_warranty"),
    installation: field(values, "installation"),
  });
  if (!read.ok) return read;
  if (!/^U[A-Z0-9]{6,}$/.test(salespersonId)) return { ok: false, errors: { customer: "Slack did not say who submitted this." } };
  return { ok: true, fields: { ...read.fields, salespersonId } };
}

/** "2026-11-14" → "14 Nov 2026" (same words in the posted text and when the card is redrawn). */
export function deliveryText(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return y && m && d ? `${d} ${months.at(m - 1)} ${y}` : iso;
}

export function formatSale(fields: SaleFields): string {
  const lines = [
    `Name - ${fields.customer}`,
    `Product - ${fields.product}`,
    ...(fields.listPrice ? [`Price - ${fields.listPrice}`] : []),
    `Offered price - ${fields.offeredPrice}`,
    `Shipping address - ${fields.shippingAddress}`,
    `Pincode - ${fields.pincode}`,
    `Billing address - ${fields.billingAddress}`,
    `Hub - ${fields.hub}`,
    `CX type - ${fields.cxType}`,
    `POC - ${fields.poc}`,
    `Sale source - ${fields.saleSource}`,
    `Sale type - ${fields.saleType}`,
    `Payment status - ${fields.paymentStatus}`,
    `Payment mode - ${fields.paymentMode}`,
    `GST - ${fields.gst}`,
    `Accessories - ${fields.accessories}`,
    `Extended warranty - ${fields.extendedWarranty}`,
    `Installation - ${fields.installation}`,
    ...(fields.expectedDelivery ? [`Expected delivery - ${deliveryText(fields.expectedDelivery)}`] : []),
  ];
  if (fields.email) lines.splice(2, 0, `Email - ${fields.email}`);
  if (fields.notes) lines.push(`Notes - ${fields.notes}`);
  lines.push(`Salesperson: <@${fields.salespersonId}>`);
  lines.push(SALE_FORM_MARKER);
  return lines.join("\n");
}

export function formatDeskOrder(fields: Omit<SaleFields, "salespersonId">): string {
  return formatSale({ ...fields, salespersonId: "UFORMUSER" }).replace("Salesperson: <@UFORMUSER>", `Salesperson: ${fields.poc}`);
}

export function formSalesperson(text: string): string | null {
  if (!text.includes(SALE_FORM_MARKER)) return null;
  const match = text.match(/Salesperson:\s*<@(U[A-Z0-9]+)>/);
  return match?.[1] ?? null;
}

export function channelFromMetadata(metadata: string, fallback: string | null): string | null {
  try {
    const parsed = JSON.parse(metadata) as { channel?: unknown };
    if (typeof parsed.channel === "string" && /^[CG][A-Z0-9]+$/.test(parsed.channel)) return parsed.channel;
  } catch {
    // A missing channel is handled by the caller.
  }
  return fallback;
}

// ── Sale modal with phone and catalogue products (operations flow) ───────────

/** "Apple iPhone 15 (128 GB) - Black · ₹69,900" (the Shopify price), or "… · sku" when there is no price. Max 75 characters. */
export function productOptionText(product: { sku: string; name: string; listPriceMinor?: number | null }): string {
  const suffix = ` · ${product.listPriceMinor ? rupeeText(product.listPriceMinor) : product.sku}`;
  const name = oneLine(product.name);
  if (suffix.length >= 74) return product.sku.slice(0, 75);
  const room = 75 - suffix.length;
  return `${name.length <= room ? name : `${name.slice(0, room - 1)}…`}${suffix}`;
}

/** The product name inside an option label, for when the catalogue cannot be read. */
export function nameFromOptionText(text: string): string {
  return text.replace(/\s·\s[^·]+$/, "").replace(/…$/, "").trim();
}

function picked(values: unknown, blockId: string): { sku: string; label: string } | null {
  if (!values || typeof values !== "object") return null;
  const block = (values as Record<string, unknown>)[blockId];
  if (!block || typeof block !== "object") return null;
  for (const element of Object.values(block as Record<string, unknown>)) {
    if (!element || typeof element !== "object") continue;
    const selected = (element as { selected_option?: { value?: unknown; text?: { text?: unknown } } | null }).selected_option;
    if (selected && typeof selected.value === "string" && selected.value) {
      const label = typeof selected.text?.text === "string" ? selected.text.text : selected.value;
      return { sku: selected.value, label };
    }
  }
  return null;
}

function anyText(values: unknown, blockId: string): string {
  if (!values || typeof values !== "object") return "";
  const block = (values as Record<string, unknown>)[blockId];
  if (!block || typeof block !== "object") return "";
  for (const element of Object.values(block as Record<string, unknown>)) {
    const raw = element && typeof element === "object" ? (element as { value?: unknown }).value : null;
    if (typeof raw === "string") return oneLine(raw);
  }
  return "";
}

function priceMinor(text: string): number | null {
  const digits = money(text);
  return digits ? Math.round(Number(digits) * 100) : null;
}

/** `listMinor`: the product's price from the product list (Shopify), filled in on the server; null when unknown. */
export type SaleProduct = { sku: string | null; name: string; offeredMinor: number; listMinor?: number | null };

export type OpsSaleSubmission = {
  /** Product 1 in `product` / `offeredPrice`, exactly as `orderInputFromSale` expects. */
  fields: SaleFields;
  phone: string;
  products: SaleProduct[];
};

/**
 * Reads the sale modal with phone and catalogue products. Product 1 is either picked from
 * the catalogue (sku set) or typed in "Product not in the list" (sku null). Products 2 and 3
 * need both the product and its offered price, or neither.
 */
/** True when the form on screen has the payment questions for this status (it may still show the first version). */
function hasPaymentBlocks(values: unknown, status: string): boolean {
  const v = (values && typeof values === "object" ? values : {}) as Record<string, unknown>;
  if (status === "To be collected") return "collect_by" in v;
  return "paid_by" in v;
}

export type OpsSaleRead =
  | { ok: true; sale: OpsSaleSubmission }
  /** `showPayment`: the form must be redrawn with the payment questions for this status before it can be checked. */
  | { ok: false; errors: Record<string, string>; showPayment?: string };

/**
 * Reads the long sale form. Product 1 is picked from the list (sku set) or typed in "Product not in the list"
 * (sku null). Payment: the status, then how it was paid (amount, UTR) or how it will be collected.
 * Products 2 and 3 are still read if an older form sends them.
 */
export function readOpsSaleSubmission(values: unknown, salespersonId: string): OpsSaleRead {
  const first = picked(values, "product");
  const other = anyText(values, "product_other");
  const firstName = first ? nameFromOptionText(first.label) || first.sku : other;
  const status = field(values, "payment_status");
  const paid = status === "Full paid" || status === "Partial";
  const known = (SLACK_PAYMENT_STATUSES as readonly string[]).includes(status);
  if (known && !hasPaymentBlocks(values, status)) return { ok: false, errors: {}, showPayment: status };
  const mode = paid ? field(values, "paid_by") : field(values, "collect_by");
  const read = readOrderFields({
    customer: field(values, "customer"),
    product: firstName,
    email: field(values, "email"),
    shippingAddress: field(values, "shipping_address"),
    pincode: field(values, "pincode"),
    billingAddress: field(values, "billing_address"),
    hub: field(values, "hub"),
    cxType: field(values, "cx_type"),
    poc: field(values, "poc"),
    saleSource: field(values, "sale_source"),
    saleType: field(values, "sale_type"),
    // The list price comes from the product list (Shopify), never from the form.
    listPrice: "",
    offeredPrice: field(values, "offered_price"),
    paymentStatus: status,
    paymentMode: mode,
    gst: field(values, "gst"),
    notes: field(values, "notes"),
    accessories: field(values, "accessories"),
    extendedWarranty: field(values, "extended_warranty"),
    installation: field(values, "installation"),
  }, { listPriceRequired: false, saleSources: SLACK_SALE_SOURCES, paymentStatuses: SLACK_PAYMENT_STATUSES, paymentModes: paid ? PAID_BY : COLLECT_BY });
  const errors: Record<string, string> = read.ok ? {} : { ...read.errors };

  if (errors.product || (!first && !other)) {
    delete errors.product;
    errors.product = "Pick the product from the list, or type it in “Product not in the list”.";
  }
  if (first && other) errors.product_other = "Pick from the list or type the product, not both. Clear one.";

  // Payment questions sit under the status: move the mode error to the box the CDE sees.
  if (errors.payment_mode) {
    delete errors.payment_mode;
    if (known) errors[paid ? "paid_by" : "collect_by"] = paid ? "Choose how it was paid." : "Choose how it will be collected.";
  }
  let paymentStatus = status;
  let paymentMode = mode;
  if (paid) {
    const offered = priceMinor(field(values, "offered_price"));
    const amountText = field(values, "amount_received");
    const amount = amountText ? priceMinor(amountText) : null;
    const utr = field(values, "utr").replace(/\s+/g, "");
    if (amountText && amount == null) errors.amount_received = "Enter the amount as a number.";
    if (status === "Partial" && !amountText) errors.amount_received = "Enter how much was received so far.";
    if (status === "Partial" && amount != null && offered != null && amount >= offered) errors.amount_received = "That is the full price. Choose Full paid instead.";
    if (UTR_NEEDED.includes(mode) && !utr) errors.utr = "Enter the UTR or transaction ID.";
    if (utr && !/^[A-Za-z0-9-]{4,40}$/.test(utr)) errors.utr = "Use letters and numbers only.";
    const received = amount ?? (status === "Full paid" ? offered : null);
    paymentStatus = received != null ? `${status}, ${rupeeText(received)} received` : status;
    paymentMode = utr ? `${mode}, UTR ${utr}` : mode;
  }

  const expected = field(values, "expected_delivery");
  if (expected && !/^\d{4}-\d{2}-\d{2}$/.test(expected)) errors.expected_delivery = "Pick a date.";

  const rawPhone = field(values, "phone");
  const phone = normalisePhone(rawPhone);
  if (!phone) errors.phone = "Enter the customer’s 10 digit mobile number.";

  const extras: SaleProduct[] = [];
  for (const n of EXTRA_PRODUCT_SLOTS) {
    const product = picked(values, `product_${n}`);
    const priceText = anyText(values, `offered_price_${n}`);
    if (!product && !priceText) continue;
    if (!product) {
      errors[`product_${n}`] = `Pick product ${n}, or clear its price.`;
      continue;
    }
    const offered = priceMinor(priceText);
    if (!priceText) errors[`offered_price_${n}`] = `Enter the offered price for product ${n}.`;
    else if (offered == null) errors[`offered_price_${n}`] = "Enter the offered price as a number.";
    if (offered != null) extras.push({ sku: product.sku, name: nameFromOptionText(product.label) || product.sku, offeredMinor: offered });
  }

  if (Object.keys(errors).length || !read.ok || !phone) return { ok: false, errors };
  if (!/^U[A-Z0-9]{6,}$/.test(salespersonId)) return { ok: false, errors: { customer: "Slack did not say who submitted this." } };
  const fields: SaleFields = { ...read.fields, paymentStatus, paymentMode, salespersonId, ...(expected ? { expectedDelivery: expected } : {}) };
  return {
    ok: true,
    sale: {
      fields,
      phone,
      products: [{ sku: first?.sku ?? null, name: fields.product, offeredMinor: priceMinor(fields.offeredPrice) ?? 0 }, ...extras],
    },
  };
}

/** ₹ amount in Indian style: 2000000 paise → "₹20,000". */
function rupeeText(minor: number): string {
  return `₹${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

// ── Website sale (short form) ────────────────────────────────────────────────

export type WebSaleSubmission = {
  customer: string;
  phone: string;
  sku: string;
  productName: string;
  poc: string;
  saleSource: string;
  notes: string;
  salespersonId: string;
  /** Filled on the server from the product list. */
  listMinor?: number | null;
};

export function readWebSaleSubmission(values: unknown, salespersonId: string): { ok: true; sale: WebSaleSubmission } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const customer = field(values, "customer");
  const phone = normalisePhone(field(values, "phone"));
  const product = picked(values, "product");
  const poc = field(values, "poc");
  const saleSource = field(values, "sale_source");
  if (customer.length < 2) errors.customer = "Enter the customer name.";
  if (!phone) errors.phone = "Enter the customer’s 10 digit mobile number.";
  if (!product) errors.product = "Pick the product from the list.";
  if (poc.length < 2) errors.poc = "Enter the POC name.";
  if (!oneOf(saleSource, WEB_SALE_SOURCES)) errors.sale_source = "Choose Home Demo or Virtual Demo.";
  if (Object.keys(errors).length || !phone || !product) return { ok: false, errors };
  if (!/^U[A-Z0-9]{6,}$/.test(salespersonId)) return { ok: false, errors: { customer: "Slack did not say who submitted this." } };
  return {
    ok: true,
    sale: { customer, phone, sku: product.sku, productName: nameFromOptionText(product.label) || product.sku, poc, saleSource, notes: field(values, "notes"), salespersonId },
  };
}

/** The channel text for a website sale. Same labels as a sale, so the old dashboard reads it; the price is the website price. */
export function formatWebSale(sale: WebSaleSubmission): string {
  const price = sale.listMinor != null ? minorText(sale.listMinor) : null;
  const lines = [
    `Name - ${sale.customer}`,
    `Product - ${sale.productName}`,
    ...(price ? [`Price - ${price}`, `Offered price - ${price}`] : []),
    `POC - ${sale.poc}`,
    `Sale source - ${sale.saleSource}`,
    "Order type - Website (the customer orders on the website)",
  ];
  if (sale.notes) lines.push(`Notes - ${sale.notes}`);
  lines.push(`Salesperson: <@${sale.salespersonId}>`);
  lines.push(SALE_FORM_MARKER);
  return lines.join("\n");
}

function minorText(minor: number): string {
  const rupees = minor / 100;
  return Number.isInteger(rupees) ? String(rupees) : rupees.toFixed(2);
}

/**
 * The fields for the legacy channel text (the old dashboard parses it): all products joined
 * with " + " and the offered price as the total of all products.
 */
export function legacySaleFields(sale: OpsSaleSubmission): SaleFields {
  if (sale.products.length <= 1) return { ...sale.fields, product: sale.products[0]?.name ?? sale.fields.product };
  const total = sale.products.reduce((sum, p) => sum + p.offeredMinor, 0);
  // "Price" stays product 1's list price, as the old dashboard has always read it.
  return { ...sale.fields, product: sale.products.map((p) => p.name).join(" + "), offeredPrice: minorText(total) };
}

/** Swaps option labels for full catalogue names and fills each product's list price from the catalogue (Shopify). */
export async function withCatalogue(
  sale: OpsSaleSubmission,
  lookup: (sku: string) => Promise<{ name: string; listPriceMinor: number | null } | null>,
): Promise<OpsSaleSubmission> {
  const products = await Promise.all(
    sale.products.map(async (product) => {
      if (!product.sku) return { ...product, listMinor: null };
      const found = await lookup(product.sku).catch(() => null);
      return { ...product, name: found?.name || product.name, listMinor: found?.listPriceMinor ?? null };
    }),
  );
  const first = products[0];
  return {
    ...sale,
    products,
    fields: { ...sale.fields, product: first?.name ?? sale.fields.product, listPrice: first?.listMinor != null ? minorText(first.listMinor) : "" },
  };
}

/** Swaps option labels for full catalogue names. `lookup` returns null when the SKU is unknown. */
export async function withCatalogueNames(sale: OpsSaleSubmission, lookup: (sku: string) => Promise<string | null>): Promise<OpsSaleSubmission> {
  return withCatalogue(sale, async (sku) => {
    const name = await lookup(sku);
    return name ? { name, listPriceMinor: null } : null;
  });
}

export const SALE_CALLBACK_ID = "epik_sale";
export const SALE_FORM_MARKER = "Form: epik-sale";
export const SALE_BUTTON_ACTION = "open_sale_form";

export const HUBS = ["Hebbal", "HQ", "HSR HQ", "Jayanagar", "Kengeri", "Mahadevpura"] as const;
export const CX_TYPES = ["New", "Repeat"] as const;
export const SALE_SOURCES = ["Walk-in", "WhatsApp", "Instagram", "Facebook", "Reference", "Website", "Other"] as const;
export const SALE_TYPES = ["Follow up", "Same day"] as const;
export const PAYMENT_STATUSES = ["Pending", "Advance payment realized", "Refunded"] as const;
export const PAYMENT_MODES = ["Cash", "UPI", "Card", "NEFT", "Snapmint", "Bajaj", "Other"] as const;
export const WARRANTIES = ["None", "1 year", "2 year", "3 year"] as const;
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

function choice(blockId: string, label: string, options: readonly string[], initial?: string) {
  return {
    type: "input",
    block_id: blockId,
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

export function saleModal(channelId: string) {
  return {
    type: "modal",
    callback_id: SALE_CALLBACK_ID,
    private_metadata: JSON.stringify({ channel: channelId }),
    title: plain("New sale"),
    submit: plain("Post order"),
    close: plain("Cancel"),
    blocks: [
      textInput("customer", "Customer name", "Customer name"),
      textInput("product", "Product", "Product"),
      textInput("email", "Email", "name@email.com", true),
      textInput("shipping_address", "Shipping address", "House, street, area", false, 200),
      textInput("pincode", "Pincode", "560001"),
      textInput("billing_address", "Billing address", "Leave blank if same as shipping", true, 200),
      choice("hub", "Hub", HUBS),
      choice("cx_type", "CX type", CX_TYPES),
      textInput("poc", "POC name", "Salesperson name"),
      choice("sale_source", "Sale source", SALE_SOURCES),
      choice("sale_type", "Sale type", SALE_TYPES),
      textInput("list_price", "Price of the product", "75000"),
      textInput("offered_price", "Offered price", "69900"),
      choice("payment_status", "Payment status", PAYMENT_STATUSES),
      choice("payment_mode", "Payment mode", PAYMENT_MODES),
      textInput("gst", "GST details", "Leave blank if not available", true, 120),
      { type: "header", text: plain("Add-ons") },
      textInput("accessories", "Accessories", "Leave blank if none", true, 80),
      choice("extended_warranty", "Extended warranty", WARRANTIES, "None"),
      choice("installation", "Installation", INSTALLATIONS, "None"),
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
        text: { type: "mrkdwn", text: "*New sale*\nTap the button. Fill the boxes. Press Post order." },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            style: "primary",
            action_id: SALE_BUTTON_ACTION,
            text: plain("New sale"),
          },
        ],
      },
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
}): { ok: true; fields: Omit<SaleFields, "salespersonId"> } | { ok: false; errors: Record<string, string> } {
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
  if (!oneOf(saleSource, SALE_SOURCES)) errors.sale_source = "Choose the sale source.";
  if (!oneOf(saleType, SALE_TYPES)) errors.sale_type = "Choose Follow up or Same day.";
  if (!listPrice) errors.list_price = "Enter the product price as a number.";
  if (!offered) errors.offered_price = "Enter the offered price as a number.";
  if (!oneOf(paymentStatus, PAYMENT_STATUSES)) errors.payment_status = "Choose the payment status.";
  if (!oneOf(paymentMode, PAYMENT_MODES)) errors.payment_mode = "Choose the payment mode.";
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

export function formatSale(fields: SaleFields): string {
  const lines = [
    `Name - ${fields.customer}`,
    `Product - ${fields.product}`,
    `Price - ${fields.listPrice}`,
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

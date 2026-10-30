import { normalisePhone } from "@/lib/ops/sale-input";

export const SALE_CALLBACK_ID = "epik_sale";
export const SALE_FORM_MARKER = "Form: epik-sale";
export const SALE_BUTTON_ACTION = "open_sale_form";
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
      textInput("phone", "Customer phone", "98450 12345", false, 20),
      productSelect("product", "Product", true),
      textInput("product_other", "Product not in the list", "Type it only if you cannot find it above", true, 150),
      textInput("email", "Email", "name@email.com", true),
      textInput("shipping_address", "Shipping address", "House, street, area", false, 200),
      textInput("pincode", "Pincode", "560001"),
      textInput("billing_address", "Billing address", "Leave blank if same as shipping", true, 200),
      choice("hub", "Hub", HUBS),
      choice("cx_type", "CX type", CX_TYPES),
      textInput("poc", "POC name", "Salesperson name"),
      choice("sale_source", "Sale source", SALE_SOURCES),
      choice("sale_type", "Sale type", SALE_TYPES),
      textInput("list_price", "Price of the product (₹)", "75000"),
      textInput("offered_price", "Offered price (₹)", "69900"),
      { type: "header", text: plain("More products (optional)") },
      ...EXTRA_PRODUCT_SLOTS.flatMap((n) => [
        productSelect(`product_${n}`, `Product ${n}`, true),
        textInput(`offered_price_${n}`, `Offered price for product ${n} (₹)`, "Leave blank if no product", true, 15),
      ]),
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

// ── Sale modal with phone and catalogue products (operations flow) ───────────

export function productOptionText(product: { sku: string; name: string }): string {
  const suffix = ` · ${product.sku}`;
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

export type SaleProduct = { sku: string | null; name: string; offeredMinor: number };

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
export function readOpsSaleSubmission(values: unknown, salespersonId: string): { ok: true; sale: OpsSaleSubmission } | { ok: false; errors: Record<string, string> } {
  const first = picked(values, "product");
  const other = anyText(values, "product_other");
  const firstName = first ? nameFromOptionText(first.label) || first.sku : other;
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
  const errors: Record<string, string> = read.ok ? {} : { ...read.errors };

  if (errors.product || (!first && !other)) {
    delete errors.product;
    errors.product = "Pick the product from the list, or type it in “Product not in the list”.";
  }
  if (first && other) errors.product_other = "Pick from the list or type the product, not both. Clear one.";

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
  const fields: SaleFields = { ...read.fields, salespersonId };
  return {
    ok: true,
    sale: {
      fields,
      phone,
      products: [{ sku: first?.sku ?? null, name: fields.product, offeredMinor: priceMinor(fields.offeredPrice) ?? 0 }, ...extras],
    },
  };
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
  return { ...sale.fields, product: sale.products.map((p) => p.name).join(" + "), offeredPrice: minorText(total) };
}

/** Swaps option labels for full catalogue names. `lookup` returns null when the SKU is unknown. */
export async function withCatalogueNames(sale: OpsSaleSubmission, lookup: (sku: string) => Promise<string | null>): Promise<OpsSaleSubmission> {
  const products = await Promise.all(
    sale.products.map(async (product) => {
      if (!product.sku) return product;
      const name = await lookup(product.sku).catch(() => null);
      return name ? { ...product, name } : product;
    }),
  );
  return { ...sale, products, fields: { ...sale.fields, product: products[0]?.name ?? sale.fields.product } };
}

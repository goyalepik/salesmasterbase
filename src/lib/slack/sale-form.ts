export const SALE_CALLBACK_ID = "epik_sale";
export const SALE_FORM_MARKER = "Form: epik-sale";

export type SaleFields = {
  customer: string;
  product: string;
  offeredPrice: string;
  customerType: string;
  advance: string;
  salespersonId: string;
};

type SlackText = { type: "plain_text"; text: string; emoji?: boolean };

function plain(text: string): SlackText {
  return { type: "plain_text", text, emoji: false };
}

function input(blockId: string, label: string, placeholder: string, optional = false) {
  return {
    type: "input",
    block_id: blockId,
    optional,
    label: plain(label),
    element: {
      type: "plain_text_input",
      action_id: "value",
      placeholder: plain(placeholder),
      min_length: optional ? undefined : 1,
      max_length: 80,
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
      input("customer", "Customer", "Customer name"),
      input("product", "Product", "Product"),
      input("offered_price", "Offered price", "69900"),
      input("customer_type", "Customer type", "Retail", true),
      input("advance", "Advance", "10000, if any", true),
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

function field(values: unknown, blockId: string): string {
  if (!values || typeof values !== "object") return "";
  const block = (values as Record<string, unknown>)[blockId];
  if (!block || typeof block !== "object") return "";
  const element = (block as Record<string, unknown>).value;
  if (!element || typeof element !== "object") return "";
  const raw = (element as Record<string, unknown>).value;
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
}

export function readOrderFields(input: {
  customer: string;
  product: string;
  offeredPrice: string;
  customerType: string;
  advance: string;
}): { ok: true; customer: string; product: string; offeredPrice: string; customerType: string; advance: string } | { ok: false; errors: Record<string, string> } {
  const customer = input.customer.replace(/\s+/g, " ").trim();
  const product = input.product.replace(/\s+/g, " ").trim();
  const offered = money(input.offeredPrice);
  const customerType = input.customerType.replace(/\s+/g, " ").trim();
  const advanceRaw = input.advance.replace(/\s+/g, " ").trim();
  const advance = advanceRaw ? money(advanceRaw) : "";
  const errors: Record<string, string> = {};
  if (customer.length < 2) errors.customer = "Enter the customer name.";
  if (product.length < 2) errors.product = "Enter the product.";
  if (!offered) errors.offered_price = "Enter the offered price as a number.";
  if (advanceRaw && !advance) errors.advance = "Enter the advance as a number, or leave it blank.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, customer, product, offeredPrice: offered ?? "", customerType, advance: advance || "" };
}

export function readSaleSubmission(values: unknown, salespersonId: string): { ok: true; fields: SaleFields } | { ok: false; errors: Record<string, string> } {
  const read = readOrderFields({
    customer: field(values, "customer"),
    product: field(values, "product"),
    offeredPrice: field(values, "offered_price"),
    customerType: field(values, "customer_type"),
    advance: field(values, "advance"),
  });
  if (!read.ok) return read;
  if (!/^U[A-Z0-9]{6,}$/.test(salespersonId)) return { ok: false, errors: { customer: "Slack did not say who submitted this." } };
  return {
    ok: true,
    fields: {
      customer: read.customer,
      product: read.product,
      offeredPrice: read.offeredPrice,
      customerType: read.customerType,
      advance: read.advance,
      salespersonId,
    },
  };
}

export function formatDeskOrder(fields: Omit<SaleFields, "salespersonId">, salespersonName: string): string {
  return formatSale({ ...fields, salespersonId: "UFORMUSER" }).replace("Salesperson: <@UFORMUSER>", `Salesperson: ${salespersonName}`);
}

export function formatSale(fields: SaleFields): string {
  const lines = [
    `Name - ${fields.customer}`,
    `Product - ${fields.product}`,
    `Offered price - ${fields.offeredPrice}`,
  ];
  if (fields.customerType) lines.push(`Customer type - ${fields.customerType}`);
  if (fields.advance) lines.push(`Advance - ${fields.advance}`);
  lines.push(`Salesperson: <@${fields.salespersonId}>`);
  lines.push(SALE_FORM_MARKER);
  return lines.join("\n");
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

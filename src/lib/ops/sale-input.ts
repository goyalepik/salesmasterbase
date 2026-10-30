import type { NewOrderInput, NewOrderLineInput, Order } from "@/lib/ops/types";

/** The validated sale form (Slack modal or desk form), as strings. Prices are rupees. */
export type SaleFormFields = {
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
};

export function rupeesToMinor(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const digits = String(value).replace(/[₹,\s]/g, "").replace(/^rs\.?/i, "");
  if (!/^\d+(\.\d{1,2})?$/.test(digits)) return null;
  return Math.round(Number(digits) * 100);
}

/** Indian mobile numbers: keeps the last 10 digits, drops +91 / 0 prefixes. Null when it is not a valid number. */
export function normalisePhone(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}

const blankish = (value: string) => (!value || /^(none|not available|same as shipping)$/i.test(value) ? null : value);

/**
 * Builds the order to store from a sale form. The first product comes from the main fields;
 * `extraLines` holds products 2+ (already in paise).
 */
export function orderInputFromSale(
  fields: SaleFormFields,
  extra: {
    source: Order["source"];
    phone: string | null;
    sku: string | null;
    extraLines?: NewOrderLineInput[];
    slackChannelId?: string | null;
    slackMessageTs?: string | null;
    createdBy?: string | null;
  },
): NewOrderInput {
  const first: NewOrderLineInput = {
    sku: extra.sku,
    productName: fields.product,
    listPriceMinor: rupeesToMinor(fields.listPrice),
    offeredPriceMinor: rupeesToMinor(fields.offeredPrice) ?? 0,
    accessories: blankish(fields.accessories),
    extendedWarranty: blankish(fields.extendedWarranty),
    installation: blankish(fields.installation),
  };
  return {
    source: extra.source,
    customerName: fields.customer,
    phone: extra.phone,
    email: fields.email || null,
    shippingAddress: fields.shippingAddress || null,
    pincode: fields.pincode || null,
    billingAddress: fields.billingAddress && !/^same as shipping$/i.test(fields.billingAddress) ? fields.billingAddress : null,
    gst: blankish(fields.gst),
    hub: fields.hub || null,
    cxType: fields.cxType || null,
    poc: fields.poc || null,
    saleSource: fields.saleSource || null,
    saleType: fields.saleType || null,
    declaredPaymentStatus: fields.paymentStatus || null,
    declaredPaymentMode: fields.paymentMode || null,
    notes: fields.notes || null,
    slackChannelId: extra.slackChannelId ?? null,
    slackMessageTs: extra.slackMessageTs ?? null,
    createdBy: extra.createdBy ?? null,
    lines: [first, ...(extra.extraLines ?? [])],
  };
}

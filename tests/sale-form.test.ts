import assert from "node:assert/strict";
import test from "node:test";
import { parseMessageText } from "../src/lib/parse/message";
import { formSalesperson, formatSale, readSaleSubmission, SALE_FORM_MARKER } from "../src/lib/slack/sale-form";

function values(extra: Record<string, string> = {}) {
  const base: Record<string, string> = {
    customer: "Sample Person",
    product: "Sample sofa",
    email: "sample.person@example.com",
    shipping_address: "Sample Street Bengaluru",
    pincode: "560001",
    billing_address: "",
    hub: "Hebbal",
    cx_type: "New",
    poc: "Rahul",
    sale_source: "Walk-in",
    sale_type: "Same day",
    list_price: "75000",
    offered_price: "69,900",
    payment_status: "Advance payment realized",
    payment_mode: "UPI",
    gst: "",
    notes: "Call before delivery",
    ...extra,
  };
  return Object.fromEntries(Object.entries(base).map(([key, value]) => [key, { value: { value } }]));
}

test("a sale form becomes one labelled order for the person who submitted it", () => {
  const read = readSaleSubmission(values(), "U0ASWUSJ53P");
  assert.equal(read.ok, true);
  if (!read.ok) return;
  const text = formatSale(read.fields);
  const parsed = parseMessageText(text);
  assert.equal(parsed.customerName, "Sample Person");
  assert.equal(parsed.product, "Sample sofa");
  assert.equal(parsed.offeredPriceMinor, 6990000);
  assert.equal(parsed.listPriceMinor, 7500000);
  assert.equal(text.includes("Hub - Hebbal"), true);
  assert.equal(text.includes("Billing address - Same as shipping"), true);
  assert.equal(text.includes("GST - Not available"), true);
  assert.equal(text.includes("POC - Rahul"), true);
  assert.equal(parsed.preview.includes("sample.person@example.com"), false);
  assert.equal(formSalesperson(text), "U0ASWUSJ53P");
  assert.equal(text.includes(SALE_FORM_MARKER), true);
});

test("a normal message cannot claim another salesperson", () => {
  assert.equal(formSalesperson("Salesperson: <@U0ASWUSJ53P>\nName - A"), null);
});

test("a blank offered price is refused", () => {
  const read = readSaleSubmission(values({ offered_price: "soon" }), "U0ASWUSJ53P");
  assert.equal(read.ok, false);
  if (read.ok) return;
  assert.equal(typeof read.errors.offered_price, "string");
});

test("a hub must be chosen from the list", () => {
  const read = readSaleSubmission(values({ hub: "Somewhere" }), "U0ASWUSJ53P");
  assert.equal(read.ok, false);
  if (read.ok) return;
  assert.equal(typeof read.errors.hub, "string");
});

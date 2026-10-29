import assert from "node:assert/strict";
import test from "node:test";
import { parseMessageText } from "../src/lib/parse/message";
import { formSalesperson, formatSale, readSaleSubmission, SALE_FORM_MARKER } from "../src/lib/slack/sale-form";

test("a sale form becomes one labelled order for the salesperson who submitted it", () => {
  const read = readSaleSubmission({
    customer: { value: { value: "Sample Person" } },
    product: { value: { value: "Sample sofa" } },
    offered_price: { value: { value: "69,900" } },
    customer_type: { value: { value: "Retail" } },
    advance: { value: { value: "10000" } },
  }, "U0ASWUSJ53P");
  assert.equal(read.ok, true);
  if (!read.ok) return;
  const text = formatSale(read.fields);
  const parsed = parseMessageText(text);
  assert.equal(parsed.customerName, "Sample Person");
  assert.equal(parsed.product, "Sample sofa");
  assert.equal(parsed.offeredPriceMinor, 6990000);
  assert.equal(parsed.customerType, "Retail");
  assert.equal(formSalesperson(text), "U0ASWUSJ53P");
  assert.equal(text.includes(SALE_FORM_MARKER), true);
});

test("a normal message cannot claim another salesperson", () => {
  assert.equal(formSalesperson("Salesperson: <@U0ASWUSJ53P>\nName - A"), null);
});

test("a blank offered price is refused", () => {
  const read = readSaleSubmission({
    customer: { value: { value: "Asha" } },
    product: { value: { value: "Chair" } },
    offered_price: { value: { value: "soon" } },
  }, "U0ASWUSJ53P");
  assert.equal(read.ok, false);
  if (read.ok) return;
  assert.equal(typeof read.errors.offered_price, "string");
});

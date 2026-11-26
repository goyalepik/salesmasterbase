import assert from "node:assert/strict";
import test from "node:test";
import { buildSnapshot, findProducts, findUnits, productsInView } from "../src/features/ims/domain/model";
import { readPoLines, readTrackerStock, readUnits, sheetDay } from "../src/features/ims/domain/sheets";

// Shapes as the three team sheets have them (headings by name; columns can move).
const masterbase = [
  ["Serial No.", "SKU Code", "Product Name", "Brand", "Tracking Type", "Quantity", "SOR/CnC", "Inward Date", "Vendor", "Invoice no.", "PO/PI ID", "Unit Cost", "Hub", "Condition on Inward", "Receiving Personnel", "In System (Y/N)", "Dispatch Date", "Price", "Customer Name", "Age of Stock (days)", "POC", "Returned to Vendor (Y/N)"],
  ["SNO-0001", "ep-dr-l50u", "Dreame L50 Ultra", "Dreame", "Serial", "1", "Cash and Carry", "01/11/2026", "Value One", "INV1", "PO-EPIK-26-27-0001", "50000", "Koramangala", "GOOD", "Anurag", "Yes", "", "", "", "", "", "No"],
  ["SNO-0002", "ep-dr-l50u", "Dreame L50 Ultra", "DREAME", "Serial", "1", "Cash and Carry", "01/11/2026", "Value One", "INV1", "PO-EPIK-26-27-0001", "50000", "Koramangala", "GOOD", "Anurag", "Yes", "", "", "", "", "", "No"],
  ["SNO-0003", "ep-dr-l50u", "Dreame L50 Ultra", "Dreame", "Serial", "0", "Cash and Carry", "20/10/2026", "Value One", "INV0", "PO-EPIK-26-27-0001", "50000", "Koramangala", "GOOD", "Anurag", "No", "20/11/2026", "69900", "Asha", "", "Baljeet Singh", "No"],
  ["SNO-0004", "ep-ap-i16", "Apple iPhone 16", "Apple", "Serial", "0", "Cash and Carry", "01/08/2026", "Arrowhead", "INV9", "", "60000", "Koramangala", "GOOD", "Harish", "No", "24/11/2026", "69900", "Ravi", "", "Simon H", "No"],
  ["SNO-0005", "ep-ap-i16", "Apple iPhone 16", "Apple", "Serial", "0", "Cash and Carry", "01/08/2026", "Arrowhead", "INV9", "", "60000", "Koramangala", "GOOD", "Harish", "No", "25/11/2026", "69900", "Meena", "", "Simon H", "No"],
  ["SNO-0006", "ep-old", "Old Fan", "Kent", "Serial", "1", "SOR", "01/06/2026", "Kent", "INV2", "", "3000", "Koramangala", "GOOD", "Anurag", "Yes", "", "", "", "", "", "No"],
];
const procurement = [
  ["Sr. No.", "Date", "PO/PI ID", "INVOICE NO.", "Brand / vendor Name", "SKU Name", "SKU Code", "Qty Raised", "Hub Location", "Procurement Owner", "Procurement Type (Brand/ Vendor)", "PO / PI Raised (Y/N)", "Payement Terms", "Sent to brand", "Expected Dispatch Date", "Dispatch Date", "GRN Status", "PO Status", "Received Date", "ETA", "Current ETA", "Revised ETA", "Delay Reason", "Customer Updated (Y/N)", "Priority (High/Medium/Low)", "Mail Subject line", "PO Link", "Brand", "Unit price (inc GST)", "Amount"],
  ["1", "20/10/2026", "PO-EPIK-26-27-0001", "", "Value One", "Dreame L50 Ultra", "ep-dr-l50u", "5", "HSR", "Anurag", "Brand", "Yes", "CnC", "", "", "", "Partially Received", "", "", "", "", "30/11/2026", "", "", "High", "", "", "Dreame", "50,000.00", ""],
  ["2", "15/11/2026", "PO-EPIK-26-27-0002", "", "Arrowhead", "Apple iPhone 16", "ep-ap-i16", "3", "HSR", "Harish", "Brand", "Yes", "CnC", "", "", "", "", "", "", "20/11/2026", "", "", "Commercials", "", "", "", "", "Apple", "60,000.00", ""],
  ["3", "01/07/2026", "PO-EPIK-26-27-0003", "", "Kent", "Old Fan", "ep-old", "4", "HSR", "Piyush", "Brand", "Yes", "SOR", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "Kent", "3,000.00", ""],
  ["4", "02/11/2026", "PO-EPIK-26-27-0004", "", "Kent", "Old Fan", "ep-old", "2", "HSR", "Piyush", "Brand", "Yes", "SOR", "", "", "", "Received and GRN done", "", "", "", "", "", "", "", "", "", "", "Kent", "3,000.00", ""],
  ["5", "02/11/2026", "PO-EPIK-26-27-0005", "", "Kent", "Old Fan", "ep-old", "2", "HSR", "Piyush", "Brand", "Yes", "SOR", "", "", "", "", "", "", "", "", "Not Coming", "", "", "", "", "", "Kent", "3,000.00", ""],
];
const tracker = [
  ["EPIK  ·  Current Stock"], ["as of:  Closing Count of 26th November"], ["TOTAL"],
  ["Brand", "SKU Code", "Product Name", "SOR / CnC", "Units", "COGS / unit", "COGS"],
  ["Dreame", "ep-dr-l50u", "Dreame L50 Ultra", "Cash and Carry", "1", "50000", "50000"],
  ["Kent", "ep-old", "Old Fan", "SOR", "1", "3000", "3000"],
];

const snap = () => buildSnapshot(readUnits(masterbase), readPoLines(procurement), readTrackerStock(tracker), "2026-11-26");

test("dates from the sheets are day first", () => {
  assert.equal(sheetDay("01/11/2026"), "2026-11-01");
  assert.equal(sheetDay("23-06-2026"), "2026-06-23");
  assert.equal(sheetDay("46326"), null);
});

test("stock comes from the Masterbase serials; the Tracker is a cross-check", () => {
  const s = snap();
  assert.equal(s.kpis.unitsInStock, 3);
  assert.equal(s.kpis.stockValue, 103_000);
  const l50 = s.products.find((p) => p.sku === "ep-dr-l50u")!;
  assert.equal(l50.inStock, 2);
  assert.equal(l50.trackerUnits, 1);
  assert.equal(l50.gap, 1, "2 serials vs 1 in the Tracker");
  assert.equal(s.kpis.gaps, 1);
  assert.equal(s.tracker.asOf, "Closing Count of 26th November");
  assert.deepEqual(s.brands.map((b) => b.brand), ["Dreame", "Kent"], "Dreame and DREAME are one brand");
});

test("coming = PO lines not received, less units that already arrived on the same PO and SKU", () => {
  const s = snap();
  const l50 = s.incoming.find((l) => l.sku === "ep-dr-l50u")!;
  assert.equal(l50.received, 3, "3 serials came in on PO 0001");
  assert.equal(l50.pending, 2);
  assert.equal(l50.state, "this_week" === l50.state ? "this_week" : "later");
  const iphone = s.incoming.find((l) => l.sku === "ep-ap-i16")!;
  assert.equal(iphone.state, "overdue", "ETA 20 Nov has passed");
  const old = s.incoming.find((l) => l.po === "PO-EPIK-26-27-0003")!;
  assert.equal(old.state, "stale", "raised in July, no ETA: probably received or dropped");
  assert.ok(!s.incoming.some((l) => l.po === "PO-EPIK-26-27-0004"), "GRN done");
  assert.ok(!s.incoming.some((l) => l.po === "PO-EPIK-26-27-0005"), "Not Coming");
  assert.equal(s.kpis.incomingUnits, 5, "stale lines are not counted as coming");
  assert.equal(s.products.find((p) => p.sku === "ep-old")!.incoming, 0);
  assert.equal(s.kpis.lateLines, 1);
});

test("movement, cover and what needs attention", () => {
  const s = snap();
  assert.equal(s.kpis.out7, 3, "an L50 and two iPhones out in the last 7 days");
  assert.equal(s.kpis.out30, 3);
  const iphone = s.products.find((p) => p.sku === "ep-ap-i16")!;
  assert.equal(iphone.inStock, 0);
  assert.equal(iphone.out30, 2);
  assert.ok(s.attention.some((a) => a.kind === "late"));
  assert.ok(s.attention.some((a) => a.kind === "old"), "the fan has been in since June");
  assert.equal(productsInView(s, "old")[0].sku, "ep-old");
  const l50 = s.products.find((p) => p.sku === "ep-dr-l50u")!;
  assert.equal(l50.cover, 60, "2 in stock, 1 sold in 30 days");
});

test("search by product words and by serial", () => {
  const s = snap();
  assert.deepEqual(findProducts(s, "l50 dreame").map((p) => p.sku), ["ep-dr-l50u"]);
  assert.equal(findUnits(s, "0004")[0].poc, "Simon H");
  assert.deepEqual(findUnits(s, "x"), []);
});

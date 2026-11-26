import assert from "node:assert/strict";
import test from "node:test";
import { matchProducts, poRef, receiptProblems, type Receipt } from "../src/features/ims/domain/app";
import { categorise } from "../src/features/ims/domain/categories";
import { buildSnapshot, fillCosts, findProducts, findUnits, OPENING_BAND, productsInView, type Sources } from "../src/features/ims/domain/model";
import { readCatalog, readDispatches, readInwards, readPoLines, readTrackerStock, readUnits, sheetDay } from "../src/features/ims/domain/sheets";

// Shapes as the team sheets have them (headings by name; columns can move).
const masterbase = [
  ["Serial No.", "SKU Code", "Product Name", "Brand", "Tracking Type", "Quantity", "SOR/CnC", "Inward Date", "Vendor", "Invoice no.", "PO/PI ID", "Unit Cost", "Hub", "Condition on Inward", "Receiving Personnel", "In System (Y/N)", "Dispatch Date", "Price", "Customer Name", "Age of Stock (days)", "POC", "Returned to Vendor (Y/N)"],
  ["SNO-0001", "ep-dr-l50u", "Dreame L50 Ultra Robot Vacuum", "Dreame", "Serial", "1", "Cash and Carry", "01/11/2026", "Value One", "INV1", "PO-EPIK-26-27-0001", "50000", "Koramangala", "GOOD", "Anurag", "Yes", "", "", "", "", "", "No"],
  ["SNO-0002", "ep-dr-l50u", "Dreame L50 Ultra Robot Vacuum", "DREAME", "Serial", "1", "Cash and Carry", "01/11/2026", "Value One", "INV1", "PO-EPIK-26-27-0001", "50000", "Koramangala", "GOOD", "Anurag", "Yes", "", "", "", "", "", "No"],
  ["SNO-0003", "ep-dr-l50u", "Dreame L50 Ultra Robot Vacuum", "Dreame", "Serial", "0", "Cash and Carry", "20/10/2026", "Value One", "INV0", "PO-EPIK-26-27-0001", "50000", "Koramangala", "GOOD", "Anurag", "No", "20/11/2026", "69900", "Asha", "", "Baljeet Singh", "No"],
  ["SNO-0004", "ep-ap-i16", "Apple iPhone 16 (128 GB)", "Apple", "Serial", "0", "Cash and Carry", "01/08/2026", "Arrowhead", "INV9", "", "60000", "Koramangala", "GOOD", "Harish", "No", "24/11/2026", "69900", "Ravi", "", "Simon H", "No"],
  ["SNO-0005", "ep-ap-i16", "Apple iPhone 16 (128 GB)", "Apple", "Serial", "0", "Cash and Carry", "01/08/2026", "Arrowhead", "INV9", "", "60000", "Koramangala", "GOOD", "Harish", "No", "25/11/2026", "69900", "Meena", "", "Simon H", "No"],
  ["SNO-0006", "ep-old", "Kent Table Fan", "Kent", "Serial", "1", "SOR", "01/06/2026", "Kent", "INV2", "", "3000", "Koramangala", "GOOD", "Anurag", "Yes", "", "", "", "", "", "No"],
  ["SNO-0007", "ep-old", "Kent Table Fan", "Kent", "Serial", "1", "SOR", "", "", "", "", "", "", "", "", "Yes", "", "", "", "", "", "No"],
];
const procurement = [
  ["Sr. No.", "Date", "PO/PI ID", "Brand / vendor Name", "SKU Name", "SKU Code", "Qty Raised", "Hub Location", "Procurement Owner", "PO / PI Raised (Y/N)", "Payement Terms", "Expected Dispatch Date", "GRN Status", "PO Status", "Received Date", "ETA", "Current ETA", "Revised ETA", "Delay Reason", "Priority (High/Medium/Low)", "Brand", "Unit price (inc GST)"],
  ["1", "20/10/2026", "PO-EPIK-26-27-0001", "Value One", "Dreame L50 Ultra", "ep-dr-l50u", "5", "HSR", "Anurag", "Yes", "CnC", "", "Partially Received", "", "", "", "", "30/11/2026", "", "High", "Dreame", "50,000.00"],
  ["2", "15/11/2026", "PO-EPIK-26-27-0002", "Arrowhead", "Apple iPhone 16", "ep-ap-i16", "3", "HSR", "Harish", "Yes", "CnC", "", "", "", "", "20/11/2026", "", "", "Commercials", "", "Apple", "60,000.00"],
  ["3", "01/07/2026", "PO-EPIK-26-27-0003", "Kent", "Kent Table Fan", "ep-old", "4", "HSR", "Piyush", "Yes", "SOR", "", "", "", "", "", "", "", "", "", "Kent", "3,000.00"],
];
const tracker = [
  ["EPIK  ·  Current Stock"], ["as of:  Closing Count of 26th November"], ["TOTAL"],
  ["Brand", "SKU Code", "Product Name", "SOR / CnC", "Units", "COGS / unit", "COGS"],
  ["Dreame", "ep-dr-l50u", "Dreame L50 Ultra", "Cash and Carry", "1", "50000", "50000"],
  ["Kent", "ep-old", "Kent Table Fan", "SOR", "2", "3000", "6000"],
];
const inwardSheet = [
  ["", "", "Brand & Supplier Details"],
  ["Inward id ", "Inward Date ", "PO/PI ID", "Invoice No.", "Brand Name ", "Vendor", " POC Contact", "Product Category", "Product Name ", "SKU", "Serial No.", "Quantity ", "Unit Cost", "Total Value(Inc. tax)", "Condition Recieved ", "Recieved By", "Remarks", "SOR/CnC", "Month", "Billed to", "Exclude from SMB CPU", "CN Value", "Credit Note Adjusted COGS"],
  ["INW-1", "01/11/2026", "PO-EPIK-26-27-0001", "INV1", "Dreame", "Value One", "", "Home Improvement", "Dreame L50 Ultra Robot Vacuum", "ep-dr-l50u", "SNO-0001", "1", "50000", "50000", "GOOD", "Anurag", "", "CnC", "11", "Curioso", "", "", "50000"],
  ["INW-2", "01/11/2026", "PO-EPIK-26-27-0001", "INV1", "Dreame", "Value One", "", "Home Improvement", "Dreame L50 Ultra Robot Vacuum", "ep-dr-l50u", "SNO-0002", "1", "50000", "50000", "BAD", "Anurag", "", "CnC", "11", "Curioso", "", "", "49000"],
];
const dispatch = [
  ["Dispatch tracker"],
  ["ID", "Shopify Order ID", "Invoice Date", "Customer Name", "PhoneNumber", "Address", "Product Serial #", "Product Name", "SKU CODE", "POC", "HUB", "Payment Status", "Offered Price", "Amount Paid", "Balance Pending", "COD to be collected?", "Expected Delivery Date", "Delivery Call Attempted?", "Order Status", "Delivery Status", "Delivery Date"],
  ["EP-DEL-1", "#PIK5001", "46350", "x", "y", "z", "SNO-0004", "Apple iPhone 16", "ep-ap-i16", "Simon H", "HQ", "Realized", "", "", "", "", "", "", "CONFIRMED", "EPIK_OFD", ""],
];
const catalog = [
  ["Brand", "Mapped Product Name", "SKU Codes", "Category", "SOR/CnC", "EOL", "Price per Unit (COGS)", "x", "Selling Price"],
  ["Kent", "Kent Table Fan", "ep-old", "Home Improvement", "SOR", "No", "3000", "", "4999"],
];

const src = (): Sources => ({
  units: readUnits(masterbase), inwards: readInwards(inwardSheet), dispatches: readDispatches(dispatch),
  lines: readPoLines(procurement), tracker: readTrackerStock(tracker), catalog: readCatalog(catalog),
});
const TODAY = "2026-11-26";

test("dates from the sheets are day first; Dispatch Tracker day numbers too", () => {
  assert.equal(sheetDay("01/11/2026"), "2026-11-01");
  assert.equal(sheetDay("46326"), null);
  assert.equal(readDispatches(dispatch)[0].on, "2026-11-24", "46350 is 24 Nov 2026");
});

test("readers pick the important columns by heading", () => {
  const w = readInwards(inwardSheet);
  assert.equal(w.length, 2);
  assert.equal(w[1].cost, 49000, "credit-note adjusted cost wins");
  assert.equal(w[0].billedTo, "Curioso");
  assert.equal(readDispatches(dispatch)[0].status, "EPIK_OFD");
  assert.equal(readCatalog(catalog)[0].listPrice, 4999);
});

test("categories come from the name first, then the sheet; an admin's choice wins", () => {
  assert.equal(categorise("Dreame L50 Ultra Robot Vacuum", ["Home Improvement"]).category, "Robot vacuums");
  assert.equal(categorise("Ecovacs X1 dust bag", []).category, "Accessories");
  assert.equal(categorise("iPhone 18 Pro Silicone Case with MagSafe", []).category, "Accessories");
  assert.equal(categorise("Apple iPhone 16 (128 GB)", []).category, "Phones");
  assert.equal(categorise("Ninja Foodi Dual Zone Air Fryer", []).category, "Kitchen");
  assert.equal(categorise("Winston Hair Straightening Brush", []).category, "Personal care");
  assert.equal(categorise("Mystery gadget", ["Kitchen appliance"]).category, "Kitchen");
  assert.deepEqual(categorise("Mystery gadget", [], "Phones"), { category: "Phones", source: "admin" });
});

test("stock comes from the Masterbase serials; missing costs are filled from the Tracker", () => {
  const s = buildSnapshot(src(), TODAY);
  assert.equal(s.kpis.unitsInStock, 4);
  assert.equal(s.kpis.costFilled, 1, "SNO-0007 had no cost");
  assert.equal(s.kpis.stockValue, 106_000);
  assert.equal(s.finance.sorValue, 6000);
  assert.equal(s.finance.cncValue, 100_000);
  assert.equal(s.ageing.find((a) => a.label === OPENING_BAND)!.units, 1);
  assert.equal(s.products.find((p) => p.sku === "ep-dr-l50u")!.brand, "Dreame", "DREAME and Dreame are one brand");
  assert.equal(s.products.find((p) => p.sku === "ep-old")!.category, "Air purifiers & fans");
  assert.equal(fillCosts(readUnits(masterbase), [], readTrackerStock(tracker)).filled, 1);
});

test("coming = PO lines not received, less units already received on the same PO and SKU", () => {
  const s = buildSnapshot(src(), TODAY);
  const l50 = s.incoming.find((l) => l.sku === "ep-dr-l50u")!;
  assert.equal(l50.received, 3);
  assert.equal(l50.pending, 2);
  assert.equal(s.incoming.find((l) => l.sku === "ep-ap-i16")!.state, "overdue");
  assert.equal(s.incoming.find((l) => l.po === "PO-EPIK-26-27-0003")!.state, "stale");
  assert.equal(s.kpis.incomingUnits, 5, "stale lines are not counted as coming");
});

test("flows use the chosen period and compare with the one before", () => {
  const s = buildSnapshot(src(), TODAY, { range: { from: "2026-11-20", to: TODAY, label: "7 days" } });
  assert.equal(s.kpis.outUnits, 3);
  assert.equal(s.kpis.outValue, 170_000);
  assert.equal(s.kpis.inUnits, 0);
  const month = buildSnapshot(src(), TODAY);
  assert.equal(month.kpis.inUnits, 2, "two Inward Sheet units on 1 Nov");
  assert.equal(month.kpis.inValue, 99_000);
  const nov = month.finance.months.find((m) => m.month === "2026-11")!;
  assert.equal(nov.dispatchedCost, 170_000);
  assert.equal(nov.receivedCost, 99_000);
  assert.ok(month.history.length === 90 && month.history[89].units === 4);
});

test("a bill added in the IMS raises stock once; the sheet having it too doesn't count twice", () => {
  const receipt: Receipt = {
    id: "IMS-IN-00001", at: "2026-11-26T10:00:00Z", by: "Editor", vendor: "Arrowhead", invoice: "INV77", invoiceDate: "2026-11-26", po: null, billedTo: "Curioso", terms: "Cash and Carry",
    lines: [
      { sku: "ep-ap-i16", name: "Apple iPhone 16 (128 GB)", qty: 2, unitCost: 61000, serials: ["NEW-1", "SNO-0001"], condition: "Good" },
      { sku: "ep-dr-l50u", name: "Dreame L50 Ultra", qty: 1, unitCost: 50000, serials: [], condition: "Good" },
    ],
    billPath: null, billName: null, note: null, voided: false,
  };
  const s = buildSnapshot(src(), TODAY, { app: { receipts: [receipt], statuses: [], ready: true } });
  assert.equal(s.kpis.unitsInStock, 6, "NEW-1 + one unserialised L50; SNO-0001 is already in the Masterbase");
  assert.equal(s.kpis.appUnits, 2);
  assert.equal(s.inwards.filter((w) => w.source === "app").length, 2);
  const voided = buildSnapshot(src(), TODAY, { app: { receipts: [{ ...receipt, voided: true }], statuses: [], ready: true } });
  assert.equal(voided.kpis.unitsInStock, 4);
  assert.deepEqual(receiptProblems({ vendor: "", invoice: "1", lines: [{ ...receipt.lines[0], serials: ["A", "A", "B"] }] }), ["Add the vendor.", "Line 1: more serials (3) than units (2).", "Line 1: serial A is there twice."]);
});

test("status updates from editors: the latest wins, on PO lines and dispatches", () => {
  const statuses = [
    { at: "2026-11-25T10:00:00Z", by: "E", kind: "po" as const, ref: poRef("PO-EPIK-26-27-0002", "ep-ap-i16"), status: "Delayed", eta: "2026-12-02", note: null },
    { at: "2026-11-26T09:00:00Z", by: "E", kind: "dispatch" as const, ref: "SNO-0004", status: "Delivered", eta: null, note: null },
  ];
  const s = buildSnapshot(src(), TODAY, { app: { receipts: [], statuses, ready: true } });
  const iphone = s.incoming.find((l) => l.sku === "ep-ap-i16")!;
  assert.equal(iphone.appStatus, "Delayed");
  assert.equal(iphone.eta, "2026-12-02");
  assert.equal(iphone.state, "this_week");
  assert.equal(s.dispatches[0].appStatus, "Delivered");
  const gone = buildSnapshot(src(), TODAY, { app: { receipts: [], statuses: [{ ...statuses[0], status: "Not coming", at: "2026-11-26T11:00:00Z" }, statuses[0]].reverse(), ready: true } });
  assert.ok(!gone.incoming.some((l) => l.sku === "ep-ap-i16"), "Not coming leaves Incoming");
});

test("matching a bill line to a product, and search", () => {
  const products = [{ sku: "ep-dr-l50u", name: "Dreame L50 Ultra Robot Vacuum" }, { sku: "ep-dr-l40", name: "Dreame L40 Robot Vacuum" }];
  assert.equal(matchProducts("DREAME L50 ULTRA ROBOT VAC CE", products)[0].sku, "ep-dr-l50u");
  const s = buildSnapshot(src(), TODAY);
  assert.deepEqual(findProducts(s, "l50 dreame").map((p) => p.sku), ["ep-dr-l50u"]);
  assert.equal(findUnits(s, "0004")[0].poc, "Simon H");
  assert.ok(productsInView(s, "dead").some((p) => p.sku === "ep-old"), "the fan hasn't sold in 90 days");
  assert.ok(s.checks.some((c) => c.id === "gap"), "Tracker says 1 L50, Masterbase 2: on the admin page only");
  assert.ok(!s.attention.some((a) => /Tracker/i.test(a.title)), "never on the dashboard");
});

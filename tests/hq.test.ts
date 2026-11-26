import assert from "node:assert/strict";
import test from "node:test";
import { monthOfTab, readAdTab } from "../src/features/hq/domain/meta";
import { buildDashboard, ranges } from "../src/features/hq/domain/metrics";
import { num, readSales, sheetDay } from "../src/features/hq/domain/smb";

// The Sales Tracker shape: row 1 = the sheet's totals, row 2 = headings, then one row per product.
const H = ["Shopify Order ID", "Invoice Date", "Month", "Customer Name", "Phone Number", "CX Type", "Brand", "Product Name", "SKU CODE", "Category", "POC", "HUB", "Sale Source", "Sale Type", "Undiscounted GMV (Epik's)", "Link Price", "Payment Status", "Amount Paid", "Balance Pending", "Logistic Status", "Delivery Status", "Dipatch Date", "Delivery date", "NMV Excl Tax", "GMV(RSP) Value\nPre Disc", "GMV After Tax Pre Disc", "Discount", "NMV Value (Inc GST)", "NMV Value (Excl GST)", "COGS Excl GST", "Net Margin Value"];
const row = (o: Record<string, string>) => H.map((h) => o[h] ?? "");
const sheet = [
  row({ "Undiscounted GMV (Epik's)": "3,43,500.00" }),
  H,
  row({ "Shopify Order ID": "#PIK5001", "Invoice Date": "01/11/2026", "Customer Name": "Asha", "Phone Number": "9845011111", "CX Type": "New", "Brand": "Dreame", "Product Name": "Dreame L50 Ultra", "Category": "Robo Vaccum", "POC": "Baljeet Singh", "HUB": "HQ", "Sale Source": "Demo", "Undiscounted GMV (Epik's)": "89,900", "Link Price": "79,900", "Payment Status": "Realized", "Amount Paid": "79,900", "Logistic Status": "EPIK_DELIVERED", "Delivery date": "04/11/2026", "GMV(RSP) Value\nPre Disc": "89,900", "GMV After Tax Pre Disc": "76,186", "NMV Value (Inc GST)": "79,900", "NMV Value (Excl GST)": "67,712", "COGS Excl GST": "56,960", "Net Margin Value": "" }),
  row({ "Shopify Order ID": "#PIK5002", "Invoice Date": "02/11/2026", "Customer Name": "Ravi", "Phone Number": "9845022222", "CX Type": "Repeat", "Brand": "Apple", "Product Name": "iPhone 16", "Category": "Phones", "POC": "Shopify direct", "HUB": "HQ", "Sale Source": "Direct Order", "Undiscounted GMV (Epik's)": "79,900", "Link Price": "69,900", "Payment Status": "Advance Payment", "Amount Paid": "0", "Balance Pending": "69,900", "Logistic Status": "EPIK_INTRANSIT_CX", "GMV(RSP) Value\nPre Disc": "79,900", "GMV After Tax Pre Disc": "67,712", "NMV Value (Inc GST)": "69,900", "NMV Value (Excl GST)": "59,237", "COGS Excl GST": "56,960", "Net Margin Value": "2,277" }),
  row({ "Shopify Order ID": "#PIK5003", "Invoice Date": "03/11/2026", "Customer Name": "Meena", "Phone Number": "9845033333", "CX Type": "New", "Brand": "Apple", "Product Name": "iPhone 16", "Category": "Phones", "POC": "Simon H", "HUB": "Hebbal", "Sale Source": "Virtual Demo", "Undiscounted GMV (Epik's)": "89,900", "Link Price": "97,900", "Payment Status": "Refunded", "Amount Paid": "97,900", "Logistic Status": "CX_CANCELLED", "Delivery Status": "Cancelled", "GMV(RSP) Value\nPre Disc": "89,900", "GMV After Tax Pre Disc": "76,186", "NMV Value (Inc GST)": "97,900" }),
  row({ "Shopify Order ID": "#PIK5004", "Invoice Date": "04/11/2026", "Phone Number": "9845044444", "CX Type": "New", "Category": "Phones", "POC": "Simon H", "Undiscounted GMV (Epik's)": "50,000", "Link Price": "50,000", "Logistic Status": "NOT CONFIRMED", "NMV Excl Tax": "42,373" }),
  row({ "Shopify Order ID": "#PIK5005", "Invoice Date": "26/11/2026", "Phone Number": "9845055555", "CX Type": "New", "Category": "Kitchen", "POC": "Baljeet Singh", "Undiscounted GMV (Epik's)": "22,000", "Link Price": "20,000" }),
  row({ "Shopify Order ID": "#PIK5006", "Invoice Date": "20/11/2026", "Phone Number": "9845066666", "CX Type": "Repeat", "Category": "Kitchen", "POC": "Simon H", "Undiscounted GMV (Epik's)": "11,800", "Link Price": "11,800", "Logistic Status": "CONFIRMED", "GMV(RSP) Value\nPre Disc": "11,800", "NMV Value (Inc GST)": "11,800", "NMV Value (Excl GST)": "10,000", "COGS Excl GST": "Update data", "Net Margin Value": "Update Data" }),
];
const adTab = [
  ["November 2026 - Meta"], ["note"], ["SPEND"],
  ["Date", "Spend (Home)", "Spend (AF)", "Spend (AP)", "Spend (Kitchen)", "Total Spend", "Home Demos (Home)", "Home Demos (AF)", "Home Demos (AP)", "Home Demos (Kitchen)", "Video Demos (Home)", "Video Demos (AF)", "Video Demos (AP)", "Video Demos (Kitchen)", "Total Demos", "Home Demo CPA (Home)"],
  ["MTD Total", "₹30,000.00", "₹0", "-", "-", "₹30,000.00", "4", "0", "0", "0", "6", "0", "0", "0", "10", "-"],
  ["01-Nov-2026", "₹10,000.00", "-", "-", "-", "₹10,000.00", "2", "0", "0", "0", "3", "0", "0", "0", "5", "-"],
  ["02-Nov-2026", "₹20,000.00", "-", "-", "-", "₹20,000.00", "2", "0", "0", "0", "3", "0", "0", "0", "5", "-"],
  ["03-Nov-2026", "", "", "", "", "-", "", "", "", "", "", "", "", "", "0", ""],
];

test("numbers and dates the way the sheets write them", () => {
  assert.equal(num("₹1,23,456.78"), 123456.78);
  assert.ok(Number.isNaN(num("-")));
  assert.equal(sheetDay("01-Nov-2026"), "2026-11-01");
  assert.equal(sheetDay("1-Oct-2026"), "2026-10-01");
  assert.equal(monthOfTab("Nov 2026 Tracker"), "2026-11");
  assert.equal(monthOfTab("October 2026"), "2026-10");
});

test("the Sales Tracker: headings by name, row 1 kept as the sheet's own totals", () => {
  const r = readSales(sheet);
  assert.equal(r.lines.length, 6);
  assert.equal(r.totals.undiscountedGmv, 343500);
  assert.equal(r.lines[0].gmvIncl, 89900, "GMV(RSP) Value Pre Disc is the GST-inclusive GMV");
  assert.equal(r.lines[3].nmvExcl, 0, "NMV Excl Tax is not NMV Value (Excl GST)");
  assert.equal(r.lines[4].financeDone, false);
  assert.equal(r.lines[5].cogsKnown, false, "\"Update data\" is not a cost");
  assert.equal(r.lines[0].cxType, "New");
  assert.equal(r.lines[1].netMargin, 2277);
  assert.equal(r.lines[0].netMargin, null, "blank Net Margin: computed instead");
});

test("the Meta tracker: spend, demos, and its own total", () => {
  const r = readAdTab(adTab);
  assert.equal(r.days.length, 2, "empty days are skipped");
  assert.equal(r.sheetTotalSpend, 30000);
  assert.deepEqual(r.days[0].spend, { home: 10000, af: 0, ap: 0, kitchen: 0 });
  assert.equal(r.days[1].totalDemos, 5);
});

test("investor numbers: cancelled and not confirmed left out, NM only where finance has a cost, CAC and ROAS from Meta", () => {
  const r = readSales(sheet);
  const d = buildDashboard(r.lines, r.totals, readAdTab(adTab).days, "2026-11-27", "mtd");
  const n = d.now;
  assert.equal(n.orders, 4);
  assert.equal(n.ordersBooked, 6);
  assert.equal(n.cancelledOrders, 1);
  assert.equal(n.notConfirmedOrders, 1);
  assert.equal(n.nmv, 79900 + 69900 + 20000 + 11800, "#PIK5005 not in finance yet: its link price");
  assert.equal(n.gmv, 89900 + 79900 + 22000 + 11800);
  assert.equal(n.discount, 22000);
  assert.ok(Math.abs(n.nmvExcl - (67712 + 59237 + 20000 / 1.18 + 10000)) < 1e-6);
  assert.equal(n.nm, (67712 - 56960) + 2277, "computed for #PIK5001, the sheet's own for #PIK5002");
  assert.equal(n.cogs, 56960 * 2);
  assert.ok(Math.abs((n.nmPct ?? 0) - 13029 / (67712 + 59237)) < 1e-9, "NM% over the rows with a cost");
  assert.equal(n.awaitingCostOrders, 2);
  assert.equal(n.awaitingCostNmv, 31800);
  assert.equal(n.spend, 30000);
  assert.equal(n.newCustomers, 2);
  assert.equal(n.cac, 15000);
  assert.ok(Math.abs((n.roas ?? 0) - 181600 / 30000) < 1e-9);
  assert.equal(n.nmAfterAds, 13029 - 30000);
  assert.equal(n.demos, 10);
  assert.equal(n.demoSales, 1, "the cancelled virtual demo doesn't count");
  assert.equal(d.byCde.map((c) => c.key).join(), "Baljeet Singh,Simon H", "website orders are not a CDE; not confirmed orders don't count");
  assert.equal(d.delivery.statuses.find((s) => s.label === "Delivered")?.orders, 1);
  assert.equal(d.delivery.avgDays, 3);
});

test("cross-check against the sheet's own totals", () => {
  const r = readSales(sheet);
  const d = buildDashboard(r.lines, r.totals, [], "2026-11-27");
  const gmv = d.checks.find((c) => c.label === "Undiscounted GMV")!;
  assert.equal(gmv.ok, true);
  const broken = buildDashboard(r.lines, { ...r.totals, undiscountedGmv: 1 }, [], "2026-11-27");
  assert.equal(broken.checks.find((c) => c.label === "Undiscounted GMV")!.ok, false);
});

test("periods start no earlier than 1 Nov 2026", () => {
  const rs = ranges("2026-11-27");
  assert.equal(rs.find((x) => x.id === "30d")!.from, "2026-11-01");
  assert.ok(!rs.some((x) => x.id === "lm"), "no last month before November");
  assert.equal(ranges("2026-12-05").find((x) => x.id === "lm")!.from, "2026-11-01");
});

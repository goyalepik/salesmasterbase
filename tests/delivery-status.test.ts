import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryOpsStore } from "../src/lib/ops/memory-store";
import { createOrder, decideLine, recordPayment, savePerson, setDeliveryStatus } from "../src/lib/ops/service";
import { deliveryStatusOf, statusFromIso } from "../src/lib/ops/delivery-status";
import type { NewOrderInput } from "../src/lib/ops/types";
import { cellValue, columnLetter, findHeaderRow, layoutFor } from "../src/lib/sheets/sales-sheet-map";
import { typed, writeOrdersToSheet, type SheetsClient } from "../src/lib/sheets/sales-sheet";
import { boardOrders, matchesSearch, recentEnough } from "../src/lib/ops-ui/delivery-board";
import { publicStatusToken, publicTokenMatches } from "../src/lib/public-status";
import { accessGate } from "../src/lib/access";

const desk = { name: "Desk", slackUserId: null };

function store() {
  return new MemoryOpsStore({
    products: [{ sku: "ep-dr-x50", name: "Dreame X50 Ultra", brand: "Dreame", category: "Robot Vacuum", channel: "CnC", listPriceMinor: 6_990_000, gstRate: 0.18, hsn: null, eol: false, needsInstallation: true }],
    movements: [{ sku: "ep-dr-x50", qty: 1, kind: "opening", refType: null, refId: null, serialNo: null, unitCostMinor: 5_000_000, note: null, actor: "import", createdAt: "2026-10-01T00:00:00Z" }],
    purchaseOrders: [],
  });
}

function sale(extra: Partial<NewOrderInput> = {}): NewOrderInput {
  return {
    source: "slack",
    customerName: "Ravi Kumar",
    phone: "9845012345",
    hub: "HSR HQ",
    poc: "Nabarun",
    shippingAddress: "12 MG Road, Bengaluru",
    pincode: "560001",
    declaredPaymentStatus: "Full paid, ₹65,000 received",
    lines: [{ sku: "ep-dr-x50", productName: "x", listPriceMinor: null, offeredPriceMinor: 6_500_000 }],
    ...extra,
  };
}

// ── Status rules ─────────────────────────────────────────────────────────────

test("logistics moves a new sale straight through, without RevOps and without touching stock", async () => {
  const s = store();
  const created = await createOrder(s, sale(), desk);
  assert.ok(created.ok);
  const id = created.value.id;
  assert.equal(deliveryStatusOf(created.value.stage), "new", "Payment review reads New sale");

  const before = await s.stockFor("ep-dr-x50");
  const ready = await setDeliveryStatus(s, id, { status: "ready", note: null, expectedDate: "2026-11-16", driver: null }, desk);
  assert.ok(ready.ok);
  assert.equal(ready.value.stage, "ready_to_dispatch");
  assert.equal(ready.value.expectedDeliveryDate, "2026-11-16");

  const out = await setDeliveryStatus(s, id, { status: "out_for_delivery", note: null, expectedDate: null, driver: "Manju" }, desk);
  assert.ok(out.ok);
  assert.equal(out.value.stage, "out_for_delivery");
  assert.equal(out.value.driver, "Manju");
  assert.ok(out.value.dispatchedAt);

  const delivered = await setDeliveryStatus(s, id, { status: "delivered", note: null, expectedDate: null, driver: null }, desk);
  assert.ok(delivered.ok);
  assert.equal(delivered.value.stage, "delivered");
  assert.ok(delivered.value.deliveredAt);
  assert.deepEqual(await s.stockFor("ep-dr-x50"), before, "stock ledger untouched (stock lives in the sheets)");
  assert.ok(delivered.value.events.some((e) => e.type === "status" && /Delivered \(was Out for delivery\)/.test(e.summary)));
});

test("a wrong tap can be corrected, and going back clears the delivered date", async () => {
  const s = store();
  const { value } = (await createOrder(s, sale(), desk)) as { value: { id: string } };
  await setDeliveryStatus(s, value.id, { status: "delivered", note: null, expectedDate: null, driver: null }, desk);
  const back = await setDeliveryStatus(s, value.id, { status: "out_for_delivery", note: "Tapped too early", expectedDate: null, driver: null }, desk);
  assert.ok(back.ok);
  assert.equal(back.value.stage, "out_for_delivery");
  assert.equal(back.value.deliveredAt, null);
});

test("On hold and Cancelled need a note; Cancelled is final", async () => {
  const s = store();
  const { value } = (await createOrder(s, sale(), desk)) as { value: { id: string } };
  const noNote = await setDeliveryStatus(s, value.id, { status: "on_hold", note: null, expectedDate: null, driver: null }, desk);
  assert.equal(noNote.ok, false);
  const hold = await setDeliveryStatus(s, value.id, { status: "on_hold", note: "Customer travelling", expectedDate: null, driver: null }, desk);
  assert.ok(hold.ok);
  assert.equal(hold.value.holdReason, "Customer travelling");
  const moved = await setDeliveryStatus(s, value.id, { status: "waiting_stock", note: null, expectedDate: null, driver: null }, desk);
  assert.ok(moved.ok);
  assert.equal(moved.value.holdReason, null, "hold reason cleared when it moves on");
  const cancelled = await setDeliveryStatus(s, value.id, { status: "cancelled", note: "Customer changed mind", expectedDate: null, driver: null }, desk);
  assert.ok(cancelled.ok);
  assert.equal(cancelled.value.stage, "cancelled");
  assert.ok(cancelled.value.lines.every((l) => l.status === "cancelled"));
  const reopen = await setDeliveryStatus(s, value.id, { status: "new", note: null, expectedDate: null, driver: null }, desk);
  assert.equal(reopen.ok, false);
});

test("orders with stock booked in the app keep the full Dispatch buttons", async () => {
  const s = store();
  const { value } = (await createOrder(s, sale(), desk)) as { value: { id: string; lines: Array<{ id: string }> } };
  await recordPayment(s, value.id, { amountMinor: 6_500_000, mode: "UPI", kind: "full", reference: null, clear: true }, desk);
  await decideLine(s, value.lines[0].id, { type: "reserve" }, desk);
  const refused = await setDeliveryStatus(s, value.id, { status: "delivered", note: null, expectedDate: null, driver: null }, desk);
  assert.equal(refused.ok, false);
});

test("only logistics (or admin) can set the status once roles are set up", async () => {
  const s = store();
  const { value } = (await createOrder(s, sale(), desk)) as { value: { id: string } };
  await savePerson(s, { slackUserId: "U1", name: "Seller", roles: ["sales"], hub: null });
  await savePerson(s, { slackUserId: "U2", name: "Logi", roles: ["logistics"], hub: null });
  const seller = await setDeliveryStatus(s, value.id, { status: "ready", note: null, expectedDate: null, driver: null }, { name: "Seller", slackUserId: "U1" });
  assert.equal(seller.ok, false);
  const logi = await setDeliveryStatus(s, value.id, { status: "ready", note: null, expectedDate: null, driver: null }, { name: "Logi", slackUserId: "U2" });
  assert.ok(logi.ok);
});

test("nothing changed is refused, so history stays clean", async () => {
  const s = store();
  const { value } = (await createOrder(s, sale(), desk)) as { value: { id: string } };
  const same = await setDeliveryStatus(s, value.id, { status: "new", note: null, expectedDate: null, driver: null }, desk);
  assert.equal(same.ok, false);
});

// ── Sales sheet ──────────────────────────────────────────────────────────────

/** The real SMB sheet (SMB Pilot Version 1411): a note on row 1, headings on row 2, no Status or EPIK order column. */
const SMB = [
  "Shopify Order ID", "Invoice Date", "Month", "Customer Name", "Phone Number", "CX Type", "Brand", "Product Name", "SKU CODE", "Category",
  "POC", "HUB", "Sale Source", "Sale Type", "CD Incentive Math", "Undiscounted GMV \n(Epik's)", "Offer Price", "Discount (%)", "Payment Status",
  "Amount Paid", "Mobile Exchange Amt", "Balance Pending", "Expected Delivery Date", "Delivery Address", "Delivery City Cohort", "Billing Address", "GST Number",
];
const col = (name: string) => SMB.indexOf(name);

/** A sheet in memory, behaving like Google Sheets for the calls the writer makes. */
function fakeSheet(rows: string[][]) {
  const grid: string[][] = rows.map((r) => [...r]);
  const colIndex = (letters: string) => letters.split("").reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  const strip = (v: string) => (v.startsWith("'") ? v.slice(1) : v);
  const client: SheetsClient = {
    async batchGet(ranges) {
      return ranges.map((range) => {
        const r = range.split("!")[1];
        const top = /^1:(\d+)$/.exec(r);
        if (top) return grid.slice(0, Number(top[1])).map((row) => [...row]);
        const c = /^([A-Z]+):\1$/.exec(r);
        if (c) return grid.map((row) => [row[colIndex(c[1])] ?? ""]);
        const m = /^A(\d+):([A-Z]+)\1$/.exec(r)!;
        return [grid[Number(m[1]) - 1] ?? []];
      });
    },
    async batchUpdate(data) {
      for (const { range, values } of data) {
        const m = /!([A-Z]+)(\d+)$/.exec(range)!;
        const row = Number(m[2]) - 1;
        grid[row] = grid[row] ?? [];
        grid[row][colIndex(m[1])] = strip(values[0][0]);
      }
    },
    async append(_range, newRows) {
      for (const row of newRows) grid.push(row.map(strip));
    },
  };
  return { client, grid };
}

const smbSheet = () => fakeSheet([["", "", "", "", "", "", "", "", "Get mapping from Krish"], SMB]);

test("the SMB sheet: headings found on row 2, every known column matched, team columns left alone", () => {
  assert.equal(findHeaderRow([["", "Get mapping from Krish"], SMB]), 1);
  const layout = layoutFor(SMB);
  const fields = Object.fromEntries(layout.columns.map((c) => [c.header, c.field]));
  assert.equal(fields["Shopify Order ID"], "shopify");
  assert.equal(fields["Invoice Date"], "date");
  assert.equal(fields["Undiscounted GMV (Epik's)"], "listPrice");
  assert.equal(fields["Offer Price"], "offeredPrice");
  assert.equal(fields["Discount (%)"], "discount");
  assert.equal(fields["Balance Pending"], "balance");
  assert.equal(fields["GST Number"], "gst");
  assert.deepEqual(layout.unknown, ["CD Incentive Math", "Mobile Exchange Amt", "Delivery City Cohort"]);
  assert.equal(columnLetter(26), "AA");
});

test("a sale lands in the SMB sheet: Status and EPIK order columns added, one row per product, money once", async () => {
  const s = store();
  const created = await createOrder(
    s,
    sale({ shopifyOrderId: "#PIK5402", lines: [
      { sku: "ep-dr-x50", productName: "x", listPriceMinor: null, offeredPriceMinor: 6_500_000 },
      { sku: null, productName: "Mop pads", listPriceMinor: 200_000, offeredPriceMinor: 150_000 },
    ] }),
    desk,
  );
  assert.ok(created.ok);
  const id = created.value.id;
  const sheet = smbSheet();
  const first = await writeOrdersToSheet(s, sheet.client, "Sheet1", [(await s.getOrder(id))!]);
  assert.equal(first.headerRow, 2);
  assert.deepEqual(first.addedColumns, ["Status", "EPIK order"]);
  assert.equal(sheet.grid[1][27], "Status");
  assert.equal(sheet.grid[1][28], "EPIK order");
  assert.equal(first.added, 2);
  const [a, b] = [sheet.grid[2], sheet.grid[3]];
  assert.equal(a[col("Shopify Order ID")], "#PIK5402");
  assert.equal(a[col("Customer Name")], "Ravi Kumar");
  assert.equal(a[col("Phone Number")], "9845012345");
  assert.equal(a[col("Brand")], "Dreame");
  assert.equal(a[col("Category")], "Robot Vacuum");
  assert.equal(a[col("Product Name")], "Dreame X50 Ultra");
  assert.equal(a[col("Undiscounted GMV \n(Epik's)")], "69900");
  assert.equal(a[col("Offer Price")], "65000");
  assert.equal(a[col("Discount (%)")], "7");
  assert.equal(a[col("Payment Status")], "Full paid");
  assert.equal(a[col("Amount Paid")], "65000", "the ₹65,000 the CDE said was received");
  assert.equal(a[col("Balance Pending")], "1500");
  assert.equal(a[27], "New sale");
  assert.equal(a[28], `${id}/1`);
  assert.equal(b[col("Product Name")], "Mop pads");
  assert.equal(b[col("Offer Price")], "1500");
  assert.equal(b[col("Amount Paid")], "", "order money only on the first row");
  assert.equal(b[28], `${id}/2`);
  assert.equal(sheet.grid[0][8], "Get mapping from Krish", "row 1 note untouched");
});

test("status changes follow; hand fixes and team columns are kept; no second row", async () => {
  const s = store();
  const { value } = (await createOrder(s, sale(), desk)) as { value: { id: string } };
  const sheet = smbSheet();
  await writeOrdersToSheet(s, sheet.client, "Sheet1", [(await s.getOrder(value.id))!]);
  sheet.grid[2][col("CD Incentive Math")] = "1200";
  sheet.grid[2][col("Customer Name")] = "Ravi K (fixed)";
  await setDeliveryStatus(s, value.id, { status: "out_for_delivery", note: null, expectedDate: "2026-11-15", driver: "Manju" }, desk);
  const second = await writeOrdersToSheet(s, sheet.client, "Sheet1", [(await s.getOrder(value.id))!]);
  assert.equal(second.added, 0);
  assert.deepEqual(second.addedColumns, []);
  assert.equal(sheet.grid.length, 3);
  assert.equal(sheet.grid[2][27], "Out for delivery");
  assert.equal(sheet.grid[2][col("Expected Delivery Date")], "15 Nov 2026");
  assert.equal(sheet.grid[2][col("CD Incentive Math")], "1200");
  assert.equal(sheet.grid[2][col("Customer Name")], "Ravi K (fixed)");
});

test("two writes at the same moment still make one row", async () => {
  const s = store();
  const { value } = (await createOrder(s, sale(), desk)) as { value: { id: string } };
  const sheet = fakeSheet([["EPIK order", "Customer", "Status"]]);
  const order = (await s.getOrder(value.id))!;
  await Promise.all([writeOrdersToSheet(s, sheet.client, "Sales", [order]), writeOrdersToSheet(s, sheet.client, "Sales", [order])]);
  assert.equal(sheet.grid.filter((r) => r[0] === `${value.id}/1`).length, 1);
});

test("free text never runs as a sheet formula, and phone numbers stay text", () => {
  assert.equal(typed("notes", "=IMPORTXML(1)"), "'=IMPORTXML(1)");
  assert.equal(typed("phone", "9845012345"), "'9845012345");
  assert.equal(typed("total", "65000"), "65000");
});

test("status goes to the sheet with its reason; part payments show the balance", async () => {
  const s = store();
  const { value } = (await createOrder(s, sale({ declaredPaymentStatus: "Partial, ₹20,000 received" }), desk)) as { value: { id: string } };
  await setDeliveryStatus(s, value.id, { status: "on_hold", note: "Address unclear", expectedDate: null, driver: null }, desk);
  const order = (await s.getOrder(value.id))!;
  const ctx = { line: order.lines[0], first: true, perLine: false };
  assert.equal(cellValue(order, { field: "status", line: 1 }, ctx), "On hold: Address unclear");
  assert.equal(cellValue(order, { field: "amountPaid", line: 1 }, ctx), "20000");
  assert.equal(cellValue(order, { field: "balance", line: 1 }, ctx), "45000");
  assert.equal(cellValue(order, { field: "paymentStatus", line: 1 }, ctx), "Partial");
});

// ── Salespeople's page ───────────────────────────────────────────────────────

test("the status page link is long and random, and the proxy lets only that shape through", () => {
  const env = { APP_MODE: "live", DASHBOARD_ACCESS_CODE: "a-long-access-code" };
  const token = publicStatusToken(env)!;
  assert.ok(token.length >= 16);
  assert.ok(publicTokenMatches(token, env));
  assert.equal(publicTokenMatches("guess-guess-guess", env), false);
  assert.equal(publicStatusToken({ ...env, PUBLIC_STATUS_TOKEN: "my-new-link-after-a-leak-123" }), "my-new-link-after-a-leak-123");
  assert.equal(publicStatusToken({ APP_MODE: "live" }), null, "no access code on the live site: no link");
  const gate = (pathname: string) => accessGate({ mode: "live", pathname, accessCode: env.DASHBOARD_ACCESS_CODE, cookie: undefined });
  assert.equal(gate(`/status/${token}`), "allow");
  assert.equal(gate("/orders"), "challenge");
  assert.equal(gate("/status/x/../orders"), "challenge");
});

test("salespeople find an order by phone digits or #PIK; old and TEST orders stay off", async () => {
  const s = store();
  await createOrder(s, sale({ shopifyOrderId: "#PIK5402" }), desk);
  await createOrder(s, sale({ customerName: "TEST Bhavya" }), desk);
  await createOrder(s, sale({ createdAt: "2026-01-01T00:00:00Z", customerName: "Old Sale" }), desk);
  const { items } = await s.listOrders({ stage: "all", limit: 100 });
  const from = statusFromIso({ ORDER_STATUS_FROM: "2026-11-01" });
  const board = boardOrders(items, from);
  assert.deepEqual(board.map((o) => o.customerName), ["Ravi Kumar"]);
  assert.ok(matchesSearch(board[0], "2345"));
  assert.ok(matchesSearch(board[0], "pik5402"));
  assert.ok(matchesSearch(board[0], "#PIK5402"));
  assert.equal(matchesSearch(board[0], "Samsung"), false);
  assert.ok(recentEnough(board[0], new Date()));
});

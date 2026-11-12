import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryOpsStore } from "../src/lib/ops/memory-store";
import { addInventoryNote, applySheetRows, clearForFulfilment, createOrder, decideLine, outForDelivery, setInventoryNoteDone, type SheetRowInput } from "../src/lib/ops/service";
import { groupStock, stockCategory } from "../src/lib/ops/stock-category";
import type { StockLevel } from "../src/lib/ops/types";
import { liveStockRows } from "../src/lib/sheets/live-stock";
import { parseCsv, readPullMark, readSheet, sheetDate, sheetSyncConfigFromEnv, stockCheck } from "../src/lib/sheets/sheet-sync";

function level(sku: string, name: string, onHand: number, patch: Partial<StockLevel> = {}): StockLevel {
  return { sku, name, brand: "Brand", category: null, channel: null, onHand, reserved: 0, available: onHand, incoming: 0, nextEta: null, unitCostMinor: 100_00, ...patch };
}

test("categories come from the product name", () => {
  assert.equal(stockCategory({ name: "Apple iPhone 16 (128 GB) - Teal", category: null }), "Phones");
  assert.equal(stockCategory({ name: "ECOVACS DEEBOT N30 Plus White 2-in-1 Robot Vacuum & Mop", category: null }), "Robot vacuums");
  assert.equal(stockCategory({ name: "ECOVACS DEEBOT T80 PRO OMNI Accessory Kit", category: null }), "Accessories & spares");
  assert.equal(stockCategory({ name: "Neesh Perfumes Shafran (50 ml)", category: null }), "Perfume");
  assert.equal(stockCategory({ name: "CP Plus 4MP Dual Light Dome Camera", category: null }), "Smart home & security");
  assert.equal(stockCategory({ name: "Something new", category: "Air Fryers & Ovens" }), "Kitchen appliances");
  assert.equal(stockCategory({ name: "Pet feeder", category: null }), "Other");
  assert.equal(stockCategory({ name: "AGARO ICON 1600 Watts Bagless Dry Vacuum Cleaner for Home & Office, with 6 Accessories", category: null }), "Vacuums & floor care");
  assert.equal(stockCategory({ name: "Ecovacs x1 accessories kit", category: null }), "Accessories & spares");
});

test("stock groups: by category or brand, empty products left out", () => {
  const levels = [
    level("a", "Apple iPhone 16", 3, { brand: "Apple" }),
    level("b", "Apple iPhone 15", 0, { brand: "Apple" }),
    level("c", "Dreame L50 Robot Vacuum", 1, { brand: "Dreame", reserved: 1, available: 0 }),
  ];
  const byCategory = groupStock(levels, "category");
  assert.deepEqual(byCategory.map((g) => [g.label, g.skus, g.onHand, g.free, g.allocated]), [["Phones", 1, 3, 3, 0], ["Robot vacuums", 1, 1, 0, 1]]);
  assert.deepEqual(groupStock(levels, "brand").map((g) => g.label), ["Apple", "Dreame"]);
});

test("the live tab rows: title, totals, header, then products by category; no customer data", () => {
  const rows = liveStockRows([level("x", "Dreame L50 Robot Vacuum", 2), level("y", "Apple iPhone 16", 1), level("z", "Old phone", 0)], new Date("2026-11-11T06:30:00Z"));
  assert.match(String(rows[0][0]), /Do not type in this tab/);
  assert.equal(rows[1][1], "11 Nov 2026, 12:00 pm");
  assert.deepEqual(rows[3].slice(0, 4), ["Category", "Brand", "SKU", "Product"]);
  assert.deepEqual(rows.slice(4).map((r) => r[0]), ["Phones", "Robot vacuums"]);
  assert.equal(rows[4][10], 100);
});

test("sheet sync is off until a start date is set; the feed needs a long key", () => {
  assert.equal(sheetSyncConfigFromEnv({}), null);
  assert.equal(sheetSyncConfigFromEnv({ SHEET_SYNC_FROM: "30/10/2026" }), null);
  const plain = sheetSyncConfigFromEnv({ SHEET_SYNC_FROM: "2026-10-30" });
  assert.match(plain?.csvUrl ?? "", /1MqWjG8H1CO.*export\?format=csv&gid=1559545069/);
  assert.equal(plain?.feedKey, null);
  const full = sheetSyncConfigFromEnv({ SHEET_SYNC_FROM: "2026-10-30", SHEET_SYNC_TOKEN: "a-long-random-token-123", INVENTORY_SHEET_ID: "https://docs.google.com/spreadsheets/d/1wdd-2qvF-kMAyy8dmxOdXzBEeX3LXRAqNVFBZusFsG4/edit" });
  assert.equal(full?.feedKey, "a-long-random-token-123");
  assert.equal(full?.sheetUrl, "https://docs.google.com/spreadsheets/d/1wdd-2qvF-kMAyy8dmxOdXzBEeX3LXRAqNVFBZusFsG4/edit");
  assert.equal(sheetSyncConfigFromEnv({ SHEET_SYNC_FROM: "2026-10-30", INVENTORY_SOURCE_CSV: "https://evil.example/x.csv" }), null, "only Google Sheets");
});

test("CSV: quotes, commas and line breaks inside cells", () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, ""y""","line1\nline2"\n'), [["a", "b"], ['x, "y"', "line1\nline2"]]);
  assert.equal(sheetDate("30/10/2026"), "2026-10-30");
  assert.equal(sheetDate("3/1/2026"), "2026-01-03");
  assert.equal(sheetDate("2026-11-02"), "2026-11-02");
  assert.equal(sheetDate("Inward Date "), null);
});

test("reading Inventory Masterbase: new rows only, stable keys, stock counts for every row", () => {
  const csv = [
    "Serial No.,SKU Code,Product Name,Brand,Quantity,Inward Date,Vendor,Invoice no.,Unit Cost,Dispatch Date,Customer Name,Returned to Vendor (Y/N)",
    'SN1,ep-dr-l50s-pu,Dreame,Dreame,1,29/10/2026,Value-One,INV1,"₹47,699",,,No',
    "SN2,ep-dr-l50s-pu,Dreame,Dreame,1,30/10/2026,Value-One,INV2,47699,,,No",
    ",ep-ne-gw-50,Neesh,NEESH,1,01/11/2026,Neesh,N7,900,,,No",
    ",ep-ne-gw-50,Neesh,NEESH,1,01/11/2026,Neesh,N7,900,02/11/2026,Asha,No",
    "SN0,ep-dr-l50s-pu,Dreame,Dreame,1,01/09/2026,Value-One,INV0,47699,31/10/2026,Ravi,No",
    ",SKU Code,Product Name,,,Inward Date ,,,,,,",
    "SN3,ep-dr-l50s-pu,Dreame,Dreame,1,30/10/2026,Value-One,INV2,47699,,,Yes",
  ].join("\n");
  const read = readSheet(csv, "2026-10-30");
  assert.equal(read.total, 6, "the repeated header row is skipped");
  assert.deepEqual(read.rows.map((r) => r.key), ["SN2", "ep-ne-gw-50|2026-11-01|N7|1", "ep-ne-gw-50|2026-11-01|N7|2", "SN0", "SN3"]);
  assert.equal(read.rows[0].unitCostRupees, 47699);
  assert.equal(read.rows[2].dispatchDate, "2026-11-02");
  assert.equal(read.rows[4].returnedToVendor, true);
  assert.deepEqual(read.counts, { "ep-dr-l50s-pu": 2, "ep-ne-gw-50": 1 });
  assert.throws(() => readSheet("a,b\n1,2", "2026-10-30"), /not the Inventory Masterbase tab/);
});

test("the last read's numbers are kept in its mark", () => {
  assert.deepEqual(readPullMark("sheet-pull-ok:2026-11-11T10:00:00.000Z|in3|out5|rtv0|p2|rows2504"), { at: "2026-11-11T10:00:00.000Z", inward: 3, dispatched: 5, returned: 0, problems: 2, rows: 2504 });
  assert.equal(readPullMark(null), null);
});

function sheetStore() {
  return new MemoryOpsStore({
    products: [{ sku: "ep-dr-l50s-pu", name: "DREAME L50s Pro Ultra", brand: "Dreame", category: "Robot Vacuum", channel: "CnC", listPriceMinor: 8_000_000, gstRate: 0.18, hsn: null, eol: false, needsInstallation: false }],
    movements: [{ sku: "ep-dr-l50s-pu", qty: 1, kind: "opening", refType: null, refId: null, serialNo: "OLD1", unitCostMinor: 7_000_000, note: null, actor: "import", createdAt: "2026-10-01T00:00:00Z" }],
    purchaseOrders: [],
  });
}

const row = (patch: Partial<SheetRowInput>): SheetRowInput => ({ key: "k", serial: null, sku: "ep-dr-l50s-pu", productName: "Dreame", qty: 1, inwardDate: null, vendor: null, invoice: null, unitCostRupees: null, dispatchDate: null, customer: null, returnedToVendor: false, ...patch });
const sheetActor = { name: "Team sheet", slackUserId: null };

test("sheet → app: new stock once, old rows ignored, unknown SKUs reported", async () => {
  const s = sheetStore();
  const rows = [
    row({ key: "SN2", serial: "SN2", inwardDate: "2026-11-12", unitCostRupees: 47699, vendor: "Value-One" }),
    row({ key: "OLD1", serial: "OLD1", inwardDate: "2026-10-01" }),
    row({ key: "SN9", serial: "SN9", sku: "ep-unknown", inwardDate: "2026-11-12" }),
  ];
  const first = await applySheetRows(s, rows, "2026-11-12", sheetActor);
  assert.equal(first.inward, 2, "the unknown SKU is added as a product from the sheet");
  assert.equal(first.productsAdded, 1);
  const again = await applySheetRows(s, rows, "2026-11-12", sheetActor);
  assert.equal(again.inward, 0, "each row is applied once");
  assert.equal((await s.stockFor("ep-dr-l50s-pu"))?.onHand, 2);
});

test("sheet → app: a dispatch typed in the sheet takes a free unit, never an allocated one", async () => {
  const s = sheetStore();
  const sale = await createOrder(s, { source: "desk", customerName: "Asha", phone: "9845012345", hub: "Hebbal", poc: "Ibrahim", lines: [{ sku: "ep-dr-l50s-pu", productName: "x", listPriceMinor: null, offeredPriceMinor: 7_500_000 }] }, sheetActor);
  assert.ok(sale.ok);
  await clearForFulfilment(s, sale.value.id, "Test", sheetActor);
  await decideLine(s, sale.value.lines[0].id, { type: "reserve" }, sheetActor);
  const blocked = await applySheetRows(s, [row({ key: "OLD1", serial: "OLD1", dispatchDate: "2026-11-12", customer: "Walk-in" })], "2026-11-12", sheetActor);
  assert.equal(blocked.dispatched, 0);
  assert.match(blocked.problems[0].message, /allocated to orders/);
  await applySheetRows(s, [row({ key: "SN3", serial: "SN3", inwardDate: "2026-11-12" })], "2026-11-12", sheetActor);
  const ok = await applySheetRows(s, [row({ key: "SN3", serial: "SN3", inwardDate: "2026-11-12", dispatchDate: "2026-11-12" })], "2026-11-12", sheetActor);
  assert.equal(ok.dispatched, 1);
  assert.equal((await s.stockFor("ep-dr-l50s-pu"))?.onHand, 1);
});

test("a unit the app shipped is not taken out again when the sheet shows its dispatch", async () => {
  const s = sheetStore();
  const sale = await createOrder(s, { source: "desk", customerName: "Asha", phone: "9845012345", hub: "Hebbal", poc: "Ibrahim", lines: [{ sku: "ep-dr-l50s-pu", productName: "x", listPriceMinor: null, offeredPriceMinor: 7_500_000 }] }, sheetActor);
  assert.ok(sale.ok);
  await clearForFulfilment(s, sale.value.id, "Test", sheetActor);
  await decideLine(s, sale.value.lines[0].id, { type: "reserve" }, sheetActor);
  await outForDelivery(s, sale.value.id, { driver: "Ravi", serials: { [sale.value.lines[0].id]: "OLD1" }, expectedDate: null }, sheetActor);
  const next = await applySheetRows(s, [row({ key: "OLD1", serial: "OLD1", dispatchDate: "2026-11-12" })], "2026-10-30", sheetActor);
  assert.deepEqual([next.dispatched, next.problems.length], [0, 0]);
  assert.equal((await s.stockFor("ep-dr-l50s-pu"))?.onHand, 0);
});

test("already-applied rows are skipped from the bulk list without asking again", async () => {
  const s = sheetStore();
  const done = new Set(["sheet:in:SN5"]);
  const result = await applySheetRows(s, [row({ key: "SN5", serial: "SN5", inwardDate: "2026-11-12" })], "2026-10-30", sheetActor, { known: new Set(["ep-dr-l50s-pu"]), done });
  assert.equal(result.inward, 0);
  // Not in the fast list but in the product list: used as is, never overwritten.
  const existing = await applySheetRows(s, [row({ key: "SN6", productName: "Some other name", inwardDate: "2026-11-12" })], "2026-10-30", sheetActor, { known: new Set() });
  assert.deepEqual([existing.inward, existing.productsAdded], [1, 0]);
  assert.equal((await s.getProduct("ep-dr-l50s-pu"))?.listPriceMinor, 8_000_000);
  // New to the app: added from the sheet's name and brand.
  const fresh = await applySheetRows(s, [row({ key: "SN7", sku: "ep-qb-q200-wh", productName: "Qubo Air Purifier Q200", brand: "Qubo", inwardDate: "2026-11-12" })], "2026-10-30", sheetActor);
  assert.deepEqual([fresh.inward, fresh.productsAdded, fresh.problems.length], [1, 1, 0]);
  assert.equal((await s.getProduct("ep-qb-q200-wh"))?.brand, "Qubo");
  const nameless = await applySheetRows(s, [row({ key: "SN8", sku: "ep-zz-x1", productName: "ep-zz-x1", inwardDate: "2026-11-12" })], "2026-10-30", sheetActor);
  assert.equal(nameless.problems.length, 1);
});

test("stock check lists only the SKUs where sheet and app disagree", () => {
  const levels = [level("a", "A", 3), level("b", "B", 2)];
  assert.deepEqual(stockCheck(levels, { a: 3, b: 1, c: 4 }).map((c) => [c.sku, c.app, c.sheet]), [["c", 0, 4], ["b", 2, 1]]);
});

test("inventory notes: add, tick done, open again", async () => {
  const s = new MemoryOpsStore();
  const piyush = { name: "Piyush", slackUserId: null };
  assert.equal((await addInventoryNote(s, " ", piyush)).ok, false);
  const added = await addInventoryNote(s, "Recheck Dreame shelf", piyush);
  assert.ok(added.ok);
  assert.ok((await setInventoryNoteDone(s, added.value.id, true, { name: "Ravi", slackUserId: null })).ok);
  const [note] = await s.listInventoryNotes(10);
  assert.equal(note.done, true);
  assert.equal(note.doneBy, "Ravi");
  await setInventoryNoteDone(s, added.value.id, false, piyush);
  assert.equal((await s.listInventoryNotes(10))[0].done, false);
  assert.equal((await setInventoryNoteDone(s, "nope", true, piyush)).ok, false);
});

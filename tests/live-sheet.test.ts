import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryOpsStore } from "../src/lib/ops/memory-store";
import { addInventoryNote, applySheetRows, clearForFulfilment, createOrder, decideLine, outForDelivery, setInventoryNoteDone, type SheetRowInput } from "../src/lib/ops/service";
import { groupStock, stockCategory } from "../src/lib/ops/stock-category";
import type { StockLevel } from "../src/lib/ops/types";
import { liveStockRows } from "../src/lib/sheets/live-stock";
import { parseSheetPayload, sheetReply, sheetSyncConfigFromEnv, stockCheck } from "../src/lib/sheets/sheet-sync";

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
  assert.match(String(rows[0][0]), /Do not type here/);
  assert.equal(rows[1][1], "11 Nov 2026, 12:00 pm");
  assert.deepEqual(rows[3].slice(0, 4), ["Category", "Brand", "SKU", "Product"]);
  assert.deepEqual(rows.slice(4).map((r) => r[0]), ["Phones", "Robot vacuums"]);
  assert.equal(rows[4][10], 100);
});

test("sheet sync is off unless a long token and a start date are set", () => {
  assert.equal(sheetSyncConfigFromEnv({}), null);
  assert.equal(sheetSyncConfigFromEnv({ SHEET_SYNC_TOKEN: "short", SHEET_SYNC_FROM: "2026-11-12" }), null);
  const cfg = sheetSyncConfigFromEnv({ SHEET_SYNC_TOKEN: "a-long-random-token-123", SHEET_SYNC_FROM: "2026-11-12", INVENTORY_SHEET_ID: "https://docs.google.com/spreadsheets/d/1wdd-2qvF-kMAyy8dmxOdXzBEeX3LXRAqNVFBZusFsG4/edit" });
  assert.deepEqual(cfg, { token: "a-long-random-token-123", from: "2026-11-12", sheetId: "1wdd-2qvF-kMAyy8dmxOdXzBEeX3LXRAqNVFBZusFsG4" });
});

test("the sheet payload is checked: bad rows dropped, money and flags read plainly", () => {
  const { rows, counts } = parseSheetPayload({
    rows: [
      { key: "SN1", serial: "SN1", sku: "EP-DR-L50S-PU", productName: "Dreame", qty: 1, inwardDate: "2026-11-12", unitCost: "₹47,699", returnedToVendor: "No" },
      { key: "", sku: "ep-x" },
      { key: "k2", sku: "not a sku!" },
      { key: "k3", sku: "ep-ne-gw-50", qty: "4", dispatchDate: "12/11/2026", returnedToVendor: "Yes" },
    ],
    counts: { "EP-DR-L50S-PU": 3, bad: "x" },
  });
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].sku, rows[0].unitCostRupees, rows[0].returnedToVendor], ["ep-dr-l50s-pu", 47699, false]);
  assert.deepEqual([rows[1].qty, rows[1].dispatchDate, rows[1].returnedToVendor], [4, null, true], "dates must already be YYYY-MM-DD");
  assert.deepEqual(counts, { "ep-dr-l50s-pu": 3 });
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
  assert.equal(first.inward, 1);
  assert.equal(first.problems.length, 1);
  assert.match(first.problems[0].message, /not in the app's product list/);
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
  assert.match(blocked.problems[0].message, /0 free/);
  await applySheetRows(s, [row({ key: "SN3", serial: "SN3", inwardDate: "2026-11-12" })], "2026-11-12", sheetActor);
  const ok = await applySheetRows(s, [row({ key: "SN3", serial: "SN3", inwardDate: "2026-11-12", dispatchDate: "2026-11-12" })], "2026-11-12", sheetActor);
  assert.equal(ok.dispatched, 1);
  assert.equal((await s.stockFor("ep-dr-l50s-pu"))?.onHand, 1);
});

test("app → sheet: the app's dispatch goes back with customer and POC, and is not counted twice", async () => {
  const s = sheetStore();
  const from = new Date().toISOString().slice(0, 10);
  const sale = await createOrder(s, { source: "desk", customerName: "Asha", phone: "9845012345", hub: "Hebbal", poc: "Ibrahim", lines: [{ sku: "ep-dr-l50s-pu", productName: "x", listPriceMinor: null, offeredPriceMinor: 7_500_000 }] }, sheetActor);
  assert.ok(sale.ok);
  await clearForFulfilment(s, sale.value.id, "Test", sheetActor);
  await decideLine(s, sale.value.lines[0].id, { type: "reserve" }, sheetActor);
  await outForDelivery(s, sale.value.id, { driver: "Ravi", serials: { [sale.value.lines[0].id]: "OLD1" }, expectedDate: null }, sheetActor);
  const reply = await sheetReply(s, from, { "ep-dr-l50s-pu": 1 });
  assert.deepEqual(reply.dispatches.map((d) => [d.serial, d.customer, d.poc, d.priceRupees]), [["OLD1", "Asha", "Ibrahim", 75000]]);
  assert.deepEqual(reply.check, [{ sku: "ep-dr-l50s-pu", product: "DREAME L50s Pro Ultra", app: 0, sheet: 1 }]);
  // The script writes the date into the sheet; on the next sync the app sees it and does nothing.
  const next = await applySheetRows(s, [row({ key: "OLD1", serial: "OLD1", dispatchDate: from })], from, sheetActor);
  assert.deepEqual([next.dispatched, next.problems.length], [0, 0]);
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

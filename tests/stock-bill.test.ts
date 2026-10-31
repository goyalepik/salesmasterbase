import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryOpsStore } from "../src/lib/ops/memory-store";
import { receiveStock } from "../src/lib/ops/service";
import { matchBill, matchScore, tokens } from "../src/lib/ops-ui/bill-match";
import { stockDetail } from "../src/lib/ops-ui/serials";

const desk = { name: "Desk", slackUserId: null };

function store() {
  return new MemoryOpsStore({
    products: [
      { sku: "ep-ap-i15-128-bk", name: "Apple iPhone 15 (128 GB) - Black", brand: "Apple", category: "Phone", channel: "CnC", listPriceMinor: 7_500_000, gstRate: 0.18, hsn: null, eol: false, needsInstallation: false },
      { sku: "ep-ap-i15-256-bk", name: "Apple iPhone 15 (256 GB) - Black", brand: "Apple", category: "Phone", channel: "CnC", listPriceMinor: 8_500_000, gstRate: 0.18, hsn: null, eol: false, needsInstallation: false },
      { sku: "ep-dr-l10s-u", name: "DREAME L10s Ultra Robot Vacuum", brand: "Dreame", category: "Robot Vacuum", channel: "CnC", listPriceMinor: 6_000_000, gstRate: 0.18, hsn: null, eol: false, needsInstallation: true },
    ],
    movements: [{ sku: "ep-ap-i15-128-bk", qty: 2, kind: "opening", refType: null, refId: null, serialNo: null, unitCostMinor: 6_500_000, note: null, actor: "import", createdAt: "2026-10-01T00:00:00Z" }],
    purchaseOrders: [{ id: "po1", poNumber: "PO-9", vendor: "Value-One", sku: "ep-dr-l10s-u", productName: null, qtyOrdered: 5, qtyReceived: 1, eta: null, status: "open", createdAt: "2026-10-01T00:00:00Z" }],
  });
}

test("bill words split letters from digits", () => {
  assert.deepEqual(tokens("iPhone15 128GB Black"), ["iphone", "15", "128", "gb", "black"]);
});

test("the bill line picks the right storage size", () => {
  const line = { model: "iPhone 15 128GB Black", description: "APPLE IPHONE 15 128GB BLACK MTP03HN/A" };
  assert.ok(matchScore(line, { name: "Apple iPhone 15 (128 GB) - Black", brand: "Apple", sku: "ep-ap-i15-128-bk" }) > matchScore(line, { name: "Apple iPhone 15 (256 GB) - Black", brand: "Apple", sku: "ep-ap-i15-256-bk" }));
});

test("bill lines are matched to SKUs and to open POs", async () => {
  const [phone, robot, unknown] = await matchBill(store(), [
    { description: "APPLE IPHONE 15 128GB BLACK", model: "iPhone 15 128GB Black", qty: 2, unitCost: 64999.5, serials: ["IMEI1"] },
    { description: "Dreame L10s Ultra robotic cleaner", model: "Dreame L10s Ultra", qty: 3, unitCost: null, serials: [] },
    { description: "Freight charges", model: "Freight", qty: 1, unitCost: 500, serials: [] },
  ]);
  assert.equal(phone!.match?.sku, "ep-ap-i15-128-bk");
  assert.equal(phone!.unitCostMinor, 6_499_950);
  assert.equal(robot!.match?.sku, "ep-dr-l10s-u");
  assert.deepEqual(robot!.pos.map((p) => [p.poNumber, p.pending]), [["PO-9", 4]]);
  assert.equal(unknown!.match, null);
});

test("a bill without a PO adds stock as a purchase, and serials show until dispatched", async () => {
  const s = store();
  const added = await receiveStock(s, { sku: "ep-ap-i15-128-bk", qty: 2, reason: "purchase", note: "Croma, bill 77", serials: ["SN-A", "SN-B"], unitCostMinor: 6_400_000 }, desk);
  assert.ok(added.ok);
  const level = (await s.stockFor("ep-ap-i15-128-bk"))!;
  assert.equal(level.onHand, 4);
  const moves = await s.listMovements("ep-ap-i15-128-bk", 50);
  assert.ok(moves.every((m) => m.kind !== "return"));
  assert.match(moves[0]!.note ?? "", /Bought on a bill: Croma, bill 77/);
  const detail = stockDetail(moves, level.onHand);
  assert.deepEqual(detail.serials.map((x) => x.serial).sort(), ["SN-A", "SN-B"]);
  assert.equal(detail.unserialised, 2);
  // A dispatched serial leaves the list.
  await s.addMovement({ sku: "ep-ap-i15-128-bk", qty: -1, kind: "dispatch", refType: "order", refId: "EPK-1", serialNo: "sn-a", unitCostMinor: null, note: null, actor: "Desk" });
  const after = stockDetail(await s.listMovements("ep-ap-i15-128-bk", 50), 3);
  assert.deepEqual(after.serials.map((x) => x.serial), ["SN-B"]);
});

test("a bill for the main product does not match its accessory or a bigger variant", () => {
  const robot = { model: "Dreame L50s Pro Ultra", description: "Dreame L50s Pro Ultra Robot Vacuum (White)" };
  const real = matchScore(robot, { name: "DREAME L50s Pro Ultra Robot Vacuum & Mop, 30000Pa Suction", brand: "Dreame", sku: "ep-dr-l50s-pu" });
  const kit = matchScore(robot, { name: "Dreame Accessory Kit for L50s Pro Ultra Robot Vacuum, Main Brush, Side Brushes, Filters", brand: "Dreame", sku: "ep-dr-l50spu-ak" });
  assert.ok(real > kit);
  const phone = { model: "iPhone 16 128GB Teal", description: "Apple iPhone 16 128GB Teal MYEJ3HN/A" };
  const plain = matchScore(phone, { name: "Apple iPhone 16 (128 GB) - Teal", brand: "Apple", sku: "ep-ap-i16-128-tl" });
  const plus = matchScore(phone, { name: "iPhone 16 Plus 128 GB: 5G Mobile Phone with Camera Control, A18 Chip; Teal", brand: "Apple", sku: "ep-ap-i16pl-128-tl" });
  assert.ok(plain > plus);
});

test("the bill's vendor PO is offered first", async () => {
  const s = store();
  await s.upsertPurchaseOrder({ poNumber: "PO-1", vendor: "Croma", sku: "ep-dr-l10s-u", productName: null, qtyOrdered: 2, qtyReceived: 0, eta: "2026-10-01", status: "open" });
  const [robot] = await matchBill(s, [{ description: "Dreame L10s Ultra", model: "Dreame L10s Ultra", qty: 1, unitCost: null, serials: [] }], "VALUE-ONE RETAIL PVT LTD");
  assert.equal(robot!.pos[0]!.poNumber, "PO-9");
});

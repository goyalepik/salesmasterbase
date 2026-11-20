import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryOpsStore } from "../src/lib/ops/memory-store";
import { createOrder, type Actor } from "../src/lib/ops/service";
import { serviceRolesFor } from "../src/lib/app-roles";
import { MemoryWmsStore } from "../src/features/wms/memory-store";
import { createPo, ensureMasters, submitGrn, type Wms } from "../src/features/wms/service";
import { checkDispatchScan, countScan, dispatchOrder, finishCount, openRma, orderUnits, rmaNetCost, rmaStep, sendToVendor, setUnitStatus, settleCount, shipmentDelivered, startCount } from "../src/features/wms/flows";
import { createOpeningUnits, dailyMovement, dashboard, openingPlan, replenishment } from "../src/features/wms/insights";
import { reorderRow } from "../src/features/wms/domain/replenish";

// Every order here counts as payment-approved (approval tests are in payment-approval.test.ts).
process.env.PAYMENT_APPROVAL_FROM = "2099-01-01T00:00:00Z";

const admin: Actor = { name: "Bhavya", slackUserId: null, roles: ["admin"] };
const warehouse: Actor = { name: "Ravi", slackUserId: null, roles: serviceRolesFor("warehouse") };
const procurement: Actor = { name: "Anurag", slackUserId: null, roles: serviceRolesFor("inventory") };
const ROBOT = "ep-ec-t50po";
const PHONE = "ep-ap-ip16";

async function setup(stock = 5): Promise<Wms> {
  const ops = new MemoryOpsStore({ products: [], movements: [], purchaseOrders: [] });
  await ops.upsertProducts([
    { sku: ROBOT, name: "Ecovacs T50 Pro Omni", brand: "Ecovacs", category: "Robot vacuum", channel: "CnC", listPriceMinor: 7_999_900, gstRate: 18, hsn: null, eol: false, needsInstallation: true },
    { sku: PHONE, name: "iPhone 16", brand: "Apple", category: "Phone", channel: "CnC", listPriceMinor: 7_990_000, gstRate: 18, hsn: null, eol: false, needsInstallation: false },
  ]);
  const ctx = { ops, wms: new MemoryWmsStore() };
  await ensureMasters(ctx);
  await ctx.wms.addMasters([{ kind: "logistics_partner", name: "Delhivery" }]);
  const partner = (await ctx.wms.listMasters("logistics_partner")).find((m) => m.name === "Delhivery")!;
  await ctx.wms.setMasterNote(partner.id, "https://track.example/{awb}");
  if (stock) {
    const po = await createPo(ctx, { poNumber: null, vendor: "Devi International", hub: "HSR HQ", billedTo: null, paymentTerms: null, priority: "normal", eta: null, notes: null, lines: [{ sku: ROBOT, qty: stock, unitCostMinor: 4_500_000, ownership: "CnC" }] }, procurement);
    assert.ok(po.ok);
    const items = Array.from({ length: stock }, (_, i) => ({ sku: ROBOT, serial: `T50-${i + 1}`, serialSource: "scan" as const, condition: "good" as const, remark: null, photo: null, altId: null }));
    const grn = await submitGrn(ctx, { clientId: `grn-setup-${stock}-x`, poNumber: po.value.poNumber, invoiceNo: "INV-1", invoicePending: false, notes: null, items, counts: [] }, warehouse);
    assert.ok(grn.ok, grn.ok ? "" : grn.error);
  }
  return ctx;
}

async function sale(ctx: Wms, sku = ROBOT) {
  const created = await createOrder(ctx.ops, { source: "desk", customerName: "Asha Rao", phone: "9845012345", hub: "HQ", poc: "Ibrahim", lines: [{ sku, productName: sku === ROBOT ? "Ecovacs T50 Pro Omni" : "iPhone 16", listPriceMinor: null, offeredPriceMinor: 7_000_000 }] }, admin);
  assert.ok(created.ok);
  return created.value.id;
}

const tpl = { carrier: "3pl" as const, partner: "Delhivery", driver: null, awb: "DL123456", trackingUrl: null, expectedDate: "2026-11-25", note: null };

test("Phase 2: scan at dispatch links the serial to the order line; wrong product blocked; AWB and tracking link on the order", async () => {
  const ctx = await setup();
  const orderId = await sale(ctx);
  const wrong = await sale(ctx, PHONE);
  const blocked = await checkDispatchScan(ctx, wrong, "T50-1", []);
  assert.equal(blocked.ok, false);
  assert.match(blocked.ok ? "" : blocked.reason, /Wrong product/);

  const done = await dispatchOrder(ctx, { orderId, units: [{ lineId: "", serial: "t50-1" }], ...tpl }, warehouse, new Date("2026-11-20T11:00:00+05:30"));
  assert.ok(done.ok, done.ok ? "" : done.error);
  assert.equal(done.value.trackingUrl, "https://track.example/DL123456");
  const order = (await ctx.ops.getOrder(orderId))!;
  assert.equal(order.stage, "out_for_delivery");
  assert.equal(order.lines[0].serialNo, "T50-1");
  assert.equal((await ctx.ops.stockFor(ROBOT))!.onHand, 4, "one left the ledger");
  const units = await orderUnits(ctx, orderId);
  assert.equal(units[0].unit?.serial, "T50-1");
  assert.equal(units[0].shipment?.awb, "DL123456");
  assert.equal((await checkDispatchScan(ctx, orderId, "T50-1", [])).ok, false, "a dispatched unit can't go again");

  const delivered = await shipmentDelivered(ctx, done.value.number, { collectedMinor: 0, mode: null }, warehouse, new Date("2026-11-21T15:00:00+05:30"));
  assert.ok(delivered.ok);
  assert.equal((await ctx.ops.getOrder(orderId))!.stage, "delivered");
  assert.equal((await ctx.wms.getUnit(units[0].unit!.id))!.status, "delivered");
});

test("Phase 3: replacement end to end, defective unit back to the vendor with a credit note, net cost, both serials on the order", async () => {
  const ctx = await setup();
  const orderId = await sale(ctx);
  const shipped = await dispatchOrder(ctx, { orderId, units: [{ lineId: "", serial: "T50-1" }], ...tpl }, warehouse);
  assert.ok(shipped.ok);
  await shipmentDelivered(ctx, shipped.value.number, { collectedMinor: 0, mode: null }, warehouse);

  const opened = await openRma(ctx, { serial: "T50-1", type: "replacement", reason: "Defective", description: "Doesn't charge", brandTicket: "ECO-991" }, warehouse);
  assert.ok(opened.ok, opened.ok ? "" : opened.error);
  const n = opened.value.number;
  assert.equal(opened.value.orderId, orderId);
  assert.ok((await rmaStep(ctx, n, { step: "approve", note: null }, warehouse)).ok);
  assert.ok((await rmaStep(ctx, n, { step: "pickup", partner: "Delhivery", awb: "RV777", trackingUrl: null }, warehouse)).ok);
  const wrongSerial = await rmaStep(ctx, n, { step: "receive", serial: "T50-9", condition: "defective", note: null, override: false }, warehouse);
  assert.equal(wrongSerial.ok, false, "the returned serial must match");
  assert.ok((await rmaStep(ctx, n, { step: "receive", serial: "T50-1", condition: "defective", note: null, override: false }, warehouse)).ok);
  assert.ok((await rmaStep(ctx, n, { step: "dispose", to: "rtv_pending", note: null }, warehouse)).ok);
  const repl = await rmaStep(ctx, n, { step: "replace", serial: "T50-2", ...tpl, awb: "DL999" }, warehouse);
  assert.ok(repl.ok, repl.ok ? "" : repl.error);

  const rtv = await sendToVendor(ctx, { serials: ["T50-1"], vendor: "Devi International", creditNoteMinor: 4_000_000, ...tpl, awb: "RTV1" }, procurement);
  assert.ok(rtv.ok, rtv.ok ? "" : rtv.error);
  assert.equal((await ctx.wms.unitsBySerial("T50-1"))[0].status, "returned_to_vendor");
  await rmaStep(ctx, n, { step: "money", refundMinor: null, shippingCostMinor: 50_000, repairCostMinor: null, recoveredMinor: null }, warehouse);
  const rma = (await ctx.wms.getRecord("rma", n))!;
  assert.equal(rma.recoveredMinor, 4_000_000);
  assert.equal(await rmaNetCost(ctx, rma), 4_500_000 + 50_000 - 4_000_000, "replacement cost + shipping − credit note");
  assert.ok((await rmaStep(ctx, n, { step: "close", note: null }, warehouse)).ok);

  const history = await orderUnits(ctx, orderId);
  assert.deepEqual(history.map((h) => `${h.unit?.serial}:${h.link.linkType}:${h.link.active}`).sort(), ["T50-1:sale:false", "T50-2:replacement:true"]);
  // Ledger: 5 in, 1 out, 1 back, 1 replacement out, 1 to vendor → 3.
  assert.equal((await ctx.ops.stockFor(ROBOT))!.onHand, 3);
});

test("Phase 3: demo units and hub moves; write-offs need procurement or admin", async () => {
  const ctx = await setup(2);
  const [a, b] = await ctx.wms.listUnits({ sku: ROBOT });
  assert.equal((await setUnitStatus(ctx, a.id, { to: "demo_deployed", note: null, hub: null }, warehouse)).ok, false, "demo needs where");
  assert.ok((await setUnitStatus(ctx, a.id, { to: "demo_deployed", note: "Croma Indiranagar display", hub: null }, warehouse)).ok);
  assert.equal((await ctx.ops.stockFor(ROBOT))!.onHand, 1, "a demo unit leaves warehouse stock");
  assert.ok((await setUnitStatus(ctx, b.id, { to: "transfer_in_transit", note: null, hub: "Hebbal" }, warehouse)).ok);
  assert.ok((await setUnitStatus(ctx, b.id, { to: "available", note: null, hub: "Hebbal" }, warehouse)).ok);
  assert.equal((await ctx.wms.getUnit(b.id))!.hub, "Hebbal");
  assert.equal((await setUnitStatus(ctx, b.id, { to: "written_off", note: "Fell", hub: null }, warehouse)).ok, false);
  assert.ok((await setUnitStatus(ctx, b.id, { to: "written_off", note: "Fell off the rack", hub: null }, procurement)).ok);
});

test("Phase 4: a blind count finds missing and misplaced units; fixing it moves and marks lost", async () => {
  const ctx = await setup(3);
  const count = await startCount(ctx, "HSR HQ", warehouse);
  assert.ok(count.ok);
  assert.ok((await countScan(ctx, count.value.number, "T50-1", warehouse)).ok);
  assert.equal((await countScan(ctx, count.value.number, "t50-1", warehouse)).ok, false, "counted once");
  assert.ok((await countScan(ctx, count.value.number, "STRANGER-1", warehouse)).ok);
  const done = await finishCount(ctx, count.value.number, warehouse);
  assert.ok(done.ok);
  assert.equal(done.value.result!.missing.length, 2);
  assert.deepEqual(done.value.result!.unexpected, ["STRANGER-1"]);
  assert.equal((await settleCount(ctx, count.value.number, { moveHere: false, markLost: true, note: "Checked every rack" }, warehouse)).ok, false);
  assert.ok((await settleCount(ctx, count.value.number, { moveHere: true, markLost: true, note: "Checked every rack" }, procurement)).ok);
  assert.equal((await ctx.ops.stockFor(ROBOT))!.onHand, 1);
});

test("Phase 4: reorder rules match the DOH sheet; dashboard and daily movement add up", async () => {
  assert.equal(reorderRow({ warehouse: 0, inTransit: 0, sold7: 2, sold30: 6, daysSinceSale: 1 }).status, "out_of_stock");
  assert.equal(reorderRow({ warehouse: 2, inTransit: 0, sold7: 3, sold30: 12, daysSinceSale: 1 }).status, "reorder_now");
  const r = reorderRow({ warehouse: 2, inTransit: 0, sold7: 3, sold30: 12, daysSinceSale: 1 });
  assert.equal(r.suggested, 10, "30 days × 0.4/day − 2");
  assert.equal(reorderRow({ warehouse: 5, inTransit: 0, sold7: 0, sold30: 0, daysSinceSale: null }).status, "dead");
  assert.equal(reorderRow({ warehouse: 50, inTransit: 0, sold7: 1, sold30: 3, daysSinceSale: 2 }).status, "overstock");

  const ctx = await setup();
  const orderId = await sale(ctx);
  await dispatchOrder(ctx, { orderId, units: [{ lineId: "", serial: "T50-3" }], ...tpl }, warehouse);
  const rows = await replenishment(ctx);
  assert.equal(rows.find((x) => x.sku === ROBOT)!.sold30, 1);
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const day = (await dailyMovement(ctx, today)).find((x) => x.sku === ROBOT)!;
  assert.deepEqual({ opening: day.opening, inward: day.inward, dispatch: day.dispatch, closing: day.closing }, { opening: 0, inward: 5, dispatch: 1, closing: 4 });
  const d = await dashboard(ctx, admin);
  assert.equal(d.units.onHand, 4);
  assert.equal(d.units.valueMinor, 4 * 4_500_000);
  assert.equal(d.fulfilment.onRoad, 1);
  assert.equal(d.quality.scanned, 5);
  assert.equal((await dashboard(ctx, warehouse)).units.valueMinor, 0, "warehouse sees no money");
});

test("Phase 5: the switch-over makes one unit per unit of today's stock (serials kept, the rest labelled) and adds nothing twice", async () => {
  const ctx = await setup(0);
  await ctx.ops.addMovements([
    { sku: ROBOT, qty: 1, kind: "inward", refType: "sheet", refId: "r1", serialNo: "SHEET-1", unitCostMinor: 4_400_000, note: null, actor: "Team sheet" },
    { sku: ROBOT, qty: 1, kind: "inward", refType: "sheet", refId: "r2", serialNo: "SHEET-2", unitCostMinor: 4_400_000, note: null, actor: "Team sheet" },
    { sku: ROBOT, qty: -1, kind: "dispatch", refType: "sheet", refId: "r3", serialNo: "SHEET-2", unitCostMinor: null, note: null, actor: "Team sheet" },
    { sku: ROBOT, qty: 2, kind: "inward", refType: "sheet", refId: "r4", serialNo: null, unitCostMinor: 4_400_000, note: null, actor: "Team sheet" },
  ]);
  const plan = await openingPlan(ctx);
  assert.equal(plan.withSerial, 1);
  assert.equal(plan.placeholders, 2);
  assert.equal((await createOpeningUnits(ctx, warehouse)).ok, false, "admin only");
  const made = await createOpeningUnits(ctx, admin);
  assert.ok(made.ok);
  assert.equal(made.value.created, 3);
  assert.equal((await ctx.ops.stockFor(ROBOT))!.onHand, 3, "the ledger doesn't change");
  assert.equal((await openingPlan(ctx)).units, 0, "running it again adds nothing");
});

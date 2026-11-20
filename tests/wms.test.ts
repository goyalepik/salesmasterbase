import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryOpsStore } from "../src/lib/ops/memory-store";
import type { Actor } from "../src/lib/ops/service";
import { serviceRolesFor } from "../src/lib/app-roles";
import { MemoryWmsStore } from "../src/features/wms/memory-store";
import { checkScan, createPo, ensureMasters, poView, search, stockOnHand, submitGrn, unitDetail, type GrnItem, type Wms } from "../src/features/wms/service";
import { cleanSerial, internalSerial, normalizeSerial, serialProblem } from "../src/features/wms/domain/serial";
import { canMove, conditionFromLegacy } from "../src/features/wms/domain/unit";
import { financialYear, nextPoNumber } from "../src/features/wms/domain/stock";

const admin: Actor = { name: "Bhavya", slackUserId: null, roles: ["admin"] };
const procurement: Actor = { name: "Anurag", slackUserId: null, roles: serviceRolesFor("inventory") };
const warehouse: Actor = { name: "Ravi (warehouse)", slackUserId: null, roles: serviceRolesFor("warehouse") };
const sales: Actor = { name: "Seller", slackUserId: null, roles: serviceRolesFor("sales") };

const SKU = "ep-dr-l50ultra";
const PHOTO = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

async function setup(): Promise<Wms> {
  const ops = new MemoryOpsStore({ products: [], movements: [], purchaseOrders: [] });
  await ops.upsertProducts([{ sku: SKU, name: "Dreame L50 Ultra", brand: "Dreame", category: "Robot vacuum", channel: "CnC", listPriceMinor: 8_999_900, gstRate: 18, hsn: "8508", eol: false, needsInstallation: true }]);
  return { ops, wms: new MemoryWmsStore() };
}

async function raisePo(ctx: Wms, qty = 10) {
  const po = await createPo(ctx, { poNumber: null, vendor: "Devi International", hub: "HSR HQ", billedTo: "Vivavilla", paymentTerms: "Net 30", priority: "normal", eta: "2026-11-25", notes: null, lines: [{ sku: SKU, qty, unitCostMinor: 4_500_000, ownership: "CnC" }] }, procurement, new Date("2026-11-20T10:00:00+05:30"));
  assert.ok(po.ok, po.ok ? "" : po.error);
  return po.value.poNumber;
}

const unit = (serial: string, extra: Partial<GrnItem> = {}): GrnItem => ({ sku: SKU, serial, serialSource: "scan", condition: "good", remark: null, photo: null, altId: null, ...extra });

test("serials: spaces, invisible characters and case don't make a new serial", () => {
  assert.equal(normalizeSerial(" dr-l50 ​0012 "), "DR-L500012");
  assert.equal(cleanSerial("﻿ 00123 "), "00123", "leading zeros stay");
  assert.equal(serialProblem("ab"), "That's too short for a serial number. Scan again.");
  assert.equal(serialProblem("SN 0001"), null);
  assert.equal(internalSerial(123), "EPK-U-000123");
  assert.equal(conditionFromLegacy("Average"), "box_damaged");
  assert.equal(conditionFromLegacy("BAD"), "damaged");
  assert.equal(conditionFromLegacy("GOOD"), "good");
  assert.equal(conditionFromLegacy("RTO"), "rto_returned");
  assert.ok(canMove("available", "reserved"));
  assert.equal(canMove("written_off", "available"), false);
});

test("PO numbers follow the team's format and India's financial year", () => {
  assert.equal(financialYear(new Date("2026-11-20T00:00:00Z")), "26-27");
  assert.equal(financialYear(new Date("2027-03-31T12:00:00Z")), "26-27");
  assert.equal(financialYear(new Date("2027-04-01T00:00:00+05:30")), "27-28");
  assert.equal(nextPoNumber(["PO-EPIK-26-27-0009", "PO-00247", "po-epik-26-27-0041"], new Date("2026-11-20")), "PO-EPIK-26-27-0042");
});

test("lists come filled the first time: hubs, billing entities, terms", async () => {
  const ctx = await setup();
  const masters = await ensureMasters(ctx);
  assert.ok(masters.some((m) => m.kind === "hub" && m.name === "HSR HQ"));
  assert.ok(masters.some((m) => m.kind === "billing_entity" && m.name === "Navkar"));
  assert.equal((await ensureMasters(ctx)).length, masters.length, "calling again adds nothing");
});

test("Phase 1 acceptance: PO for 10, receive 7 by scanning (duplicate blocked, one damaged with a photo), 7/10, find by serial, stock 7 at cost", async () => {
  const ctx = await setup();

  // Warehouse and Sales can't raise a PO; procurement can.
  assert.equal((await createPo(ctx, { poNumber: null, vendor: "Croma", hub: "HSR HQ", billedTo: null, paymentTerms: null, priority: "normal", eta: null, notes: null, lines: [{ sku: SKU, qty: 1, unitCostMinor: null, ownership: null }] }, warehouse)).ok, false);
  const poNumber = await raisePo(ctx);
  assert.equal(poNumber, "PO-EPIK-26-27-0001");

  // Scanning: each serial is checked as it is scanned.
  const batch: string[] = [];
  for (const s of ["L50-0001", "L50-0002", "L50-0003", "L50-0004", "L50-0005", "L50-0006", "L50-0007"]) {
    const check = await checkScan(ctx, { sku: SKU, serial: s, batch });
    assert.ok(check.ok, s);
    batch.push(s);
  }
  const twice = await checkScan(ctx, { sku: SKU, serial: " l50-0003 ", batch });
  assert.equal(twice.ok, false);
  assert.equal(twice.ok ? "" : twice.kind, "batch");

  // Sales can't receive.
  assert.equal((await submitGrn(ctx, { clientId: "receipt-0000001", poNumber, invoiceNo: "DI/2026/881", invoicePending: false, notes: null, items: batch.map((s) => unit(s)), counts: [] }, sales)).ok, false);
  // An invoice number is needed (or "not here yet").
  assert.equal((await submitGrn(ctx, { clientId: "receipt-0000001", poNumber, invoiceNo: null, invoicePending: false, notes: null, items: batch.map((s) => unit(s)), counts: [] }, warehouse)).ok, false);

  const items = batch.map((s, i) => (i === 6 ? unit(s, { condition: "damaged", photo: PHOTO, remark: "Box crushed on one side" }) : unit(s)));
  const grn = await submitGrn(ctx, { clientId: "receipt-0000001", poNumber, invoiceNo: "DI/2026/881", invoicePending: false, notes: null, items, counts: [] }, warehouse);
  assert.ok(grn.ok, grn.ok ? "" : grn.error);
  assert.match(grn.message, /GRN-00001 saved: 7 units received on PO-EPIK-26-27-0001\. 1 on hold/);

  // The same receipt saved again (double tap, retry) adds nothing.
  const again = await submitGrn(ctx, { clientId: "receipt-0000001", poNumber, invoiceNo: "DI/2026/881", invoicePending: false, notes: null, items: [unit("L50-0008")], counts: [] }, warehouse);
  assert.equal(again.ok, false);

  // A serial already in stock is blocked, on the scan and on save.
  const dup = await checkScan(ctx, { sku: SKU, serial: "L50-0002", batch: [] });
  assert.equal(dup.ok, false);
  assert.match(dup.ok ? "" : dup.reason, /Already in stock: received .* on GRN-00001/);
  assert.equal((await submitGrn(ctx, { clientId: "receipt-0000002", poNumber, invoiceNo: "DI/2026/882", invoicePending: false, notes: null, items: [unit("L50-0002")], counts: [] }, warehouse)).ok, false);

  // The PO shows 7 of 10.
  const view = (await poView(ctx, poNumber))!;
  assert.equal(view.lines[0].qtyReceived, 7);
  assert.equal(view.lines[0].pending, 3);
  assert.equal(view.units.length, 7);
  assert.equal(view.grns.length, 1);

  // Find a unit by scanning its serial (any case, with spaces).
  const hits = await search(ctx, " l50-0007 ");
  assert.equal(hits[0]?.kind, "unit");
  const detail = (await unitDetail(ctx, hits[0].href!.split("/").pop()!, admin))!;
  assert.equal(detail.unit.condition, "damaged");
  assert.equal(detail.unit.status, "quarantine");
  assert.equal(detail.photoUrls.length, 1);
  assert.equal(detail.unit.unitCostMinor, 4_500_000);
  assert.match(detail.events[0].text, /Received on GRN-00001 against PO-EPIK-26-27-0001, invoice DI\/2026\/881\. Damaged, kept on hold\./);
  // The warehouse doesn't see costs.
  assert.equal((await unitDetail(ctx, detail.unit.id, warehouse))!.unit.unitCostMinor, null);

  // Stock on hand: 7 units, 6 sellable, worth 7 × ₹45,000; the one stock ledger agrees.
  const stock = await stockOnHand(ctx, admin);
  assert.equal(stock.rows.length, 1);
  assert.equal(stock.rows[0].onHand, 7);
  assert.equal(stock.rows[0].available, 6);
  assert.equal(stock.rows[0].onHold, 1);
  assert.equal(stock.rows[0].valueMinor, 7 * 4_500_000);
  assert.equal(stock.rows[0].ledgerOnHand, 7);
  assert.equal((await ctx.ops.stockFor(SKU))!.onHand, 7);
  assert.equal((await stockOnHand(ctx, warehouse)).showCost, false);
});

test("more than the PO is refused; a product not on the PO is refused; no-barcode units get an EPIK serial", async () => {
  const ctx = await setup();
  const poNumber = await raisePo(ctx, 2);
  const tooMany = await submitGrn(ctx, { clientId: "receipt-1000001", poNumber, invoiceNo: "INV-1", invoicePending: false, notes: null, items: [unit("A-001"), unit("A-002"), unit("A-003")], counts: [] }, warehouse);
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.ok ? "" : tooMany.error, /3 scanned but only 2 still expected/);
  const wrong = await submitGrn(ctx, { clientId: "receipt-1000002", poNumber, invoiceNo: "INV-1", invoicePending: false, notes: null, items: [unit("A-001", { sku: "ep-xx-other" })], counts: [] }, warehouse);
  assert.equal(wrong.ok, false);

  const ok = await submitGrn(ctx, { clientId: "receipt-1000003", poNumber, invoiceNo: null, invoicePending: true, notes: null, items: [unit("A-001"), unit("", { serialSource: "internal" })], counts: [] }, warehouse);
  assert.ok(ok.ok, ok.ok ? "" : ok.error);
  const units = await ctx.wms.listUnits({ poNumber });
  assert.ok(units.some((u) => u.serial === "EPK-U-000001" && u.serialSource === "internal"));
  assert.equal((await poView(ctx, poNumber))!.lines[0].status, "closed", "fully received closes the line");
});

test("a serial already in stock from the team sheet, or dispatched before, is blocked", async () => {
  const ctx = await setup();
  await ctx.ops.addMovement({ sku: SKU, qty: 1, kind: "inward", refType: "sheet", refId: "row-4", serialNo: "SHEET-77", unitCostMinor: null, note: null, actor: "Team sheet" });
  await ctx.ops.addMovement({ sku: SKU, qty: 1, kind: "inward", refType: "sheet", refId: "row-5", serialNo: "SHEET-78", unitCostMinor: null, note: null, actor: "Team sheet" });
  await ctx.ops.addMovement({ sku: SKU, qty: -1, kind: "dispatch", refType: "sheet", refId: "row-6", serialNo: "SHEET-78", unitCostMinor: null, note: null, actor: "Team sheet" });
  const inStock = await checkScan(ctx, { sku: SKU, serial: "sheet-77", batch: [] });
  assert.equal(inStock.ok, false);
  assert.match(inStock.ok ? "" : inStock.reason, /team sheet/);
  const left = await checkScan(ctx, { sku: SKU, serial: "SHEET-78", batch: [] });
  assert.equal(left.ok, false);
  assert.equal(left.ok ? "" : left.kind, "left");
});

test("the Warehouse role: opens the warehouse screens, can receive, can't raise POs or see costs; menus show WMS only when on", async () => {
  const { menuFor, pathAllowed, APP_ROLE_HOME } = await import("../src/lib/app-roles");
  assert.equal(APP_ROLE_HOME.warehouse, "/wms");
  assert.ok(pathAllowed("warehouse", "/wms/receive/PO-1"));
  assert.ok(pathAllowed("inventory", "/wms"));
  assert.equal(pathAllowed("warehouse", "/settings"), false);
  assert.deepEqual(menuFor("warehouse").main.map((l) => l.href), ["/wms", "/wms/receive", "/logistics"]);
  assert.equal(menuFor("inventory").main.some((l) => l.href === "/wms"), false, "off: no Warehouse link");
  assert.ok(menuFor("inventory", { wms: true }).main.some((l) => l.href === "/wms"));
  const { wmsEnabled } = await import("../src/features/wms/switch");
  assert.equal(wmsEnabled({ APP_MODE: "demo" }), true);
  assert.equal(wmsEnabled({ APP_MODE: "live", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" }), false, "live: off by default");
  assert.equal(wmsEnabled({ APP_MODE: "live", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k", WMS: "on" }), true);
});

import assert from "node:assert/strict";
import test from "node:test";
import { pocRows, readSmbOrders, searchOrders, trackStatusOf } from "../src/lib/sheets/smb-orders";
import { accessGate } from "../src/lib/access";

const sheet: string[][] = [
  ["Fill one row per product", "", "", "", "", "", "", ""],
  ["Date", "Shopify Order", "Customer Name", "Phone Number", "Product", "POC", "Delivery Status", "Driver"],
  ["01-Nov-2026", "#PIK5001", "Asha Rao", "98450 11111", "Dreame L40", "Prasanth D - CDE", "EPIK_DELIVERED", "Ravi"],
  ["03-Nov-2026", "#PIK5002", "Vikram S", "9845022222", "iPhone 17", "prasanth d  - cde", "EPIK_OFD", "Manju"],
  ["03-Nov-2026", "#PIK5002", "Vikram S", "9845022222", "AppleCare", "prasanth d  - cde", "", ""],
  ["", "", "", "", "", "", "", ""],
  ["05-Nov-2026", "#PIK5003", "Meena K", "9845033333", "LG OLED 65", "Simon H", "waiting for stock", ""],
  ["06-Nov-2026", "", "Walk-in Ram", "9845044444", "Narwal Freo", "Simon H", "cancelled", ""],
];

test("Sales Masterbase rows: heading row found, one order per #PIK, newest first, blanks skipped", () => {
  const orders = readSmbOrders(sheet);
  assert.equal(orders.length, 4);
  assert.deepEqual(orders.map((o) => o.customer), ["Walk-in Ram", "Meena K", "Vikram S", "Asha Rao"]);
  const vikram = orders.find((o) => o.shopify === "#PIK5002")!;
  assert.deepEqual(vikram.products.map((p) => p.name), ["iPhone 17", "AppleCare"], "second product row joins the order");
  assert.equal(vikram.status, "out");
  assert.equal(vikram.driver, "Manju");
  assert.equal(vikram.row, 4, "row number as the sheet shows it");
});

test("statuses: team codes and plain words", () => {
  assert.equal(trackStatusOf("EPIK_DELIVERED"), "delivered");
  assert.equal(trackStatusOf("EPIK_OFD"), "out");
  assert.equal(trackStatusOf("Out for delivery"), "out");
  assert.equal(trackStatusOf("EPIK_CANCELLED"), "cancelled");
  assert.equal(trackStatusOf("WAITING_STOCK"), "waiting");
  assert.equal(trackStatusOf("CONFIRMED"), "ready");
  assert.equal(trackStatusOf("BRAND_DEL_CX"), "brand");
  assert.equal(trackStatusOf("EPIK_RTV"), "returns");
  assert.equal(trackStatusOf("NEW"), "new");
  assert.equal(trackStatusOf(""), "new");
  assert.equal(trackStatusOf("call customer"), "other");
});

test("names: one row per POC whatever the spelling, with open counts", () => {
  const rows = pocRows(readSmbOrders(sheet));
  assert.deepEqual(rows.map((r) => [r.name, r.total, r.open, r.delivered]), [
    ["Prasanth D - CDE", 2, 1, 1],
    ["Simon H", 2, 1, 0],
  ]);
});

test("search: customer name, last digits of the phone, or #PIK", () => {
  const orders = readSmbOrders(sheet);
  assert.deepEqual(searchOrders(orders, "meena").map((o) => o.shopify), ["#PIK5003"]);
  assert.deepEqual(searchOrders(orders, "1111").map((o) => o.customer), ["Asha Rao"]);
  assert.deepEqual(searchOrders(orders, "#PIK5002").map((o) => o.customer), ["Vikram S"]);
  assert.deepEqual(searchOrders(orders, "5002").map((o) => o.customer), ["Vikram S"]);
  assert.deepEqual(searchOrders(orders, "x"), [], "too short");
});

test("the tracking link opens without the access code on the live site", () => {
  const live = { mode: "live", accessCode: "a-long-code-123", cookie: undefined, personCookie: undefined };
  assert.equal(accessGate({ ...live, pathname: "/track/abcdefghijklmnop" }), "allow");
  assert.equal(accessGate({ ...live, pathname: "/track/abcdefghijklmnop/x" }), "challenge");
  assert.equal(accessGate({ ...live, pathname: "/logistics" }), "challenge");
});

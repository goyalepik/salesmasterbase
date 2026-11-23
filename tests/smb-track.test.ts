import assert from "node:assert/strict";
import test from "node:test";
import { isOpen, nameMatches, orderMatches, pocRows, readSmbOrders, trackStatusOf } from "../src/lib/sheets/smb-orders";
import { accessGate } from "../src/lib/access";

// The Sales Tracker shape: row 1 totals, row 2 headings (with the sheet's own spellings), one row per product.
const sheet: string[][] = [
  ["", "", "", "", "", "", "", "22,041,906.00", "", "", "", "", "Business Ops - Logistics ", "", ""],
  ["Shopify Order ID", "Invoice Date", "Customer Name", "Phone Number", "Product Name", "POC", "HUB", "Payment Status", "Logistic Status ", "Delivery Status", "Product Serial number", "Action Owner", "Action Owner's Remarks", "Dipatch Date", "Delivery date"],
  ["#PIK5001", "01/11/2026", "Asha Rao", "9845011111", "Dreame L40", "D Prasanth", "HQ", "Realized", "EPIK_DELIVERED", "Delivered, full payment received", "SN1", "", "", "02/11/2026", "04/11/2026"],
  ["#PIK5002", "03/11/2026", "Vikram S", "9845022222", "iPhone 17", "d prasanth ", "HQ", "Realized", "EPIK_INTRANSIT_CX", "Confirmed", "SN2", "", "", "05/11/2026", ""],
  ["#PIK5002", "03/11/2026", "Vikram S", "9845022222", "AppleCare", "d prasanth ", "HQ", "Realized", "EPIK_INTRANSIT_CX", "Confirmed", "", "", "", "", ""],
  ["", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
  ["#PIK5003", "05/11/2026", "Meena K", "9845033333", "LG OLED 65", "Baljeet Singh", "Hebbal", "Advance Payment", "EPIK_RTS_OUT", "Confirmed", "", "Harish K", "Stock not available. ETA 27-28 Nov", "", ""],
  ["#PIK5004", "06/11/2026", "Ram", "9845044444", "Narwal Freo", "Shopify direct", "HQ", "Realized", "CX_CANCELLED", "Cancelled", "", "", "", "", ""],
  ["#PIK5005", "07/11/2026", "Kiran", "9845055555", "Ecovacs T30", "Baljeet Singh", "HQ", "Realized", "", "inventory", "", "", "", "", ""],
];

test("Sales Tracker: headings on row 2, one order per #PIK, newest first, blanks skipped", () => {
  const orders = readSmbOrders(sheet);
  assert.deepEqual(orders.map((o) => o.shopify), ["#PIK5005", "#PIK5004", "#PIK5003", "#PIK5002", "#PIK5001"]);
  const vikram = orders.find((o) => o.shopify === "#PIK5002")!;
  assert.deepEqual(vikram.products.map((p) => p.name), ["iPhone 17", "AppleCare"]);
  assert.equal(vikram.status, "on_the_way", "Logistic Status wins over the older Delivery Status");
  assert.equal(vikram.dispatchedOn, "05/11/2026", "the sheet's 'Dipatch Date' spelling");
  assert.equal(vikram.id, "5002");
  const meena = orders.find((o) => o.shopify === "#PIK5003")!;
  assert.equal(meena.status, "waiting");
  assert.equal(meena.update, "Stock not available. ETA 27-28 Nov");
  assert.equal(meena.updateBy, "Harish K");
  assert.equal(orders.find((o) => o.shopify === "#PIK5005")!.status, "waiting", "empty Logistic Status falls back to Delivery Status");
});

test("statuses: every Logistic Status code in the SMB", () => {
  const cases: Array<[string, string]> = [
    ["NOT CONFIRMED", "not_confirmed"], ["CONFIRMED", "confirmed"], ["EPIK_RTS", "arranging"], ["EPIK-RTS-HUB", "arranging"],
    ["EPIK_RTS_OUT", "waiting"], ["EPIK_HUB", "hub"], ["EPIK_INTRANSIT_CX", "on_the_way"], ["EPIK_DELIVERED", "delivered"],
    ["BRAND_DEL_CX", "brand"], ["CX_CANCELLED", "cancelled"], ["EPIK_CANCELLED", "cancelled"],
  ];
  for (const [code, status] of cases) assert.equal(trackStatusOf(code), status, code);
  assert.equal(trackStatusOf("SOMETHING_NEW"), "other");
  assert.equal(isOpen("hub"), true);
  assert.equal(isOpen("delivered"), false);
});

test("names: one per CD whatever the spelling, website orders left out", () => {
  assert.deepEqual(pocRows(readSmbOrders(sheet)).map((r) => [r.name, r.total, r.open]), [
    ["Baljeet Singh", 2, 2],
    ["D Prasanth", 2, 1],
  ]);
});

test("typing to find a name: the start of any word, or the initials", () => {
  assert.ok(nameMatches("Baljeet Singh", "bal"));
  assert.ok(nameMatches("Baljeet Singh", "sin"));
  assert.ok(nameMatches("Baljeet Singh", "bs"));
  assert.ok(nameMatches("Baljeet Singh", "baljeet s"));
  assert.ok(nameMatches("Gowda Jyothi ramesh", "gjr"));
  assert.equal(nameMatches("Baljeet Singh", "pra"), false);
  assert.ok(nameMatches("Baljeet Singh", ""));
});

test("typing to find an order: customer, product, #PIK or phone", () => {
  const orders = readSmbOrders(sheet);
  const find = (q: string) => orders.filter((o) => orderMatches(o, q)).map((o) => o.shopify);
  assert.deepEqual(find("meena"), ["#PIK5003"]);
  assert.deepEqual(find("oled"), ["#PIK5003"]);
  assert.deepEqual(find("#PIK5002"), ["#PIK5002"]);
  assert.deepEqual(find("3333"), ["#PIK5003"]);
});

test("the tracking link opens without the access code on the live site", () => {
  const live = { mode: "live", accessCode: "a-long-code-123", cookie: undefined, personCookie: undefined };
  assert.equal(accessGate({ ...live, pathname: "/track/abcdefghijklmnop" }), "allow");
  assert.equal(accessGate({ ...live, pathname: "/track/abcdefghijklmnop/x" }), "challenge");
  assert.equal(accessGate({ ...live, pathname: "/logistics" }), "challenge");
});

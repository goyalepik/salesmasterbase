import assert from "node:assert/strict";
import test from "node:test";
import { isOpen, mergeOrders, nameMatches, orderMatches, personKey, pocKey, pocRows, readSmbOrders, stageCounts, trackStatusOf } from "../src/lib/sheets/smb-orders";
import { MemoryOpsStore } from "../src/lib/ops/memory-store";
import { createOrder, followSheetStatus, type Actor } from "../src/lib/ops/service";
import { serviceRolesFor } from "../src/lib/app-roles";

// New sales here skip the payment approval step, like orders from before it started.
process.env.PAYMENT_APPROVAL_FROM = "2099-01-01T00:00:00Z";
process.env.ORDER_STATUS_FROM = "2026-01-01";
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

test("names: one per CD whatever the spelling or role, website orders left out", () => {
  assert.deepEqual(pocRows(readSmbOrders(sheet)).map((r) => [r.name, r.total, r.open]), [
    ["Baljeet Singh", 2, 2],
    ["D Prasanth", 2, 1],
  ]);
  assert.equal(pocKey("Prasanth D - CDE"), pocKey("D Prasanth"));
  assert.equal(pocKey("Simon H - CDE ZONE MANAGER"), pocKey("simon h"));
  assert.notEqual(pocKey("M Prashanth"), pocKey("D Prasanth"));
  assert.equal(personKey("Bhuvana - Hub Manager (HSR HQ)", { bhuvana: "bhuvaneshwari" }), "bhuvaneshwari", "a spelling OpenAI matched");
  assert.deepEqual(stageCounts(readSmbOrders(sheet)), { starting: 0, stock: 2, moving: 1, delivered: 1 });
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

const sales: Actor = { name: "Sales desk", slackUserId: null, roles: serviceRolesFor("sales") };

async function appOrder(store: MemoryOpsStore, customerName: string, phone: string, poc: string, shopify: string | null) {
  const created = await createOrder(store, { source: "slack", customerName, phone, hub: "HQ", poc, declaredPaymentStatus: "Full paid", lines: [{ sku: null, productName: "Robot vacuum", listPriceMinor: null, offeredPriceMinor: 5_000_000 }] }, sales);
  assert.ok(created.ok);
  if (shopify) await store.updateOrder(created.value.id, { shopifyOrderId: shopify });
  return (await store.getOrder(created.value.id))!;
}

test("app orders and the SMB: each order once; today's Slack sale not yet in the SMB still shows", async () => {
  const store = new MemoryOpsStore();
  const inBoth = await appOrder(store, "Vikram S", "9845022222", "Prasanth D - CDE", "#PIK5002");
  let noPikYet = await appOrder(store, "Meena K", "+91 98450 33333", "Baljeet Singh", null);
  await store.updateOrder(noPikYet.id, { createdAt: "2026-11-05T09:00:00Z" });
  noPikYet = (await store.getOrder(noPikYet.id))!;
  const today = await appOrder(store, "New Customer", "9845099999", "Prasanth D - CDE", null);
  const merged = mergeOrders(readSmbOrders(sheet), [inBoth, noPikYet, today]);
  assert.equal(merged.length, 6, "5 from the SMB + 1 only in the app");
  const vikram = merged.filter((o) => o.customer === "Vikram S");
  assert.equal(vikram.length, 1);
  assert.equal(vikram[0].source, "both");
  assert.equal(vikram[0].status, "on_the_way", "the SMB's status wins");
  assert.equal(merged.filter((o) => o.customer === "Meena K").length, 1, "matched by phone when the app order has no #PIK");
  const fresh = merged.find((o) => o.customer === "New Customer")!;
  assert.equal(fresh.source, "app");
  assert.equal(fresh.status, "new");
  assert.equal(personKey(fresh.poc), pocKey("D Prasanth"), "same person as the SMB's D Prasanth");
});

test("the SMB status is copied onto the app's orders by #PIK, with the history; nothing else is touched", async () => {
  const store = new MemoryOpsStore();
  const out = await appOrder(store, "Vikram S", "9845022222", "D Prasanth", "#PIK5002");
  const done = await appOrder(store, "Asha Rao", "9845011111", "D Prasanth", "#PIK5001");
  const notInSheet = await appOrder(store, "Someone", "9845000000", "D Prasanth", "#PIK9999");
  const first = await followSheetStatus(store, readSmbOrders(sheet), "2026-01-01T00:00:00Z");
  assert.equal(first.moved.length, 2);
  assert.equal((await store.getOrder(out.id))!.stage, "out_for_delivery");
  const delivered = (await store.getOrder(done.id))!;
  assert.equal(delivered.stage, "delivered");
  assert.equal(delivered.deliveredAt?.slice(0, 10), "2026-11-04", "the SMB's delivery date");
  assert.equal((await store.getOrder(notInSheet.id))!.stage, notInSheet.stage);
  const again = await followSheetStatus(store, readSmbOrders(sheet), "2026-01-01T00:00:00Z");
  assert.equal(again.moved.length, 0, "running it again changes nothing");
});

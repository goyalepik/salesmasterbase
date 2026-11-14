import assert from "node:assert/strict";
import { test } from "node:test";
import { appRoleForPerson, menuFor, pathAllowed, roleCookieValue, roleFromCookie, serviceRolesFor } from "../src/lib/app-roles";
import { MemoryOpsStore } from "../src/lib/ops/memory-store";
import { canAct, createOrder, setDeliveryStatus } from "../src/lib/ops/service";

test("everyone can open every post-sales area; setup and the old RevOps screens stay Admin only", () => {
  for (const role of ["sales", "inventory"] as const) {
    for (const path of ["/post-sales", "/sales", "/orders/new", "/orders/EPK-000390", "/logistics", "/inventory", "/inventory/stock", "/procurement", "/dispatch", "/installations"]) {
      assert.ok(pathAllowed(role, path), `${role} can open ${path}`);
    }
    for (const path of ["/settings", "/system", "/revops", "/ops", "/orders/EPK-000390/full"]) {
      assert.equal(pathAllowed(role, path), false, `${role} cannot open ${path}`);
    }
  }
  assert.ok(pathAllowed("admin", "/settings"));
  assert.ok(pathAllowed("admin", "/orders/EPK-000390/full"));
});

test("the menu: own pages first, every area for everyone, setup under More for Admin", () => {
  assert.deepEqual(menuFor("sales").main.map((l) => l.label), ["My sales", "New sale"]);
  assert.deepEqual(menuFor("inventory").main.map((l) => l.label), ["Update status"]);
  assert.deepEqual(menuFor("sales").areas.map((l) => l.label), ["Sales and payment", "Order view", "Inventory view", "Logistics and installation"]);
  assert.equal(menuFor("sales").more.length, 0);
  assert.ok(menuFor("admin").more.some((l) => l.href === "/settings"));
});

test("the role cookie is signed: a hand-made one is ignored", () => {
  const secret = "a-long-access-code";
  assert.equal(roleFromCookie(secret, roleCookieValue(secret, "inventory")), "inventory");
  assert.equal(roleFromCookie(secret, "admin.0000"), null);
  assert.equal(roleFromCookie("another-code", roleCookieValue(secret, "admin")), null);
  assert.equal(roleFromCookie(secret, undefined), null);
});

test("a Team roles person maps to one simple role", () => {
  assert.equal(appRoleForPerson(["admin", "sales"]), "admin");
  assert.equal(appRoleForPerson(["logistics"]), "inventory");
  assert.equal(appRoleForPerson(["revops"]), "sales");
});

test("the server checks the role: Sales can't change a status, Inventory can", async () => {
  const s = new MemoryOpsStore({ products: [], movements: [], purchaseOrders: [] });
  const created = await createOrder(s, { source: "desk", customerName: "Ravi", phone: "9845012345", hub: "HQ", poc: "Ibrahim", lines: [{ sku: null, productName: "Fan", listPriceMinor: null, offeredPriceMinor: 500_000 }] }, { name: "Desk", slackUserId: null });
  assert.ok(created.ok);
  const sales = { name: "Seller", slackUserId: null, roles: serviceRolesFor("sales") };
  const inventory = { name: "Stock", slackUserId: null, roles: serviceRolesFor("inventory") };
  assert.equal(await canAct(s, sales, "inventory"), false);
  const refused = await setDeliveryStatus(s, created.value.id, { status: "ready", note: null, expectedDate: null, driver: null }, sales);
  assert.equal(refused.ok, false);
  const done = await setDeliveryStatus(s, created.value.id, { status: "ready", note: null, expectedDate: null, driver: null }, inventory);
  assert.ok(done.ok);
});

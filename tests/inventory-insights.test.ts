import assert from "node:assert/strict";
import { test } from "node:test";
import { inventoryInsights } from "../src/lib/ops-ui/inventory-insights";
import type { OrderSummary, PurchaseOrder, StockLevel } from "../src/lib/ops/types";

const level = (sku: string, onHand: number, reserved: number, incoming = 0, cost = 1_000_000, brand = "Dreame"): StockLevel => ({
  sku, name: `Product ${sku}`, brand, category: null, channel: null, onHand, reserved, available: onHand - reserved, incoming, nextEta: null, unitCostMinor: cost,
});

const order = (id: string, sku: string, qty = 1, stage: OrderSummary["stage"] = "awaiting_inventory", status: "pending" | "reserved" = "pending") =>
  ({ id, stage, lines: [{ id: `${id}-1`, sku, productName: `Product ${sku}`, qty, status }] }) as unknown as OrderSummary;

const po = (sku: string, eta: string, vendor = "Value-One"): PurchaseOrder =>
  ({ id: `po-${sku}`, poNumber: "PO-1", sku, vendor, eta, status: "open", qtyOrdered: 5, qtyReceived: 0 }) as unknown as PurchaseOrder;

test("flags paid orders short of free stock, worst first", () => {
  const items = inventoryInsights({
    stock: [level("a", 1, 1), level("b", 5, 0)],
    waiting: [order("o1", "a", 2), order("o2", "b", 1)],
    recent: [],
    pos: [],
    procurement: [],
    todayIso: "2026-11-01",
  });
  assert.equal(items[0]!.tone, "bad");
  assert.match(items[0]!.title, /^2 units short/);
  assert.match(items[0]!.detail, /Product a/);
});

test("flags late POs, low fast sellers and idle stock", () => {
  const items = inventoryInsights({
    stock: [level("fast", 1, 0), level("idle", 4, 0, 0, 5_000_000)],
    waiting: [],
    recent: [order("r1", "fast", 3, "delivered", "reserved"), order("r2", "fast", 2, "delivered", "reserved")],
    pos: [po("x", "2026-10-20")],
    procurement: [],
    todayIso: "2026-11-01",
  });
  const titles = items.map((i) => i.title).join(" | ");
  assert.match(titles, /PO line past the expected date/);
  assert.match(titles, /fast seller running low/);
  assert.match(titles, /no sale in 30 days/);
});

test("says all clear when nothing needs attention", () => {
  const items = inventoryInsights({ stock: [], waiting: [], recent: [], pos: [], procurement: [], todayIso: "2026-11-01" });
  assert.deepEqual(items.map((i) => i.tone), ["good"]);
});

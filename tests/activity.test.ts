import assert from "node:assert/strict";
import { test } from "node:test";
import { istMidnight, rangeBounds, summariseActivity } from "../src/lib/ops-ui/activity";
import type { StockMovement } from "../src/lib/ops/types";

const move = (id: string, createdAt: string, qty: number, patch: Partial<StockMovement> = {}): StockMovement => ({
  id, sku: "ep-x", qty, kind: qty > 0 ? "inward" : "dispatch", refType: null, refId: null, serialNo: null, unitCostMinor: null, note: null, actor: "Piyush", createdAt, ...patch,
});

test("today starts at IST midnight", () => {
  // 12 Nov 2026, 01:00 IST is 11 Nov 19:30 UTC.
  assert.equal(istMidnight(new Date("2026-11-11T19:30:00Z")).toISOString(), "2026-11-11T18:30:00.000Z");
  const week = rangeBounds("week", new Date("2026-11-12T06:00:00Z"));
  assert.equal(week.from.toISOString(), "2026-11-05T18:30:00.000Z");
  assert.equal(week.to.toISOString(), "2026-11-12T18:30:00.000Z");
});

test("activity: hours in IST, in and out counted apart, opening and other days ignored", () => {
  const now = new Date("2026-11-12T10:00:00Z"); // 15:30 IST
  const s = summariseActivity(
    [
      move("a", "2026-11-12T04:00:00Z", 3), // 09:30 IST
      move("b", "2026-11-12T04:20:00Z", -1, { refType: "order", refId: "EPK-1" }),
      move("c", "2026-11-12T09:00:00Z", -2, { refType: "order", refId: "EPK-2" }), // 14:30 IST
      move("d", "2026-11-12T09:10:00Z", 1, { kind: "return" }),
      move("e", "2026-11-11T10:00:00Z", 5), // yesterday
      move("f", "2026-11-12T05:00:00Z", 100, { kind: "opening" }),
    ],
    "today",
    now,
  );
  assert.equal(s.buckets.length, 24);
  assert.deepEqual([s.buckets[9].in, s.buckets[9].out, s.buckets[14].in, s.buckets[14].out], [3, 1, 1, 2]);
  assert.deepEqual([s.unitsIn, s.unitsOut, s.ordersOut, s.productsIn], [4, 3, 2, 1]);
  assert.deepEqual(s.byKindIn, [["Stock in", 3], ["Customer return", 1]]);
  assert.equal(summariseActivity([move("e", "2026-11-11T10:00:00Z", 5)], "week", now).buckets[5].in, 5);
});

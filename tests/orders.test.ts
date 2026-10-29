import assert from "node:assert/strict";
import test from "node:test";
import { buildDemoState } from "../src/lib/demo/dataset";
import { MemoryRepository } from "../src/lib/memory-repository";
import { countIstDay, isThreadReply, readCompleteOrder } from "../src/lib/orders";

const query = { q: "", status: "all" as const, channel: "", from: "", to: "", page: 1, pageSize: 50, view: "orders" as const };

test("a thread reply is not a separate inbox row", async () => {
  const now = new Date("2026-10-28T18:00:00+05:30");
  const repo = new MemoryRepository(buildDemoState(now));
  const page = await repo.listMessages(query);
  assert.equal(page.items.some((row) => row.id.endsWith("018")), false);
  const order = page.items.find((row) => row.id.endsWith("017"));
  assert.ok(order);
  assert.equal(order.threadUpdateCount, 1);
  assert.equal(order.customerName, "Sample Person");
  const replies = await repo.listThreadReplies(order.channelId, "1710000017.000100");
  assert.equal(replies.length, 1);
  assert.match(replies[0]?.preview ?? "", /advance/i);
});

test("customer lookup matches a name or product and omits the phone", async () => {
  const repo = new MemoryRepository(buildDemoState(new Date("2026-10-28T18:00:00+05:30")));
  const byName = await repo.lookupCustomers("Sample Person");
  const byProduct = await repo.lookupCustomers("sofa");
  const byPhone = await repo.lookupCustomers("9000000000");
  assert.equal(byName.some((group) => group.customerName === "Sample Person"), true);
  assert.equal(byProduct.some((group) => group.orders.some((order) => order.product === "Sample sofa")), true);
  assert.equal(byPhone.length, 0);
  const serialized = JSON.stringify(byName);
  assert.equal(serialized.includes("9000000000"), false);
  assert.equal(serialized.includes("sample.person@example.com"), false);
  assert.equal(byName[0]?.orders[0]?.threadUpdates, 1);
});

test("today counts order sheets and thread advances without summing money", () => {
  const now = new Date("2026-10-28T18:00:00+05:30");
  const counts = countIstDay([
    {
      text: "Name - A\nProduct - Chair\nOffered price - 1000",
      threadTs: "1",
      slackMessageTs: "1",
      eventReceivedAt: "2026-10-28T10:00:00+05:30",
    },
    {
      text: "10000 advance received",
      threadTs: "1",
      slackMessageTs: "2",
      eventReceivedAt: "2026-10-28T11:00:00+05:30",
    },
    {
      text: "Name - Yesterday\nProduct - Desk\nPrice - 2000",
      threadTs: null,
      slackMessageTs: "3",
      eventReceivedAt: "2026-10-27T11:00:00+05:30",
    },
  ], 4, now);
  assert.equal(counts.orderSheets, 1);
  assert.equal(counts.offeredMinor, 100000);
  assert.equal(counts.threadAdvances, 1);
  assert.equal(counts.waitingForReview, 4);
  assert.equal(isThreadReply("1", "1"), false);
  assert.equal(isThreadReply("1", "2"), true);
});

test("a free-text line is not an order, and a repeated customer and product counts once", () => {
  assert.equal(readCompleteOrder("Vishu - I phone 15 128 gb blue - offered ₹59,400"), null);
  const counts = countIstDay([
    {
      text: "Name - Alok\nProduct - iPhone\nOffered price - 59400",
      threadTs: "1",
      slackMessageTs: "1",
      eventReceivedAt: "2026-10-28T10:00:00+05:30",
    },
    {
      text: "Name - Alok\nProduct - iPhone\nOffered price - 60000",
      threadTs: "2",
      slackMessageTs: "2",
      eventReceivedAt: "2026-10-28T12:00:00+05:30",
    },
    {
      text: "Wait",
      threadTs: null,
      slackMessageTs: "3",
      eventReceivedAt: "2026-10-28T13:00:00+05:30",
    },
  ], 0, new Date("2026-10-28T18:00:00+05:30"));
  assert.equal(counts.orderSheets, 1);
  assert.equal(counts.offeredMinor, 6000000);
});

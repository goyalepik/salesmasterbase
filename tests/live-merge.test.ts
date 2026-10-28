import assert from "node:assert/strict";
import test from "node:test";
import { attachLiveSource, mergeInboxRows, nextConnection, shouldSubscribe, type LiveSource } from "../src/lib/live/merge";
import type { InboxRow, MessageQuery } from "../src/lib/types";

const query: MessageQuery = { q: "", status: "all", channel: "", from: "", to: "", page: 1, pageSize: 2 };

function row(id: string, text = "hello"): InboxRow {
  return {
    id,
    eventReceivedAt: `2026-10-28T${id.padStart(2, "0")}:00:00.000Z`,
    channelId: "C1",
    channelName: "#epik_cd-payment-updates",
    senderId: "U1",
    senderName: null,
    text,
    preview: text,
    customerName: null,
    orderReference: null,
    processingStatus: "processed",
    review: "clear",
  };
}

test("merges a new row, replaces duplicates, and respects pagination", () => {
  const first = row("01", "alpha");
  const second = row("02", "beta");
  const inserted = mergeInboxRows([second, first], row("03", "gamma"), query);
  assert.deepEqual(inserted.items.map((item) => item.id), ["03", "02"]);
  assert.equal(inserted.totalDelta, 1);

  const updated = mergeInboxRows(inserted.items, { ...row("03", "gamma"), processingStatus: "needs_review", review: "required" }, query);
  assert.equal(updated.items.length, 2);
  assert.equal(updated.totalDelta, 0);
  assert.equal(updated.items[0]?.processingStatus, "needs_review");

  const filtered = mergeInboxRows(updated.items, row("04", "hidden"), { ...query, q: "nope" });
  assert.equal(filtered.totalDelta, 0);
  assert.equal(filtered.items.length, 2);

  const laterPage = mergeInboxRows([first], row("05"), { ...query, page: 2 });
  assert.equal(laterPage.items.length, 1);
  assert.equal(laterPage.totalDelta, 1);
});

test("subscription listeners are removed on close", () => {
  const listeners = new Map<string, Set<(event: { data: string }) => void>>();
  let closed = false;
  const source: LiveSource = {
    addEventListener(type, listener) {
      const bucket = listeners.get(type) ?? new Set();
      bucket.add(listener);
      listeners.set(type, bucket);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    close() {
      closed = true;
    },
  };
  const seen: string[] = [];
  const binding = attachLiveSource(source, {
    onStatus(status) { seen.push(status); },
    onChange() {},
  });
  const statusListeners = listeners.get("status");
  assert.equal(statusListeners?.size, 1);
  statusListeners?.forEach((listener) => listener({ data: JSON.stringify({ status: "SUBSCRIBED" }) }));
  assert.deepEqual(seen, ["SUBSCRIBED"]);
  binding.close();
  assert.equal(closed, true);
  assert.equal(listeners.get("status")?.size, 0);
  assert.equal(listeners.get("change")?.size, 0);
});

test("connection state and demo subscription policy", () => {
  assert.equal(shouldSubscribe("demo"), false);
  assert.equal(shouldSubscribe("blocked"), false);
  assert.equal(shouldSubscribe("live"), true);
  assert.equal(nextConnection("connecting", "subscribed"), "on");
  assert.equal(nextConnection("on", "error"), "reconnecting");
  assert.equal(nextConnection("reconnecting", "channel_error"), "unavailable");
  assert.equal(nextConnection("on", "closed"), "offline");
});

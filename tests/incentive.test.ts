import assert from "node:assert/strict";
import test from "node:test";
import { founderBrief } from "../src/lib/ai/brief";
import { lastDaysBounds } from "../src/lib/format";
import { incentiveBySender, type SenderActivity } from "../src/lib/incentive";

function row(partial: Partial<SenderActivity> & Pick<SenderActivity, "id" | "text">): SenderActivity {
  return {
    senderId: "UDEMO01",
    senderName: "Sample associate",
    threadTs: null,
    slackMessageTs: partial.id,
    processingStatus: "processed",
    eventReceivedAt: "2026-10-28T10:00:00+05:30",
    ...partial,
  };
}

test("offered price uses order sheets from the supplied window and ignores a thread advance", () => {
  const people = incentiveBySender([
    row({
      id: "sheet",
      text: "Name - Sample Person\nProduct - Sample sofa\nOffered price - 69900",
      threadTs: "sheet",
      slackMessageTs: "sheet",
    }),
    row({
      id: "advance",
      senderId: "UDEMO01",
      text: "Kindly note 10000 advance received",
      threadTs: "sheet",
      slackMessageTs: "advance",
    }),
  ]);
  assert.equal(people.length, 1);
  assert.equal(people[0]?.name, "Sample associate");
  assert.equal(people[0]?.orders, 1);
  assert.equal(people[0]?.offeredMinor, 6990000);
  assert.equal(people[0]?.messages, 2);
});

test("a Slack id can be replaced with the salesperson name", () => {
  const people = incentiveBySender([
    row({ id: "1", senderId: "U0BK9T4SSM7", senderName: null, text: "Name - A\nProduct - Chair\nOffered price - 1000" }),
  ], { U0BK9T4SSM7: "Asha" });
  assert.equal(people[0]?.name, "Asha");
  assert.equal(people[0]?.slackId, "U0BK9T4SSM7");
});

test("the last 5 days start four IST midnights before today", () => {
  const bounds = lastDaysBounds(new Date("2026-10-28T22:00:00+05:30"), 5);
  assert.equal(bounds.start.toISOString(), new Date("2026-10-24T00:00:00+05:30").toISOString());
  assert.equal(bounds.end.toISOString(), new Date("2026-10-29T00:00:00+05:30").toISOString());
});

test("a missing salesperson name is called out instead of a data dump", () => {
  const text = founderBrief({
    kind: "contributors",
    messages: 12,
    paymentMentions: 0,
    paymentsWithAmount: 0,
    missingCustomer: 0,
    needsReview: 0,
    openItems: 0,
    topName: null,
    topOrders: 0,
    unnamedSenders: 3,
  });
  assert.match(text, /See, this is what I found/);
  assert.match(text, /This is not organized/);
  assert.match(text, /give me each salesperson's name/);
  assert.equal(text.includes("Processed:"), false);
});

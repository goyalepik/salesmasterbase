import assert from "node:assert/strict";
import test from "node:test";
import { MemoryRepository, type MemoryState } from "../src/lib/memory-repository";
import { decideProcessing } from "../src/lib/parse/decide";
import { processStoredMessage } from "../src/lib/process-message";
import type { InboundDraft } from "../src/lib/types";

function empty(): MemoryState {
  return { messages: [], extractions: [], exceptions: [], attempts: [], audit: [], channels: [] };
}

function draft(text: string, ts: string): InboundDraft {
  return {
    slackTeamId: "T1",
    slackChannelId: "CDEMO0001",
    slackChannelName: "#epik_cd-payment-updates",
    slackMessageTs: ts,
    slackEventId: `Ev${ts}`,
    senderId: "U1",
    senderName: null,
    text,
    threadTs: null,
    permalink: null,
    subtype: null,
    botId: null,
    eventReceivedAt: new Date().toISOString(),
    sourceMetadata: { team_id: "T1" },
  };
}

test("creates a missing-information exception and keeps the original text", async () => {
  const repo = new MemoryRepository(empty());
  const inserted = await repo.insertInbound(draft("Payment received for DEMO-1002, customer: Rohan Desai.", "1.1"));
  assert.equal(inserted.ok, true);
  if (!inserted.ok) return;
  const outcome = await processStoredMessage(repo, inserted.message.id, { monitoredChannelId: "CDEMO0001" });
  assert.equal(outcome, "needs_review");
  assert.equal(repo.snapshot().messages[0]?.text, "Payment received for DEMO-1002, customer: Rohan Desai.");
  assert.equal(repo.snapshot().exceptions.some((item) => item.type === "missing_info" && item.status === "open"), true);
  assert.equal(repo.snapshot().extractions[0]?.verification, "unverified");
  assert.equal(repo.snapshot().extractions[0]?.amountMinor, null);
});

test("flags ambiguous amounts, duplicates, and conflicts", () => {
  const ambiguous = decideProcessing({
    text: "Customer: Meera Shah. DEMO-1003 advance ₹10,000 and balance ₹32,500 via NEFT.",
    subtype: null,
    botId: null,
    channelId: "C1",
    monitoredChannelId: "C1",
    related: [],
  });
  assert.equal(ambiguous.exceptions.some((item) => item.type === "ambiguous_amount"), true);
  assert.equal(ambiguous.extraction?.amountMinor, null);

  const duplicate = decideProcessing({
    text: "Customer: Asha Iyer. Order DEMO-1001. Razorpay ₹48,500.",
    subtype: null,
    botId: null,
    channelId: "C1",
    monitoredChannelId: "C1",
    related: [{ messageId: "m1", orderReference: "DEMO-1001", amountMinor: 4850000, receivedAt: "2026-10-28T00:00:00.000Z" }],
  });
  assert.equal(duplicate.exceptions.some((item) => item.type === "potential_duplicate"), true);

  const conflict = decideProcessing({
    text: "Customer: Asha Iyer. Order DEMO-1001. Collected ₹40,000 on UPI.",
    subtype: null,
    botId: null,
    channelId: "C1",
    monitoredChannelId: "C1",
    related: [{ messageId: "m1", orderReference: "DEMO-1001", amountMinor: 4850000, receivedAt: "2026-10-28T00:00:00.000Z" }],
  });
  assert.equal(conflict.exceptions.some((item) => item.type === "conflicting_info"), true);
});

test("reads a labelled order sheet and keeps the phone out of the summary", () => {
  const decision = decideProcessing({
    text: "Name - Sample Person\nMobile number - 9000000000\nGmail - sample@example.com\nProduct I phone 15 256 gb black\nPrice 69900\nOffered price 69900\nCustomer type new\nplease creat order for snapmint",
    subtype: null,
    botId: null,
    channelId: "C1",
    monitoredChannelId: "C1",
    related: [],
  });
  assert.equal(decision.status, "processed");
  assert.equal(decision.extraction?.customerName, "Sample Person");
  assert.equal(decision.extraction?.amountMinor, 6990000);
  assert.equal(decision.extraction?.intent, "order_update");
  assert.equal(decision.extraction?.preview.includes("9000000000"), false);
  assert.equal(decision.extraction?.preview.includes("sample@example.com"), false);
  assert.match(decision.extraction?.preview ?? "", /I phone 15/);
});

test("a thread advance is attached to the parent order", async () => {
  const repo = new MemoryRepository(empty());
  const parent = await repo.insertInbound({ ...draft("Name - Sample Person\nProduct Phone\nPrice 69900\nOffered price 69900", "10.1"), threadTs: null });
  const reply = await repo.insertInbound({ ...draft("Kindly note 10000 advance received", "10.2"), slackMessageTs: "10.2", threadTs: "10.1" });
  assert.equal(parent.ok && reply.ok, true);
  if (!parent.ok || !reply.ok) return;
  await processStoredMessage(repo, parent.message.id, { monitoredChannelId: "CDEMO0001" });
  await processStoredMessage(repo, reply.message.id, { monitoredChannelId: "CDEMO0001" });
  const storedParent = repo.snapshot().messages.find((item) => item.id === parent.message.id);
  assert.equal(storedParent?.processingStatus, "needs_review");
  assert.equal(repo.snapshot().exceptions.some((item) => item.messageId === parent.message.id && item.reason.includes("advance")), true);
});

test("records a processing failure and succeeds on a bounded retry", async () => {
  const repo = new MemoryRepository(empty());
  let failures = 0;
  const original = repo.complete.bind(repo);
  repo.complete = async (id, result) => {
    failures += 1;
    if (failures === 1) throw new Error("The extraction could not be saved.");
    return original(id, result);
  };
  const inserted = await repo.insertInbound(draft("Customer: Leela Krishnan. Order DEMO-1006. Received ₹22,000 on UPI.", "2.2"));
  assert.equal(inserted.ok, true);
  if (!inserted.ok) return;
  const failed = await processStoredMessage(repo, inserted.message.id, { monitoredChannelId: "CDEMO0001" });
  assert.equal(failed, "failed");
  assert.equal(repo.snapshot().messages[0]?.processingStatus, "failed");
  assert.equal(repo.snapshot().messages[0]?.retryCount, 1);
  assert.equal(repo.snapshot().attempts[0]?.outcome, "failure");

  const retried = await processStoredMessage(repo, inserted.message.id, { monitoredChannelId: "CDEMO0001" });
  assert.equal(retried, "processed");
  assert.equal(repo.snapshot().messages[0]?.processingStatus, "processed");
  assert.equal(repo.snapshot().messages[0]?.text.includes("DEMO-1006"), true);

  repo.snapshot().messages[0]!.processingStatus = "failed";
  repo.snapshot().messages[0]!.retryCount = 5;
  const exhausted = await processStoredMessage(repo, inserted.message.id, { monitoredChannelId: "CDEMO0001" });
  assert.equal(exhausted, "exhausted");
});

test("a Slack retry of a failed message processes it once", async () => {
  const { handleSlackEvent } = await import("../src/lib/slack/handle-event");
  const { createHmac } = await import("node:crypto");
  const secret = "test-signing-secret";
  const now = 1_710_000_000;
  const repo = new MemoryRepository(empty());
  let failures = 0;
  const original = repo.complete.bind(repo);
  repo.complete = async (id, result) => {
    failures += 1;
    if (failures === 1) throw new Error("temporary write failure");
    return original(id, result);
  };
  const payload = {
    type: "event_callback",
    event_id: "EvRetry",
    event_time: now,
    event: { type: "message", channel: "CDEMO0001", user: "U1", text: "Customer: Leela Krishnan. Order DEMO-1006. UPI ₹22,000.", ts: "171.900" },
  };
  const rawBody = JSON.stringify(payload);
  const signature = `v0=${createHmac("sha256", secret).update(`v0:${now}:${rawBody}`).digest("hex")}`;
  const send = async (retryNum: string | null) => {
    const tasks: Array<() => Promise<void>> = [];
    const response = await handleSlackEvent({
      rawBody,
      timestamp: String(now),
      signature,
      retryNum,
      retryReason: retryNum ? "http_timeout" : null,
      env: { mode: "live", signingSecret: secret, monitoredChannelId: "CDEMO0001", channelName: null },
      repo,
      schedule(task) { tasks.push(task); },
      nowSeconds: now,
    });
    for (const task of tasks) await task();
    return response;
  };
  assert.equal((await send(null)).status, 200);
  assert.equal(repo.snapshot().messages[0]?.processingStatus, "failed");
  assert.equal((await send("1")).status, 200);
  assert.equal(repo.snapshot().messages.length, 1);
  assert.equal(repo.snapshot().messages[0]?.processingStatus, "processed");
  assert.equal(repo.snapshot().audit.some((entry) => entry.action === "retry_performed"), true);
});

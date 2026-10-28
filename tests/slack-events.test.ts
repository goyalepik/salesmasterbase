import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { MemoryRepository, type MemoryState } from "../src/lib/memory-repository";
import { handleSlackEvent, type SlackHandlerEnv } from "../src/lib/slack/handle-event";

const secret = "test-signing-secret";
const now = 1_710_000_000;

function empty(): MemoryState {
  return { messages: [], extractions: [], exceptions: [], attempts: [], audit: [], channels: [] };
}

function sign(rawBody: string, timestamp = String(now)): string {
  const digest = createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex");
  return `v0=${digest}`;
}

const env: SlackHandlerEnv = {
  mode: "live",
  signingSecret: secret,
  monitoredChannelId: "CDEMO0001",
  channelName: "#epik_cd-payment-updates",
};

async function post(repo: MemoryRepository, payload: unknown, headers: { retryNum?: string; retryReason?: string; signature?: string; timestamp?: string } = {}) {
  const tasks: Array<() => Promise<void>> = [];
  const rawBody = JSON.stringify(payload);
  const timestamp = headers.timestamp ?? String(now);
  const response = await handleSlackEvent({
    rawBody,
    timestamp,
    signature: headers.signature ?? sign(rawBody, timestamp),
    retryNum: headers.retryNum ?? null,
    retryReason: headers.retryReason ?? null,
    env,
    repo,
    schedule(task) {
      tasks.push(task);
    },
    nowSeconds: now,
  });
  for (const task of tasks) await task();
  return response;
}

test("answers a Slack URL verification challenge", async () => {
  const repo = new MemoryRepository(empty());
  const response = await post(repo, { type: "url_verification", challenge: "challenge-token" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { challenge: "challenge-token" });
  assert.equal(repo.snapshot().messages.length, 0);
});

test("rejects a challenge with an invalid signature", async () => {
  const repo = new MemoryRepository(empty());
  const response = await post(repo, { type: "url_verification", challenge: "challenge-token" }, { signature: "v0=bad" });
  assert.equal(response.status, 401);
});

test("rejects malformed and incomplete requests", async () => {
  const repo = new MemoryRepository(empty());
  const tasks: Array<() => Promise<void>> = [];
  const rawBody = "{";
  const broken = await handleSlackEvent({
    rawBody,
    timestamp: String(now),
    signature: sign(rawBody),
    retryNum: null,
    retryReason: null,
    env,
    repo,
    schedule(task) { tasks.push(task); },
    nowSeconds: now,
  });
  assert.equal(broken.status, 400);

  const missing = await post(repo, { type: "event_callback", event_id: "Ev1", event: { type: "message", text: "hello" } });
  assert.equal(missing.status, 400);
  assert.equal(repo.snapshot().messages.length, 0);
});

test("stores one message when Slack delivers the same event twice", async () => {
  const repo = new MemoryRepository(empty());
  const payload = {
    type: "event_callback",
    team_id: "T1",
    event_id: "Ev100",
    event_time: now,
    event: { type: "message", channel: "CDEMO0001", user: "U1", text: "Customer: Asha Iyer. Order DEMO-1001. Payment of ₹48,500 via Razorpay.", ts: "171.100" },
  };
  const first = await post(repo, payload);
  const second = await post(repo, payload, { retryNum: "1", retryReason: "http_timeout" });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.headers.get("x-slack-no-retry"), "1");
  assert.equal(repo.snapshot().messages.length, 1);
  assert.equal(repo.snapshot().messages[0]?.processingStatus, "processed");
  assert.equal(repo.snapshot().extractions[0]?.verification, "unverified");
  assert.equal(repo.snapshot().messages[0]?.text.includes("₹48,500"), true);
});

test("returns 500 when the database write fails and does not claim success", async () => {
  const repo = new MemoryRepository(empty());
  repo.insertInbound = async () => ({ ok: false, error: "connection refused" });
  const response = await post(repo, {
    type: "event_callback",
    event_id: "Ev500",
    event_time: now,
    event: { type: "message", channel: "CDEMO0001", user: "U1", text: "Payment ₹10 for DEMO-9", ts: "171.500" },
  });
  assert.equal(response.status, 500);
  assert.equal(repo.snapshot().messages.length, 0);
});

test("skips an unsupported message subtype without dropping the event", async () => {
  const repo = new MemoryRepository(empty());
  const response = await post(repo, {
    type: "event_callback",
    event_id: "EvJoin",
    event_time: now,
    event: { type: "message", subtype: "channel_join", channel: "CDEMO0001", user: "U1", text: "joined", ts: "171.600" },
  });
  assert.equal(response.status, 200);
  assert.equal(repo.snapshot().messages.length, 1);
  assert.equal(repo.snapshot().messages[0]?.processingStatus, "skipped");
  assert.equal(repo.snapshot().messages[0]?.skipReason, "channel_join");
  assert.equal(repo.snapshot().exceptions.length, 0);
});

test("does not ingest while demo mode is selected", async () => {
  const repo = new MemoryRepository(empty());
  const rawBody = JSON.stringify({ type: "url_verification", challenge: "nope" });
  const response = await handleSlackEvent({
    rawBody,
    timestamp: String(now),
    signature: sign(rawBody),
    retryNum: null,
    retryReason: null,
    env: { ...env, mode: "demo" },
    repo,
    schedule() {},
    nowSeconds: now,
  });
  assert.equal(response.status, 503);
  assert.equal(repo.snapshot().messages.length, 0);
});

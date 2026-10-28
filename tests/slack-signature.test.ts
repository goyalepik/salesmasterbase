import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { verifySlackSignature } from "../src/lib/slack/signature";

const secret = "test-signing-secret";
const body = '{"type":"url_verification","challenge":"abc"}';
const timestamp = "1710000000";

function sign(rawBody: string, sentAt: string, signingSecret = secret): string {
  const digest = createHmac("sha256", signingSecret).update(`v0:${sentAt}:${rawBody}`).digest("hex");
  return `v0=${digest}`;
}

test("accepts a valid Slack signature", () => {
  const result = verifySlackSignature({
    signingSecret: secret,
    rawBody: body,
    timestamp,
    signature: sign(body, timestamp),
    nowSeconds: Number(timestamp) + 10,
  });
  assert.deepEqual(result, { ok: true });
});

test("rejects an invalid Slack signature", () => {
  const result = verifySlackSignature({
    signingSecret: secret,
    rawBody: body,
    timestamp,
    signature: sign(body, timestamp, "other-secret"),
    nowSeconds: Number(timestamp) + 10,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "invalid_signature");
});

test("rejects a stale timestamp and a missing signature", () => {
  const stale = verifySlackSignature({
    signingSecret: secret,
    rawBody: body,
    timestamp,
    signature: sign(body, timestamp),
    nowSeconds: Number(timestamp) + 60 * 10,
  });
  assert.equal(stale.ok, false);
  const missing = verifySlackSignature({
    signingSecret: secret,
    rawBody: body,
    timestamp: null,
    signature: null,
    nowSeconds: Number(timestamp),
  });
  assert.equal(missing.ok, false);
});

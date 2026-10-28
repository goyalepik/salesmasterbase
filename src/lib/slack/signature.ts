import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_SKEW_SECONDS = 60 * 5;

export function expectedSlackSignature(signingSecret: string, timestamp: string, rawBody: string): string {
  const digest = createHmac("sha256", signingSecret).update(`v0:${timestamp}:${rawBody}`).digest("hex");
  return `v0=${digest}`;
}

export function verifySlackSignature(input: {
  signingSecret: string;
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  nowSeconds?: number;
}): { ok: true } | { ok: false; reason: string } {
  const { signingSecret, rawBody, timestamp, signature } = input;
  if (!timestamp || !signature) return { ok: false, reason: "missing_signature" };
  if (!/^\d+$/.test(timestamp)) return { ok: false, reason: "bad_timestamp" };
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const sent = Number(timestamp);
  if (Math.abs(now - sent) > MAX_SKEW_SECONDS) return { ok: false, reason: "stale_timestamp" };
  const expected = expectedSlackSignature(signingSecret, timestamp, rawBody);
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  if (left.length !== right.length) return { ok: false, reason: "invalid_signature" };
  if (!timingSafeEqual(left, right)) return { ok: false, reason: "invalid_signature" };
  return { ok: true };
}

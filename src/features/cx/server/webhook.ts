import { createHmac, timingSafeEqual } from "node:crypto";

/** Checks a Sagepilot webhook signature: HMAC-SHA256(secret, timestamp + "." + body), hex, within 5 minutes. Pure. */
export function verifyWebhook(input: { secret: string; timestamp: string; signature: string; body: string; now?: number }): { ok: true } | { ok: false; reason: string } {
  if (input.secret.trim().length < 16) return { ok: false, reason: "Webhook secret not set." };
  const ts = Number(input.timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "Missing timestamp." };
  const ms = ts > 1e12 ? ts : ts * 1000;
  if (Math.abs((input.now ?? Date.now()) - ms) > 5 * 60_000) return { ok: false, reason: "Too old." };
  const expected = createHmac("sha256", input.secret).update(`${input.timestamp}.${input.body}`).digest("hex");
  const given = input.signature.replace(/^sha256=/, "").trim();
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "Bad signature." };
  return { ok: true };
}

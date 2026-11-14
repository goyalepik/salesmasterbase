// The no-login order status page for salespeople: /status/<token>. Anyone with the link can open it (no access
// code), so the link itself is the key: long and random. PUBLIC_STATUS_TOKEN sets it; without it, it is made from
// the dashboard access code. To cut off an old link that leaked, set a new PUBLIC_STATUS_TOKEN.
// Pure (no "server-only"): the proxy and tests use it too.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

type Env = Record<string, string | undefined>;

export function publicStatusToken(env: Env = process.env): string | null {
  const own = env.PUBLIC_STATUS_TOKEN?.trim() ?? "";
  if (own.length >= 16 && /^[\w-]+$/.test(own)) return own;
  const code = env.DASHBOARD_ACCESS_CODE?.trim() ?? "";
  if (code.length >= 8) return createHmac("sha256", code).update("epik-public-status-v1").digest("base64url").slice(0, 24);
  // Demo mode on localhost has no access code.
  return (env.APP_MODE?.trim() || "demo") === "live" ? null : "demo-status-link";
}

/** True when the token in the URL is the current one (compared in constant time). */
export function publicTokenMatches(given: string | undefined, env: Env = process.env): boolean {
  const expected = publicStatusToken(env);
  if (!given || !expected) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export const PUBLIC_STATUS_PREFIX = "/status/";

export function publicStatusPath(env: Env = process.env): string | null {
  const token = publicStatusToken(env);
  return token ? `${PUBLIC_STATUS_PREFIX}${token}` : null;
}

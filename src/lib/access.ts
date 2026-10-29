import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const COOKIE = "epik_access";
const PURPOSE = "epik-dashboard-access-v1";

export function accessCookieName(): string {
  return COOKIE;
}

export function accessCookieValue(code: string): string {
  return createHmac("sha256", code).update(PURPOSE).digest("hex");
}

export function codesMatch(input: string, expected: string): boolean {
  const left = createHash("sha256").update(input).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

export function cookieMatchesCode(cookie: string | undefined, code: string): boolean {
  if (!cookie) return false;
  const expected = accessCookieValue(code);
  const left = Buffer.from(cookie);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/access")) return "/";
  return value;
}

export type AccessGate = "allow" | "challenge" | "refuse";

/**
 * Live mode without a usable access code is refused.
 * Demo mode stays open. Slack must still be able to reach the events route.
 */
export function accessGate(input: {
  mode: string | undefined;
  pathname: string;
  accessCode: string | undefined;
  cookie: string | undefined;
}): AccessGate {
  const mode = input.mode?.trim() || "demo";
  if (mode !== "live") return "allow";
  if (input.pathname === "/api/slack/events" || input.pathname === "/api/slack/commands" || input.pathname === "/api/slack/interactivity") return "allow";
  const code = input.accessCode?.trim() ?? "";
  if (code.length < 8) return "refuse";
  if (input.pathname === "/access" || input.pathname === "/api/access") return "allow";
  if (cookieMatchesCode(input.cookie, code)) return "allow";
  return "challenge";
}

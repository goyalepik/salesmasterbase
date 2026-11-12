import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { personFromCookie } from "@/lib/team-login";

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
 * Demo mode stays open. Slack must still be able to reach the events route, and MCP
 * clients the /api/mcp route (it checks its own bearer token).
 */
export function accessGate(input: {
  mode: string | undefined;
  pathname: string;
  accessCode: string | undefined;
  cookie: string | undefined;
  /** A personal sign-in (Settings → Team roles code), signed with the access code. */
  personCookie?: string | undefined;
}): AccessGate {
  const mode = input.mode?.trim() || "demo";
  if (mode !== "live") return "allow";
  if (input.pathname === "/api/slack/events" || input.pathname === "/api/slack/commands" || input.pathname === "/api/slack/interactivity") return "allow";
  // The MCP server authenticates every request with its own bearer token (MCP_TOKEN).
  if (input.pathname === "/api/mcp" || input.pathname.startsWith("/api/mcp/")) return "allow";
  // The scheduled Shopify check: it checks its own CRON_SECRET.
  if (input.pathname === "/api/cron/shopify" || input.pathname === "/api/cron/backup") return "allow";
  // The live stock feed for the team sheet's IMPORTDATA formula checks its own key (SHEET_SYNC_TOKEN).
  if (input.pathname === "/api/sheet/live-stock") return "allow";
  const code = input.accessCode?.trim() ?? "";
  if (code.length < 8) return "refuse";
  if (input.pathname === "/access" || input.pathname === "/api/access") return "allow";
  if (cookieMatchesCode(input.cookie, code)) return "allow";
  if (personFromCookie(code, input.personCookie)) return "allow";
  return "challenge";
}

// Personal logins without a password database. Each person in Settings → Team roles gets a code made from the main
// access code (DASHBOARD_ACCESS_CODE) and their Slack ID. The main code still opens everything (admin), so nobody is
// ever locked out; changing it changes every personal code. Pure (no "server-only"): the proxy and tests use it too.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Role } from "@/lib/ops/types";
import type { SpaceId } from "@/lib/spaces";

export const PERSON_COOKIE = "epik_person";
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L

/** "K7QM-4TZP": the code this person types to sign in. */
export function personalCode(master: string, personId: string): string {
  const bytes = createHmac("sha256", master).update(`epik-person-code:${personId}`).digest();
  const chars = Array.from(bytes.subarray(0, 8), (b) => ALPHABET[b % ALPHABET.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

/** Codes are typed by people: ignore spaces, dashes and case. */
export function sameCode(typed: string, code: string): boolean {
  const a = Buffer.from(typed.toUpperCase().replace(/[^A-Z0-9]/g, ""));
  const b = Buffer.from(code.toUpperCase().replace(/[^A-Z0-9]/g, ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

const signature = (master: string, personId: string) => createHmac("sha256", master).update(`epik-person-session:${personId}`).digest("hex").slice(0, 40);

export function sessionCookieValue(master: string, personId: string): string {
  return `${personId}.${signature(master, personId)}`;
}

/** The person ID inside a signed session cookie, or null when it is missing or forged. */
export function personFromCookie(master: string | undefined, cookie: string | undefined): string | null {
  if (!master || master.length < 8 || !cookie) return null;
  const dot = cookie.lastIndexOf(".");
  if (dot < 1) return null;
  const id = cookie.slice(0, dot);
  const given = Buffer.from(cookie.slice(dot + 1));
  const expected = Buffer.from(signature(master, id));
  return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
}

/** Which areas a person sees. Admins see everything; Command (the overview) is for everyone. */
export function spacesFor(roles: Role[]): SpaceId[] {
  if (roles.includes("admin")) return ["command", "sales", "payments", "inventory", "delivery"];
  const out = new Set<SpaceId>(["command"]);
  if (roles.includes("sales")) out.add("sales");
  if (roles.includes("revops")) out.add("payments");
  if (roles.includes("inventory") || roles.includes("procurement")) out.add("inventory");
  if (roles.includes("logistics") || roles.includes("installation")) out.add("delivery");
  return [...out];
}

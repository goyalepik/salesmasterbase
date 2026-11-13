import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import usersConfig from "../config/users.json";
import type { Agent, Role } from "../domain/types";

// Sign-in for EPIK Support (v5 section 4.2). Access is by level: each level has its own code (CX_ACCESS_CODE_L1, _L2,
// _L3, _ADMIN, _VIEWER). After the code, the person picks their name from that level's roster ("who am I"), so every
// action carries a name, level and department. The session is a signed, httpOnly cookie, 12 hours long. Rights come
// from the level on every request, so a roster change takes effect at once.
// Optional: Google sign-in (CX_AUTH_MODE=google) maps an @getepik.in email to a roster person via CX_USERS.

export type CxUser = { id: string; email: string; name: string; role: Role; queueIds: string[]; department: string };

export const SESSION_COOKIE = "cx_session";
export const LEVEL_COOKIE = "cx_level";
export const SESSION_MS = 12 * 3_600_000;
export const LEVEL_MS = 10 * 60_000;
const DEV_SECRET = "cx-local-development-only";

type Env = Record<string, string | undefined>;

/** Signs the cookies. CX_SESSION_SECRET when set; until then on the live site a key derived from the dashboard code. */
export function sessionSecret(env: Env = process.env): string | null {
  const s = env.CX_SESSION_SECRET?.trim();
  if (s && s.length >= 16) return s;
  if (env.NODE_ENV !== "production") return DEV_SECRET;
  const code = env.DASHBOARD_ACCESS_CODE?.trim();
  return code && code.length >= 8 ? createHash("sha256").update(`epik-cx-session:${code}`).digest("base64url") : null;
}

export function authMode(env: Env = process.env): "codes" | "google" {
  return env.CX_AUTH_MODE?.trim() === "google" ? "google" : "codes";
}

export function googleConfigured(env: Env = process.env): boolean {
  return Boolean(env.CX_GOOGLE_CLIENT_ID?.trim() && env.CX_GOOGLE_CLIENT_SECRET?.trim());
}

export const DOMAIN: string = usersConfig.domain;

const LEVEL_ENV: Array<[Role, string]> = [["l1", "CX_ACCESS_CODE_L1"], ["l2", "CX_ACCESS_CODE_L2"], ["l3", "CX_ACCESS_CODE_L3"], ["admin", "CX_ACCESS_CODE_ADMIN"], ["viewer", "CX_ACCESS_CODE_VIEWER"]];

/** Which per-level codes are set (names only, for the setup screen and BLOCKERS). */
export function levelCodesSet(env: Env = process.env): Role[] {
  return LEVEL_ENV.filter(([, name]) => (env[name]?.trim().length ?? 0) >= 6).map(([role]) => role);
}

const digest = (s: string) => createHash("sha256").update(s).digest();
const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

/**
 * The level a typed code opens, or null. Every code is compared (constant time), so timing says nothing.
 * The old single code (the dashboard access code) keeps working as CX_LEGACY_CODE_AS (default admin) until it is
 * switched off with CX_LEGACY_CODE_AS=off.
 */
export function levelForCode(typed: string, env: Env = process.env): Role | null {
  const code = typed.trim();
  if (code.length < 4) return null;
  let found: Role | null = null;
  for (const [role, name] of LEVEL_ENV) {
    const expected = env[name]?.trim();
    if (expected && expected.length >= 6 && same(code, expected) && !found) found = role;
  }
  const legacyAs = (env.CX_LEGACY_CODE_AS?.trim() || "admin").toLowerCase();
  const legacy = env.DASHBOARD_ACCESS_CODE?.trim();
  if (!found && legacyAs !== "off" && legacy && legacy.length >= 6 && same(code, legacy)) {
    found = (["l1", "l2", "l3", "admin", "viewer"].includes(legacyAs) ? legacyAs : "admin") as Role;
  }
  return found;
}

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("base64url");

function seal(payload: object, secret: string): string {
  const body = b64(JSON.stringify(payload));
  return `${body}.${sign(body, secret)}`;
}

function open<T extends { exp: number }>(cookie: string | undefined, secret: string | null, now: number): T | null {
  if (!cookie || !secret) return null;
  const [body, mac] = cookie.split(".");
  if (!body || !mac) return null;
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const value = JSON.parse(Buffer.from(body, "base64url").toString()) as T;
    return value.exp > now ? value : null;
  } catch {
    return null;
  }
}

/** Proof that a level's code was typed in the last 10 minutes; the person then picks their name. */
export function createLevelPass(level: Role, secret: string, now = Date.now()): string {
  return seal({ level, exp: now + LEVEL_MS }, secret);
}

export function readLevelPass(cookie: string | undefined, secret: string | null, now = Date.now()): Role | null {
  return open<{ level: Role; exp: number }>(cookie, secret, now)?.level ?? null;
}

export type Session = { userId?: string; level?: Role; email?: string; name?: string; exp: number };

export function createSession(s: Omit<Session, "exp">, secret: string, now = Date.now()): string {
  return seal({ ...s, exp: now + SESSION_MS }, secret);
}

export function readSession(cookie: string | undefined, secret: string | null, now = Date.now()): Session | null {
  return open<Session>(cookie, secret, now);
}

function pairs(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of (raw ?? "").split(",")) {
    const [email, id] = part.split("=").map((s) => s?.trim().toLowerCase());
    if (email) map.set(email, id ?? "");
  }
  return map;
}

const userOf = (p: Agent, email: string): CxUser => ({ id: p.id, email, name: p.name, role: p.role, queueIds: p.queueIds, department: p.department ?? "" });

/**
 * The signed-in person, from the cookie and the current roster. A person taken off the roster, made inactive, or moved
 * to another level than the code they used, is signed out.
 */
export function userFromSession(s: Session | null, roster: Agent[], env: Env = process.env): CxUser | null {
  if (!s) return null;
  if (s.userId) {
    const p = roster.find((r) => r.id === s.userId && r.active !== false);
    if (!p || (s.level && p.role !== s.level)) return null;
    return userOf(p, `${p.id}@epik`);
  }
  if (s.email && authMode(env) === "google") {
    const e = s.email.trim().toLowerCase();
    const id = pairs(env.CX_USERS).get(e);
    const p = id ? roster.find((r) => r.id === id && r.active !== false) : undefined;
    const admin = pairs(env.CX_ADMIN_EMAILS).has(e);
    if (p) return { ...userOf(p, e), role: admin ? "admin" : p.role };
    const local = e.split("@")[0];
    return { id: `u:${local}`, email: e, name: s.name?.trim() || local, role: admin ? "admin" : (usersConfig.unknownRole as Role), queueIds: [], department: "" };
  }
  return null;
}

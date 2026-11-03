import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import usersConfig from "../config/users.json";
import { AGENT } from "../domain/config";
import type { Role } from "../domain/types";

// Sign-in for EPIK Support. A signed cookie holds who you are; the role comes from config on every request,
// so changing someone's role takes effect at once. The shared dashboard code (src/proxy.ts) stays as the outer gate.

export type CxUser = { id: string; email: string; name: string; role: Role; queueIds: string[] };

export const SESSION_COOKIE = "cx_session";
const WEEK = 7 * 86_400_000;
const DEV_SECRET = "cx-local-development-only";

type Env = Record<string, string | undefined>;

/**
 * Signs the session cookie. CX_SESSION_SECRET when set; until then on the live site, a key derived from
 * the dashboard access code (secret, server-only), so the pilot works before the setup is finished.
 */
export function sessionSecret(env: Env = process.env): string | null {
  const s = env.CX_SESSION_SECRET?.trim();
  if (s && s.length >= 16) return s;
  if (env.NODE_ENV !== "production") return DEV_SECRET;
  const code = env.DASHBOARD_ACCESS_CODE?.trim();
  return code && code.length >= 8 ? createHash("sha256").update(`epik-cx-session:${code}`).digest("base64url") : null;
}

/**
 * The quick "pick a person" sign-in. Always on locally. On the live site only until Google sign-in is set up
 * (or when CX_DEV_SIGNIN=true); the dashboard access code still guards the whole site.
 */
export function devSignInAllowed(env: Env = process.env): boolean {
  if (env.NODE_ENV !== "production" || env.CX_DEV_SIGNIN === "true") return true;
  return env.CX_DEV_SIGNIN !== "false" && !googleConfigured(env);
}

export function googleConfigured(env: Env = process.env): boolean {
  return Boolean(env.CX_GOOGLE_CLIENT_ID?.trim() && env.CX_GOOGLE_CLIENT_SECRET?.trim());
}

export const DOMAIN: string = usersConfig.domain;

function pairs(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of (raw ?? "").split(",")) {
    const [email, id] = part.split("=").map((s) => s?.trim().toLowerCase());
    if (email) map.set(email, id ?? "");
  }
  return map;
}

/** Email → person and role. Known people come from CX_USERS (or users.json); admins from CX_ADMIN_EMAILS; others are viewers. */
export function resolveUser(email: string, name: string | undefined, env: Env = process.env): CxUser {
  const e = email.trim().toLowerCase();
  const fileUsers = (usersConfig.users as Array<{ email: string; personId: string }>).map((u) => [u.email.toLowerCase(), u.personId] as const);
  const personId = pairs(env.CX_USERS).get(e) ?? new Map(fileUsers).get(e);
  const person = personId ? AGENT.get(personId) : undefined;
  const admin = pairs(env.CX_ADMIN_EMAILS).has(e);
  if (person) return { id: person.id, email: e, name: person.name, role: admin ? "admin" : person.role, queueIds: person.queueIds };
  const local = e.split("@")[0];
  return { id: `u:${local}`, email: e, name: name?.trim() || local, role: admin ? "admin" : (usersConfig.unknownRole as Role), queueIds: [] };
}

/** Dev sign-in as one of the people in queues.json, or as an admin/viewer. */
export function devUser(personId: string): CxUser | null {
  if (personId === "admin") return { id: "admin", email: "admin@local.test", name: "Admin", role: "admin", queueIds: [] };
  if (personId === "viewer") return { id: "viewer", email: "viewer@local.test", name: "Viewer", role: "viewer", queueIds: [] };
  const p = AGENT.get(personId);
  return p ? { id: p.id, email: `${p.id}@local.test`, name: p.name, role: p.role, queueIds: p.queueIds } : null;
}

type Session = { email: string; name?: string; dev?: string; exp: number };

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("base64url");

export function createSession(s: Omit<Session, "exp">, secret: string, now = Date.now()): string {
  const body = b64(JSON.stringify({ ...s, exp: now + WEEK }));
  return `${body}.${sign(body, secret)}`;
}

export function readSession(cookie: string | undefined, secret: string | null, now = Date.now()): Session | null {
  if (!cookie || !secret) return null;
  const [body, mac] = cookie.split(".");
  if (!body || !mac) return null;
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString()) as Session;
    return s.exp > now ? s : null;
  } catch {
    return null;
  }
}

/** The signed-in user from the cookie value, or null. */
export function userFromCookie(cookie: string | undefined, env: Env = process.env): CxUser | null {
  const s = readSession(cookie, sessionSecret(env));
  if (!s) return null;
  if (s.dev) return devSignInAllowed(env) ? devUser(s.dev) : null;
  return resolveUser(s.email, s.name, env);
}

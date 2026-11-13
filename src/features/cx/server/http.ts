import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { can, ForbiddenError, type Capability } from "../domain/rights";
import { CxError } from "../domain/service";
import { ConflictError } from "./actions";
import { readSession, SESSION_COOKIE, sessionSecret, userFromSession, type CxUser } from "./auth";
import { loadRoster } from "./roster";
import { getCxStore, StoreNotConfigured, type CxStore } from "./store";
import { BusyError } from "./workspace";

// Shared plumbing for the /api/cx routes: pilot flag, signed-in person, store, rights, and plain-English errors.

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function currentUser(store: CxStore = getCxStore()): Promise<CxUser | null> {
  const session = readSession((await cookies()).get(SESSION_COOKIE)?.value, sessionSecret());
  if (!session) return null;
  return userFromSession(session, await loadRoster(store));
}

type Ctx = { user: CxUser; store: CxStore };

/** Runs a handler for a signed-in person. Errors become short messages; nothing personal is logged. */
export async function handle(fn: (ctx: Ctx) => Promise<Response>, opts: { can?: Capability } = {}): Promise<Response> {
  if (process.env.NEXT_PUBLIC_CX_PILOT !== "true") return json({ error: "Not found." }, 404);
  try {
    const store = getCxStore();
    const user = await currentUser(store);
    if (!user) return json({ error: "Please sign in." }, 401);
    if (opts.can && !can(user, opts.can)) return json({ error: "Your level cannot do this." }, 403);
    return await fn({ user, store });
  } catch (error) {
    if (error instanceof ConflictError) return json({ error: error.message, conflict: true }, 409);
    if (error instanceof BusyError) return json({ error: error.message }, 423);
    if (error instanceof ForbiddenError) return json({ error: error.message }, 403);
    if (error instanceof CxError) return json({ error: error.message }, 400);
    if (error instanceof StoreNotConfigured) return json({ error: error.message }, 503);
    console.error(JSON.stringify({ event: "cx_api_failed", name: error instanceof Error ? error.name : "unknown" }));
    return json({ error: "Something went wrong on the server. Try again." }, 500);
  }
}

/** A cookie that page scripts can't read, sent only to this site. */
export function secureCookie(maxAgeSeconds: number) {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: maxAgeSeconds };
}

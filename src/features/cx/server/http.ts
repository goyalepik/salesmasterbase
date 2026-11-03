import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { CxError } from "../domain/service";
import { ConflictError } from "./actions";
import { SESSION_COOKIE, userFromCookie, type CxUser } from "./auth";
import { getCxStore, StoreNotConfigured, type CxStoreAdapter } from "./store";
import { BusyError } from "./workspace";

// Shared plumbing for the /api/cx routes: pilot flag, signed-in user, store, and plain-English errors.

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function currentUser(): Promise<CxUser | null> {
  return userFromCookie((await cookies()).get(SESSION_COOKIE)?.value);
}

type Ctx = { user: CxUser; store: CxStoreAdapter };

/** Runs a handler for a signed-in user. Errors become short messages; nothing personal is logged. */
export async function handle(fn: (ctx: Ctx) => Promise<Response>, opts: { roles?: CxUser["role"][] } = {}): Promise<Response> {
  if (process.env.NEXT_PUBLIC_CX_PILOT !== "true") return json({ error: "Not found." }, 404);
  const user = await currentUser();
  if (!user) return json({ error: "Please sign in." }, 401);
  if (opts.roles && !opts.roles.includes(user.role)) return json({ error: "Your role cannot do this." }, 403);
  try {
    return await fn({ user, store: getCxStore() });
  } catch (error) {
    if (error instanceof ConflictError) return json({ error: error.message, conflict: true }, 409);
    if (error instanceof BusyError) return json({ error: error.message }, 423);
    if (error instanceof CxError) return json({ error: error.message }, 400);
    if (error instanceof StoreNotConfigured) return json({ error: error.message }, 503);
    console.error(JSON.stringify({ event: "cx_api_failed", name: error instanceof Error ? error.name : "unknown" }));
    return json({ error: "Something went wrong on the server. Try again." }, 500);
  }
}

import { NextResponse } from "next/server";
import { secureCookie } from "@/features/cx/server/http";
import { createSession, LEVEL_COOKIE, readLevelPass, SESSION_COOKIE, SESSION_MS, sessionSecret } from "@/features/cx/server/auth";
import { loadRoster } from "@/features/cx/server/roster";
import { getCxStore } from "@/features/cx/server/store";

/** Step 2 of sign-in: "who am I". Only names on the roster for the level whose code was typed. */
export async function POST(request: Request) {
  const back = new URL("/cx", request.url);
  const secret = sessionSecret();
  const cookieHeader = request.headers.get("cookie") ?? "";
  const pass = cookieHeader.split(/;\s*/).find((c) => c.startsWith(`${LEVEL_COOKIE}=`))?.slice(LEVEL_COOKIE.length + 1);
  const level = readLevelPass(pass ? decodeURIComponent(pass) : undefined, secret);
  const form = await request.formData().catch(() => null);
  const userId = String(form?.get("person") ?? "");
  const store = getCxStore();
  const person = level ? (await loadRoster(store)).find((p) => p.id === userId && p.role === level && p.active !== false) : undefined;
  if (!secret || !level || !person) {
    back.searchParams.set("signin", level ? "not_on_roster" : "expired");
    return NextResponse.redirect(back, 303);
  }
  await store.audit([{ at: new Date().toISOString(), actorId: person.id, kind: "signed_in", detail: { level } }]).catch(() => undefined);
  const response = NextResponse.redirect(back, 303);
  response.cookies.set(SESSION_COOKIE, createSession({ userId: person.id, level, name: person.name }, secret), secureCookie(SESSION_MS / 1000));
  response.cookies.delete(LEVEL_COOKIE);
  return response;
}

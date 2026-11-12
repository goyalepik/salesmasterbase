import { NextResponse } from "next/server";
import { accessCookieName, accessCookieValue, codesMatch, safeNextPath } from "@/lib/access";
import { readEnv } from "@/lib/env";
import { getOpsStore } from "@/lib/ops";
import { isSameOrigin } from "@/lib/same-origin";
import { PERSON_COOKIE, personalCode, sameCode, sessionCookieValue } from "@/lib/team-login";

export const dynamic = "force-dynamic";

const COOKIE = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 };

/** Sign in: the main access code opens everything (admin); a personal code opens that person's areas. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response("Cross-origin request refused.", { status: 403 });
  const form = await request.formData();
  const code = String(form.get("code") ?? "").trim();
  const next = safeNextPath(String(form.get("next") ?? "/"));
  const master = readEnv().dashboardAccessCode;
  const refuse = () => {
    const url = new URL("/access", request.url);
    url.searchParams.set("error", "1");
    url.searchParams.set("next", next);
    return NextResponse.redirect(url, 303);
  };
  if (!master || master.length < 8) return refuse();

  if (codesMatch(code, master)) {
    const response = NextResponse.redirect(new URL(next, request.url), 303);
    response.cookies.set(accessCookieName(), accessCookieValue(master), COOKIE);
    response.cookies.delete(PERSON_COOKIE);
    return response;
  }

  const store = await getOpsStore();
  const people = store ? await store.people().catch(() => []) : [];
  const person = people.find((p) => sameCode(code, personalCode(master, p.slackUserId)));
  if (!person || !person.roles.length) return refuse();
  const response = NextResponse.redirect(new URL(next === "/" ? "/sales" : next, request.url), 303);
  response.cookies.set(PERSON_COOKIE, sessionCookieValue(master, person.slackUserId), COOKIE);
  response.cookies.delete(accessCookieName());
  return response;
}

/** Sign out: forget both kinds of sign-in on this browser. */
export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return new Response("Cross-origin request refused.", { status: 403 });
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(PERSON_COOKIE);
  response.cookies.delete(accessCookieName());
  return response;
}

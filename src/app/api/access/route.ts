import { NextResponse } from "next/server";
import { accessCookieName, accessCookieValue, codesMatch, safeNextPath } from "@/lib/access";
import { readEnv } from "@/lib/env";
import { isSameOrigin } from "@/lib/same-origin";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response("Cross-origin request refused.", { status: 403 });
  const form = await request.formData();
  const code = String(form.get("code") ?? "");
  const next = safeNextPath(String(form.get("next") ?? "/"));
  const expected = readEnv().dashboardAccessCode;
  if (!expected || expected.length < 8 || !codesMatch(code, expected)) {
    const url = new URL("/access", request.url);
    url.searchParams.set("error", "1");
    url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  }
  const response = NextResponse.redirect(new URL(next, request.url));
  response.cookies.set(accessCookieName(), accessCookieValue(expected), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
  return response;
}

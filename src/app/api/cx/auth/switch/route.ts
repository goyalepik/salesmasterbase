import { NextResponse } from "next/server";
import { secureCookie } from "@/features/cx/server/http";
import { createLevelPass, LEVEL_COOKIE, LEVEL_MS, readSession, SESSION_COOKIE, sessionSecret } from "@/features/cx/server/auth";

/** "Switch user": back to the name list for the same level, without typing the code again (10 minutes). */
export async function POST(request: Request) {
  const back = new URL("/cx", request.url);
  const secret = sessionSecret();
  const cookieHeader = request.headers.get("cookie") ?? "";
  const raw = cookieHeader.split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  const session = readSession(raw ? decodeURIComponent(raw) : undefined, secret);
  const response = NextResponse.redirect(back, 303);
  response.cookies.delete(SESSION_COOKIE);
  if (secret && session?.level) response.cookies.set(LEVEL_COOKIE, createLevelPass(session.level, secret), secureCookie(LEVEL_MS / 1000));
  return response;
}

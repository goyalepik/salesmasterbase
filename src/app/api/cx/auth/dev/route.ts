import { NextResponse } from "next/server";
import { createSession, devSignInAllowed, devUser, SESSION_COOKIE, sessionSecret } from "@/features/cx/server/auth";
import { sessionCookie } from "../cookie";

/** Local sign-in: pick a person from the list. Off in production unless CX_DEV_SIGNIN=true. */
export async function POST(request: Request) {
  const secret = sessionSecret();
  const form = await request.formData().catch(() => null);
  const personId = String(form?.get("person") ?? "");
  const back = new URL("/cx", request.url);
  if (!devSignInAllowed() || !secret || !devUser(personId)) return NextResponse.redirect(back, 303);
  const response = NextResponse.redirect(back, 303);
  response.cookies.set(SESSION_COOKIE, createSession({ email: `${personId}@local.test`, dev: personId }, secret), sessionCookie());
  return response;
}

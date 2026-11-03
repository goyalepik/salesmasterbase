import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { DOMAIN, googleConfigured } from "@/features/cx/server/auth";
import { sessionCookie } from "../cookie";

/** Starts Google sign-in, limited to the company's Google Workspace domain. */
export async function GET(request: Request) {
  if (!googleConfigured()) return NextResponse.redirect(new URL("/cx?signin=not_configured", request.url), 303);
  const state = randomBytes(16).toString("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", process.env.CX_GOOGLE_CLIENT_ID!.trim());
  url.searchParams.set("redirect_uri", new URL("/api/cx/auth/callback", request.url).toString());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("hd", DOMAIN);
  url.searchParams.set("prompt", "select_account");
  url.searchParams.set("state", state);
  const response = NextResponse.redirect(url, 303);
  response.cookies.set("cx_oauth_state", state, sessionCookie(600));
  return response;
}

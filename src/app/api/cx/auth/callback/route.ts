import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSession, DOMAIN, googleConfigured, SESSION_COOKIE, sessionSecret } from "@/features/cx/server/auth";
import { sessionCookie } from "../cookie";

type TokenInfo = { aud?: string; email?: string; email_verified?: string | boolean; hd?: string; name?: string };

/** Google sends the person back here. Only verified @getepik.in accounts get a session. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const fail = (why: string) => {
    const response = NextResponse.redirect(new URL(`/cx?signin=${why}`, request.url), 303);
    response.cookies.delete("cx_oauth_state");
    return response;
  };
  const secret = sessionSecret();
  if (!googleConfigured() || !secret) return fail("not_configured");
  const state = (await cookies()).get("cx_oauth_state")?.value;
  if (!state || state !== url.searchParams.get("state")) return fail("expired");
  const code = url.searchParams.get("code");
  if (!code) return fail("cancelled");

  const token = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.CX_GOOGLE_CLIENT_ID!.trim(),
      client_secret: process.env.CX_GOOGLE_CLIENT_SECRET!.trim(),
      redirect_uri: new URL("/api/cx/auth/callback", request.url).toString(),
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  }).then((r) => (r.ok ? (r.json() as Promise<{ id_token?: string }>) : null)).catch(() => null);
  if (!token?.id_token) return fail("failed");

  // Google checks the token's signature for us here.
  const info = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token.id_token)}`, { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<TokenInfo>) : null)).catch(() => null);
  const email = info?.email?.toLowerCase() ?? "";
  const verified = info?.email_verified === true || info?.email_verified === "true";
  if (!info || info.aud !== process.env.CX_GOOGLE_CLIENT_ID!.trim() || !verified || !email.endsWith(`@${DOMAIN}`)) return fail("domain");

  const response = NextResponse.redirect(new URL("/cx", request.url), 303);
  response.cookies.set(SESSION_COOKIE, createSession({ email, name: info.name }, secret), sessionCookie());
  response.cookies.delete("cx_oauth_state");
  return response;
}

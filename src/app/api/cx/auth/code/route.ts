import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { secureCookie } from "@/features/cx/server/http";
import { createLevelPass, LEVEL_COOKIE, LEVEL_MS, levelForCode, sessionSecret } from "@/features/cx/server/auth";
import { getCxStore } from "@/features/cx/server/store";

const WINDOW_MS = 10 * 60_000;
const MAX_TRIES = 5;

/**
 * Step 1 of sign-in: the code for a level. At most 5 tries per 10 minutes per connection; refused tries are written to
 * the audit log without the code. On success a 10-minute pass lets the person pick their name (step 2).
 */
export async function POST(request: Request) {
  const back = new URL("/cx", request.url);
  const secret = sessionSecret();
  const form = await request.formData().catch(() => null);
  const code = String(form?.get("code") ?? "");
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const who = createHash("sha256").update(`cx-ip:${ip}`).digest("base64url").slice(0, 16);
  const store = getCxStore();
  const tries = await store.hit(`code:${who}`, WINDOW_MS).catch(() => 0);
  if (tries > MAX_TRIES) {
    back.searchParams.set("signin", "too_many");
    return NextResponse.redirect(back, 303);
  }
  const level = secret ? levelForCode(code) : null;
  if (!level || !secret) {
    await store.audit([{ at: new Date().toISOString(), actorId: "anonymous", kind: "signin_refused", detail: { who } }]).catch(() => undefined);
    back.searchParams.set("signin", "wrong_code");
    return NextResponse.redirect(back, 303);
  }
  const response = NextResponse.redirect(back, 303);
  response.cookies.set(LEVEL_COOKIE, createLevelPass(level, secret), secureCookie(LEVEL_MS / 1000));
  return response;
}

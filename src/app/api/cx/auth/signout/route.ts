import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/features/cx/server/auth";

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/cx", request.url), 303);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}

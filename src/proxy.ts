import { NextResponse, type NextRequest } from "next/server";
import { accessCookieName, accessGate } from "@/lib/access";

function forward(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-epik-path", request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const decision = accessGate({
    mode: process.env.APP_MODE,
    pathname: path,
    accessCode: process.env.DASHBOARD_ACCESS_CODE,
    cookie: request.cookies.get(accessCookieName())?.value,
  });
  if (decision === "allow") return forward(request);
  if (decision === "refuse") {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "Live access is not configured." }, { status: 503 });
    }
    return new NextResponse("Live mode is not configured. Set DASHBOARD_ACCESS_CODE to at least 8 characters before opening this workspace.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  if (path.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/access";
  url.searchParams.set("next", `${path}${request.nextUrl.search}`);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.svg).*)"],
};

import { NextResponse } from "next/server";
import { safeNextPath } from "@/lib/access";
import { isSameOrigin } from "@/lib/same-origin";
import { loadWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return new Response("Cross-origin request refused.", { status: 403 });
  const { id } = await context.params;
  const form = await request.formData();
  const note = String(form.get("note") ?? "");
  const returnTo = safeNextPath(String(form.get("returnTo") ?? "/exceptions"));
  const workspace = await loadWorkspace();
  if (workspace.kind !== "ready") return NextResponse.redirect(new URL("/settings", request.url));
  try {
    await workspace.repo.resolveException(id, note, "Dashboard user");
  } catch {
    const url = new URL(returnTo, request.url);
    url.searchParams.set("notice", "The exception could not be resolved. Add a note of at least 8 characters.");
    return NextResponse.redirect(url);
  }
  return NextResponse.redirect(new URL(returnTo, request.url));
}

import { NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/same-origin";
import { loadWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response("Cross-origin request refused.", { status: 403 });
  const back = new URL("/contributors", request.url);
  const workspace = await loadWorkspace();
  if (workspace.kind !== "ready") return NextResponse.redirect(back);
  const form = await request.formData();
  const senderId = String(form.get("senderId") ?? "").trim();
  const name = String(form.get("name") ?? "").replace(/\s+/g, " ").trim();
  if (!/^U[A-Z0-9]{6,}$/.test(senderId) || name.length < 2 || name.length > 60 || /^U[A-Z0-9]+$/.test(name)) {
    return NextResponse.redirect(back);
  }
  await workspace.repo.saveSenderName(senderId, name);
  back.searchParams.set("named", "1");
  return NextResponse.redirect(back);
}

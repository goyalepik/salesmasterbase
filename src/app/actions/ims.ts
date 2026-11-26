"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { askIms, type ChatTurn } from "@/features/ims/chat";
import { IMS_ROLE_COOKIE, imsRole } from "@/features/ims/role";
import { loadIms, saveSources, SOURCE_IDS, type SourceId } from "@/features/ims/sources";
import { actorName } from "@/lib/ops-ui/actor";

export async function setImsRoleAction(role: "viewer" | "admin"): Promise<void> {
  (await cookies()).set(IMS_ROLE_COOKIE, role === "admin" ? "admin" : "viewer", { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 365 });
  refresh();
}

export async function askImsAction(history: ChatTurn[]): Promise<{ ok: true; answer: string } | { ok: false; message: string }> {
  const turns = (Array.isArray(history) ? history : [])
    .filter((t) => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string")
    .slice(-12);
  if (!turns.length || turns[turns.length - 1].role !== "user") return { ok: false, message: "Ask a question." };
  const data = await loadIms();
  if (!data) return { ok: false, message: "The sheets couldn't be read just now. Try again in a minute." };
  try {
    return { ok: true, answer: await askIms(data.snapshot, await imsRole(), turns) };
  } catch {
    return { ok: false, message: "The assistant couldn't answer right now. Try again in a minute." };
  }
}

export async function saveImsSourcesAction(form: FormData): Promise<{ ok: boolean; message: string }> {
  if ((await imsRole()) !== "admin") return { ok: false, message: "Switch to Admin to change the sources." };
  const next: Partial<Record<SourceId, string>> = {};
  for (const id of SOURCE_IDS) {
    const v = String(form.get(id) ?? "").trim().slice(0, 500);
    if (v) next[id] = v;
  }
  const saved = await saveSources(next, await actorName());
  if (!saved.ok) return { ok: false, message: saved.message };
  const data = await loadIms(true);
  refresh();
  const bad = data?.sources.filter((s) => !s.ok) ?? [];
  return bad.length ? { ok: false, message: `Saved, but ${bad.map((b) => `${b.id}: ${b.message}`).join("; ")}.` } : { ok: true, message: "Saved. All three sheets read fine." };
}

export async function refreshImsAction(): Promise<void> {
  await loadIms(true);
  refresh();
}

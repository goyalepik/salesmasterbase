"use server";

import { refresh } from "next/cache";
import { askHq, type Turn } from "@/features/hq/ask";
import { loadHq, saveHqSources } from "@/features/hq/sources";
import { actorName, isAdmin } from "@/lib/ops-ui/actor";

export async function askHqAction(history: Turn[], range: string): Promise<{ ok: boolean; answer: string }> {
  const turns = (Array.isArray(history) ? history : []).filter((t) => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string").slice(-10);
  if (!turns.length || turns[turns.length - 1].role !== "user") return { ok: false, answer: "Ask a question." };
  const data = await loadHq(range);
  if (!data) return { ok: false, answer: "The sheets couldn't be read just now. Try again in a minute." };
  try { return { ok: true, answer: await askHq(data.d, turns) }; } catch { return { ok: false, answer: "The assistant couldn't answer right now." }; }
}

export async function saveHqSourcesAction(form: FormData): Promise<{ ok: boolean; message: string }> {
  if (!(await isAdmin())) return { ok: false, message: "Only an admin can change the sources." };
  const v = (k: string) => String(form.get(k) ?? "").trim().slice(0, 300) || undefined;
  await saveHqSources({ copySheet: v("copySheet"), salesTab: v("salesTab"), adsSheet: v("adsSheet") }, await actorName());
  const d = await loadHq(null, true);
  refresh();
  const bad = d?.states.filter((s) => !s.ok) ?? [];
  return bad.length || !d ? { ok: false, message: `Saved, but: ${bad.map((b) => `${b.id} ${b.detail}`).join("; ") || "nothing could be read"}.` } : { ok: true, message: "Saved. Both sheets read fine." };
}

export async function refreshHqAction(): Promise<void> {
  await loadHq(null, true);
  refresh();
}

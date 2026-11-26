"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { readBill, type BillDraft } from "@/features/ims/bill-reader";
import { askIms, type ChatTurn } from "@/features/ims/chat";
import { DISPATCH_STATUSES, matchProducts, PO_STATUSES, receiptProblems, type Receipt, type ReceiptLine } from "@/features/ims/domain/app";
import { CATEGORIES } from "@/features/ims/domain/categories";
import { canEdit, IMS_ROLE_COOKIE, IMS_ROLES, imsRole, type ImsRole } from "@/features/ims/role";
import { loadIms, refreshSheets, saveSources, setCategory, SOURCE_IDS, type SourceId } from "@/features/ims/sources";
import { addStatus, saveReceipt, storeBill, voidReceipt } from "@/features/ims/store";
import { actorName } from "@/lib/ops-ui/actor";

type Done = { ok: boolean; message: string };
const NOT_READY = "One step left: an admin runs supabase/migrations/0007_ims.sql in Supabase. Until then nothing can be saved here.";

export async function setImsRoleAction(role: ImsRole): Promise<void> {
  (await cookies()).set(IMS_ROLE_COOKIE, IMS_ROLES.includes(role) ? role : "viewer", { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 365 });
  refresh();
}

export async function askImsAction(history: ChatTurn[]): Promise<{ ok: true; answer: string } | { ok: false; message: string }> {
  const turns = (Array.isArray(history) ? history : []).filter((t) => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string").slice(-12);
  if (!turns.length || turns[turns.length - 1].role !== "user") return { ok: false, message: "Ask a question." };
  const data = await loadIms();
  if (!data) return { ok: false, message: "The sheets couldn't be read just now. Try again in a minute." };
  try {
    return { ok: true, answer: await askIms(data.snapshot, turns) };
  } catch {
    return { ok: false, message: "The assistant couldn't answer right now. Try again in a minute." };
  }
}

// ── Stock in: upload a bill, check it, save ──────────────────────────────────

export type BillRead = { ok: true; draft: BillDraft; billPath: string; billName: string; matches: Array<Array<{ sku: string; name: string; score: number }>> } | { ok: false; message: string; billPath?: string; billName?: string };

export async function readBillAction(form: FormData): Promise<BillRead> {
  if (!canEdit(await imsRole())) return { ok: false, message: "Switch to Editor to add stock." };
  const file = form.get("bill");
  if (!(file instanceof File) || !file.size) return { ok: false, message: "Choose a photo or PDF of the bill." };
  if (file.size > 4.4 * 1024 * 1024) return { ok: false, message: "That file is over 4 MB. Use a smaller PDF, or a photo (photos are shrunk automatically)." };
  const type = file.type || "application/octet-stream";
  if (!/^image\/(png|jpe?g|webp|heic)$|^application\/pdf$/.test(type)) return { ok: false, message: "Use a photo (JPG, PNG) or a PDF." };
  const data = Buffer.from(await file.arrayBuffer());
  let billPath: string;
  try {
    billPath = await storeBill(file.name, type, data);
  } catch (e) {
    return { ok: false, message: `Couldn't keep the bill: ${e instanceof Error ? e.message : "storage error"}.` };
  }
  const read = await readBill(file.name, type, data);
  if (!read.ok) return { ok: false, message: read.message, billPath, billName: file.name };
  const ims = await loadIms();
  const products = ims?.snapshot.products.map((p) => ({ sku: p.sku, name: p.name })) ?? [];
  return { ok: true, draft: read.draft, billPath, billName: file.name, matches: read.draft.lines.map((l) => matchProducts(l.description, products)) };
}

export type ReceiptInput = Omit<Receipt, "id" | "at" | "voided" | "by">;

export async function saveReceiptAction(input: ReceiptInput): Promise<Done & { id?: string }> {
  if (!canEdit(await imsRole())) return { ok: false, message: "Switch to Editor to add stock." };
  const data = await loadIms();
  if (data && !data.entriesReady) return { ok: false, message: NOT_READY };
  const lines: ReceiptLine[] = (input.lines ?? []).map((l) => ({
    sku: String(l.sku ?? "").trim(), name: String(l.name ?? "").trim().slice(0, 200), qty: Math.max(0, Math.round(Number(l.qty) || 0)),
    unitCost: Math.max(0, Number(l.unitCost) || 0), serials: (l.serials ?? []).map((s) => String(s).trim()).filter(Boolean).slice(0, 500),
    condition: l.condition === "Damaged" || l.condition === "Open box" ? l.condition : "Good",
  }));
  const r = { vendor: String(input.vendor ?? "").trim().slice(0, 120), invoice: String(input.invoice ?? "").trim().slice(0, 60), lines };
  const problems = receiptProblems(r);
  // A serial already in stock (sheet or app) can't come in again.
  const inStock = new Set(data?.snapshot.units.filter((u) => u.inStock && u.serial).map((u) => u.serial!.toUpperCase().replace(/\s+/g, "")) ?? []);
  const taken = lines.flatMap((l) => l.serials).find((s) => inStock.has(s.toUpperCase().replace(/\s+/g, "")));
  if (taken) problems.push(`Serial ${taken} is already in stock.`);
  if (problems.length) return { ok: false, message: problems.join(" ") };
  try {
    const saved = await saveReceipt({
      ...r, by: await actorName(), invoiceDate: /^\d{4}-\d{2}-\d{2}$/.test(input.invoiceDate ?? "") ? input.invoiceDate : null,
      po: input.po?.trim() || null, billedTo: input.billedTo?.trim() || null, terms: input.terms === "SOR" ? "SOR" : "Cash and Carry",
      billPath: input.billPath ?? null, billName: input.billName ?? null, note: input.note?.trim().slice(0, 500) || null,
    });
    refresh();
    const units = lines.reduce((s, l) => s + l.qty, 0);
    return { ok: true, id: saved.id, message: `${saved.id} saved: ${units} unit${units === 1 ? "" : "s"} added to stock.` };
  } catch (e) {
    return { ok: false, message: /relation|does not exist|schema cache/i.test(String(e)) ? NOT_READY : `Couldn't save: ${e instanceof Error ? e.message : "error"}.` };
  }
}

export async function voidReceiptAction(id: string): Promise<Done> {
  if (!canEdit(await imsRole())) return { ok: false, message: "Switch to Editor to change stock." };
  try {
    await voidReceipt(String(id).slice(0, 30), await actorName());
    refresh();
    return { ok: true, message: `${id} cancelled; its units left stock.` };
  } catch (e) {
    return { ok: false, message: `Couldn't cancel: ${e instanceof Error ? e.message : "error"}.` };
  }
}

// ── Status updates ───────────────────────────────────────────────────────────

export async function addStatusAction(form: FormData): Promise<Done> {
  if (!canEdit(await imsRole())) return { ok: false, message: "Switch to Editor to update statuses." };
  const kind = form.get("kind") === "dispatch" ? "dispatch" : "po";
  const status = String(form.get("status") ?? "");
  const allowed: readonly string[] = kind === "po" ? PO_STATUSES : DISPATCH_STATUSES;
  if (!allowed.includes(status)) return { ok: false, message: "Pick a status." };
  const ref = String(form.get("ref") ?? "").trim().slice(0, 120);
  if (!ref) return { ok: false, message: "Missing item." };
  const eta = String(form.get("eta") ?? "").trim();
  const data = await loadIms();
  if (data && !data.entriesReady) return { ok: false, message: NOT_READY };
  try {
    await addStatus({ by: await actorName(), kind, ref, status, eta: /^\d{4}-\d{2}-\d{2}$/.test(eta) ? eta : null, note: String(form.get("note") ?? "").trim().slice(0, 300) || null });
    refresh();
    return { ok: true, message: `Saved: ${status}.` };
  } catch (e) {
    return { ok: false, message: /relation|does not exist|schema cache/i.test(String(e)) ? NOT_READY : `Couldn't save: ${e instanceof Error ? e.message : "error"}.` };
  }
}

// ── Admin ────────────────────────────────────────────────────────────────────

export async function setCategoryAction(form: FormData): Promise<Done> {
  if ((await imsRole()) !== "admin") return { ok: false, message: "Switch to Admin to change categories." };
  const sku = String(form.get("sku") ?? "").trim();
  const category = String(form.get("category") ?? "");
  if (!sku) return { ok: false, message: "Missing product." };
  await setCategory(sku, (CATEGORIES as readonly string[]).includes(category) ? category : null);
  refresh();
  return { ok: true, message: "Category saved." };
}

export async function saveImsSourcesAction(form: FormData): Promise<Done> {
  if ((await imsRole()) !== "admin") return { ok: false, message: "Switch to Admin to change the sources." };
  const next: Partial<Record<SourceId, string>> = {};
  for (const id of SOURCE_IDS) {
    const v = String(form.get(id) ?? "").trim().slice(0, 500);
    if (v) next[id] = v;
  }
  const saved = await saveSources(next, await actorName());
  if (!saved.ok) return { ok: false, message: saved.message };
  const data = await loadIms({ force: true });
  refresh();
  const bad = data?.sources.filter((s) => !s.ok) ?? [];
  return bad.length ? { ok: false, message: `Saved, but: ${bad.map((b) => `${b.id} ${b.message}`).join("; ")}.` } : { ok: true, message: "Saved. Every tab read fine." };
}

export async function refreshImsAction(): Promise<void> {
  await refreshSheets();
  refresh();
}

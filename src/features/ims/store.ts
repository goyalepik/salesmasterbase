import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chooseDataSource, readEnv } from "@/lib/env";
import { NO_ENTRIES, type AppEntries, type Receipt, type StatusNote } from "./domain/app";

// The IMS's own entries (bills received, status updates). Supabase tables from 0007_ims.sql on the live site,
// memory in demo. Until the tables exist the IMS still works fully from the sheets; only saving says "one step left".

const BUCKET = "ims-bills";
const mem = globalThis as { __imsReceipts?: Receipt[]; __imsStatus?: StatusNote[]; __imsBills?: Map<string, { type: string; data: Buffer }> };

function db(): SupabaseClient | null {
  const env = readEnv();
  if (chooseDataSource(env) === "demo" || !env.supabaseUrl || !env.serviceRoleKey) return null;
  return createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

type Row = Record<string, unknown>;
const toReceipt = (r: Row): Receipt => ({
  id: r.id as string, at: r.created_at as string, by: r.created_by as string, vendor: r.vendor as string, invoice: r.invoice as string,
  invoiceDate: (r.invoice_date as string) ?? null, po: (r.po as string) ?? null, billedTo: (r.billed_to as string) ?? null,
  terms: (r.terms as Receipt["terms"]) ?? "Cash and Carry", lines: (r.lines as Receipt["lines"]) ?? [], billPath: (r.bill_path as string) ?? null,
  billName: (r.bill_name as string) ?? null, note: (r.note as string) ?? null, voided: !!r.voided,
});

/** Everything entered in the IMS. `ready` is false while the tables aren't there yet. */
export async function loadEntries(): Promise<AppEntries> {
  const client = db();
  if (!client) return { receipts: mem.__imsReceipts ?? [], statuses: mem.__imsStatus ?? [], ready: true };
  const [r, s] = await Promise.all([
    client.from("ims_receipts").select("*").order("created_at", { ascending: false }).limit(2000),
    client.from("ims_status").select("*").order("created_at", { ascending: true }).limit(20000),
  ]);
  if (r.error || s.error) return NO_ENTRIES;
  return {
    receipts: (r.data as Row[]).map(toReceipt),
    statuses: (s.data as Row[]).map((x) => ({ at: x.created_at as string, by: x.created_by as string, kind: x.kind as StatusNote["kind"], ref: x.ref as string, status: x.status as string, eta: (x.eta as string) ?? null, note: (x.note as string) ?? null })),
    ready: true,
  };
}

async function nextReceiptId(client: SupabaseClient | null): Promise<string> {
  let n = 1;
  if (!client) n = (mem.__imsReceipts?.length ?? 0) + 1;
  else {
    const { data } = await client.from("ims_receipts").select("id").order("id", { ascending: false }).limit(1);
    const last = (data?.[0] as Row | undefined)?.id as string | undefined;
    n = last ? Number(last.replace(/\D/g, "")) + 1 : 1;
  }
  return `IMS-IN-${String(n).padStart(5, "0")}`;
}

export async function saveReceipt(r: Omit<Receipt, "id" | "at" | "voided">): Promise<Receipt> {
  const client = db();
  const id = await nextReceiptId(client);
  const receipt: Receipt = { ...r, id, at: new Date().toISOString(), voided: false };
  if (!client) {
    mem.__imsReceipts = [receipt, ...(mem.__imsReceipts ?? [])];
    return receipt;
  }
  const { error } = await client.from("ims_receipts").insert({
    id, created_by: r.by, vendor: r.vendor, invoice: r.invoice, invoice_date: r.invoiceDate, po: r.po, billed_to: r.billedTo, terms: r.terms,
    lines: r.lines, bill_path: r.billPath, bill_name: r.billName, note: r.note,
  });
  if (error) throw new Error(error.message);
  return receipt;
}

export async function voidReceipt(id: string, by: string): Promise<void> {
  const client = db();
  if (!client) {
    mem.__imsReceipts = (mem.__imsReceipts ?? []).map((r) => (r.id === id ? { ...r, voided: true } : r));
    return;
  }
  const { error } = await client.from("ims_receipts").update({ voided: true, voided_by: by, voided_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function addStatus(n: Omit<StatusNote, "at">): Promise<void> {
  const client = db();
  if (!client) {
    mem.__imsStatus = [...(mem.__imsStatus ?? []), { ...n, at: new Date().toISOString() }];
    return;
  }
  const { error } = await client.from("ims_status").insert({ created_by: n.by, kind: n.kind, ref: n.ref, status: n.status, eta: n.eta, note: n.note });
  if (error) throw new Error(error.message);
}

/** Keeps the bill file (photo or PDF) in the private bucket; returns its path. */
export async function storeBill(name: string, type: string, data: Buffer): Promise<string> {
  const path = `${new Date().toISOString().slice(0, 10)}/${Date.now()}-${name.replace(/[^\w.-]+/g, "_").slice(-80)}`;
  const client = db();
  if (!client) {
    (mem.__imsBills ??= new Map()).set(path, { type, data });
    return path;
  }
  let up = await client.storage.from(BUCKET).upload(path, data, { contentType: type, upsert: false });
  if (up.error && /not found|bucket/i.test(up.error.message)) {
    await client.storage.createBucket(BUCKET, { public: false });
    up = await client.storage.from(BUCKET).upload(path, data, { contentType: type, upsert: false });
  }
  if (up.error) throw new Error(up.error.message);
  return path;
}

/** A short-lived link to open a stored bill. */
export async function billLink(path: string): Promise<string | null> {
  const client = db();
  if (!client) return null;
  const { data } = await client.storage.from(BUCKET).createSignedUrl(path, 600);
  return data?.signedUrl ?? null;
}

import "server-only";

// Daily backup of the whole database into a private Supabase Storage bucket ("backups"), one gzip JSON file per day,
// last 30 kept. Read only on the tables: a backup never changes data. Restoring is a manual step (see Settings).

import { gzipSync } from "node:zlib";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readEnv } from "@/lib/env";
import { log } from "@/lib/log";
import type { OpsStore } from "@/lib/ops/store";

const BUCKET = "backups";
const KEEP = 30;
const PAGE = 1000;

/** Every table, in an order that restores cleanly (parents before children). */
export const BACKUP_TABLES = [
  "ops_people", "products", "orders", "order_lines", "payments", "purchase_orders", "procurement_requests", "reservations",
  "stock_movements", "installations", "order_events", "web_sales", "inventory_notes", "action_claims",
  "integration_settings", "slack_channels", "slack_messages", "message_extractions", "exceptions", "processing_attempts", "audit_log",
] as const;

export type BackupOutcome = { ok: true; file: string; rows: number; kb: number; tables: number; skipped: string[] } | { ok: false; error: string };

function client(): SupabaseClient | null {
  const env = readEnv();
  if (!env.supabaseUrl || !env.serviceRoleKey) return null;
  return createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function dumpTable(db: SupabaseClient, table: string): Promise<unknown[] | null> {
  const rows: unknown[] = [];
  for (let from = 0; from < 2_000_000; from += PAGE) {
    const { data, error } = await db.from(table).select("*").range(from, from + PAGE - 1);
    if (error) {
      // A table that does not exist yet (an optional migration) is skipped, not a failure.
      if (/does not exist|not find the table|schema cache/i.test(error.message)) return null;
      throw new Error(`${table}: ${error.message}`);
    }
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/** Takes a backup now. Never throws. Live (Supabase) only: the demo has nothing to keep. */
export async function runBackup(store: OpsStore, now = new Date()): Promise<BackupOutcome> {
  if (store.kind !== "supabase") return { ok: false, error: "Backups run on the live site only." };
  const db = client();
  if (!db) return { ok: false, error: "The database keys are not set." };
  try {
    const tables: Record<string, unknown[]> = {};
    const skipped: string[] = [];
    for (const table of BACKUP_TABLES) {
      const rows = await dumpTable(db, table);
      if (rows) tables[table] = rows;
      else skipped.push(table);
    }
    const rows = Object.values(tables).reduce((sum, list) => sum + list.length, 0);
    const body = gzipSync(Buffer.from(JSON.stringify({ takenAt: now.toISOString(), app: "epik-operations", tables })));
    const file = `epik-backup-${now.toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json.gz`;
    const storage = db.storage;
    const made = await storage.createBucket(BUCKET, { public: false });
    if (made.error && !/exists/i.test(made.error.message)) throw new Error(`bucket: ${made.error.message}`);
    const uploaded = await storage.from(BUCKET).upload(file, body, { contentType: "application/gzip", upsert: true });
    if (uploaded.error) throw new Error(`upload: ${uploaded.error.message}`);
    // Keep the newest 30.
    const listed = await storage.from(BUCKET).list("", { limit: 200, sortBy: { column: "name", order: "desc" } });
    const old = (listed.data ?? []).map((f) => f.name).filter((n) => n.startsWith("epik-backup-")).slice(KEEP);
    if (old.length) await storage.from(BUCKET).remove(old);
    const kb = Math.round(body.length / 1024);
    await store.claimAction(`backup-ok:${now.toISOString()}|${rows}|${kb}`).catch(() => false);
    log("info", "backup_done", { rows, kb, file });
    return { ok: true, file, rows, kb, tables: Object.keys(tables).length, skipped };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    log("error", "backup_failed", { message });
    await store.claimAction(`backup-error:${now.toISOString()}`).catch(() => false);
    return { ok: false, error: message };
  }
}

/** A link that downloads the newest backup, valid for 10 minutes. */
export async function latestBackupLink(): Promise<{ url: string; file: string } | null> {
  const db = client();
  if (!db) return null;
  const listed = await db.storage.from(BUCKET).list("", { limit: 1, sortBy: { column: "name", order: "desc" } });
  const file = listed.data?.find((f) => f.name.startsWith("epik-backup-"))?.name;
  if (!file) return null;
  const signed = await db.storage.from(BUCKET).createSignedUrl(file, 600, { download: true });
  return signed.data?.signedUrl ? { url: signed.data.signedUrl, file } : null;
}

/** "backup-ok:<time>|<rows>|<kb>" → numbers for the status line. */
export function readBackupMark(key: string | null): { at: string; rows: number; kb: number } | null {
  const m = key ? /^backup-ok:([^|]+)\|(\d+)\|(\d+)$/.exec(key) : null;
  return m ? { at: m[1], rows: Number(m[2]), kb: Number(m[3]) } : null;
}

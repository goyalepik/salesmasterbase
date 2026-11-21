import "server-only";

import { createClient } from "@supabase/supabase-js";
import { readEnv } from "@/lib/env";
import { getOpsStore } from "@/lib/ops";
import { MemoryWmsStore } from "./memory-store";
import type { Wms } from "./service";
import type { WmsStore } from "./store";
import { SupabaseWmsStore } from "./supabase-store";
import { wmsEnabled } from "./switch";

const holder = globalThis as { __epikWms?: WmsStore; __epikWmsKind?: string; __epikWmsReady?: { ok: boolean; at: number } };
const RECHECK_MS = 30_000;

/** Are the warehouse tables there? Remembered once yes; a no is checked again after 30 seconds. */
async function tablesReady(store: WmsStore): Promise<boolean> {
  const seen = holder.__epikWmsReady;
  if (seen && (seen.ok || Date.now() - seen.at < RECHECK_MS)) return seen.ok;
  let ok = false;
  try {
    ok = await store.ready();
  } catch {
    ok = false;
  }
  holder.__epikWmsReady = { ok, at: Date.now() };
  return ok;
}

/** True when the warehouse is on but the database step (0006_wms.sql) is still to do. */
export async function wmsSetupNeeded(): Promise<boolean> {
  if (!wmsEnabled()) return false;
  const ops = await getOpsStore();
  if (!ops || ops.kind === "memory") return false;
  return !(await getWms());
}

/** The warehouse stores for this process, or null when the warehouse screens are off or the database tables aren't there yet. */
export async function getWms(): Promise<Wms | null> {
  if (!wmsEnabled()) return null;
  const ops = await getOpsStore();
  if (!ops) return null;
  if (!holder.__epikWms || holder.__epikWmsKind !== ops.kind) {
    if (ops.kind === "memory") {
      holder.__epikWms = new MemoryWmsStore();
    } else {
      const env = readEnv();
      holder.__epikWms = new SupabaseWmsStore(createClient(env.supabaseUrl!, env.serviceRoleKey!, { auth: { persistSession: false, autoRefreshToken: false } }));
    }
    holder.__epikWmsKind = ops.kind;
    holder.__epikWmsReady = undefined;
  }
  if (!(await tablesReady(holder.__epikWms))) return null;
  return { ops, wms: holder.__epikWms };
}

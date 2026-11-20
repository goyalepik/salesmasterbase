import "server-only";

import { createClient } from "@supabase/supabase-js";
import { readEnv } from "@/lib/env";
import { getOpsStore } from "@/lib/ops";
import { MemoryWmsStore } from "./memory-store";
import type { Wms } from "./service";
import type { WmsStore } from "./store";
import { SupabaseWmsStore } from "./supabase-store";
import { wmsEnabled } from "./switch";

const holder = globalThis as { __epikWms?: WmsStore; __epikWmsKind?: string };

/** The warehouse stores for this process, or null when the warehouse screens are off (or the database isn't set up). */
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
  }
  return { ops, wms: holder.__epikWms };
}

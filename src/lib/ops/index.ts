import "server-only";

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chooseDataSource, readEnv } from "@/lib/env";
import { log } from "@/lib/log";
import { buildDemoSeed } from "@/lib/ops/demo-seed";
import { MemoryOpsStore } from "@/lib/ops/memory-store";
import { loadSeed, type OpsSeed } from "@/lib/ops/snapshot";
import type { OpsStore } from "@/lib/ops/store";
import { SupabaseOpsStore } from "@/lib/ops/supabase-store";

const holder = globalThis as { __epikOps?: Promise<OpsStore>; __epikOpsKind?: string };

export const LOCAL_SEED_PATH = join(process.cwd(), "data", "ops-seed.local.json");

/** Where demo data came from, shown in the UI so nobody mistakes it for live data. */
export function demoSeedLabel(): "imported sheets" | "invented sample" {
  return existsSync(LOCAL_SEED_PATH) ? "imported sheets" : "invented sample";
}

async function demoStore(): Promise<OpsStore> {
  const store = new MemoryOpsStore();
  let seed: OpsSeed;
  if (existsSync(LOCAL_SEED_PATH)) {
    seed = JSON.parse(readFileSync(LOCAL_SEED_PATH, "utf8")) as OpsSeed;
  } else {
    seed = buildDemoSeed(new Date());
  }
  const report = await loadSeed(store, seed);
  log("info", "ops_demo_loaded", { source: seed.source, orders: report.orders });
  return store;
}

/** The operations store for this process. Demo: in memory. Live: Supabase. Misconfigured: null. */
export async function getOpsStore(): Promise<OpsStore | null> {
  const env = readEnv();
  const source = chooseDataSource(env);
  if (source === "misconfigured") return null;
  if (holder.__epikOps && holder.__epikOpsKind === source) return holder.__epikOps;
  if (source === "demo") {
    holder.__epikOps = demoStore();
  } else {
    const client = createClient(env.supabaseUrl!, env.serviceRoleKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    holder.__epikOps = Promise.resolve(new SupabaseOpsStore(client));
  }
  holder.__epikOpsKind = source;
  return holder.__epikOps;
}

export async function requireOpsStore(): Promise<OpsStore> {
  const store = await getOpsStore();
  if (!store) throw new Error("Live mode is not configured.");
  return store;
}

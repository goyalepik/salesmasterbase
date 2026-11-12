import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cache } from "react";
import { createClient } from "@supabase/supabase-js";
import { readEnv } from "@/lib/env";
import { log } from "@/lib/log";
import { MIS_LOCAL_FILE, downloadMis } from "../lib/storage";
import type { MisReport } from "../lib/types";

export type LoadedMis = { report: MisReport | null; problem: string | null };

/** The copy on this computer when there is one, otherwise the one in Supabase Storage (what the live site shows). */
export const loadMis = cache(async (): Promise<LoadedMis> => {
  try {
    const local = JSON.parse(await readFile(join(process.cwd(), "data", MIS_LOCAL_FILE), "utf8")) as MisReport;
    return { report: local, problem: null };
  } catch {
    // Not on this computer: read the stored copy.
  }
  const env = readEnv();
  if (!env.supabaseUrl || !env.serviceRoleKey) return { report: null, problem: "This site has no Supabase keys, so it cannot fetch the MIS." };
  try {
    const db = createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const report = await downloadMis<MisReport>(db);
    return { report, problem: report ? null : "The MIS has not been uploaded yet. Run scripts/push-mis.ts once." };
  } catch (error) {
    log("error", "mis_load_failed", { error: error instanceof Error ? error.message : "unknown" });
    return { report: null, problem: "Could not read the MIS from Supabase." };
  }
});

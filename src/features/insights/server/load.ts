import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { readEnv } from "@/lib/env";
import { log } from "@/lib/log";
import { STORED_FILES, downloadJson } from "../lib/storage";
import type { CallNotes, InsightsReport } from "../lib/types";

export type LoadedInsights = { report: InsightsReport | null; notes: CallNotes | null; problem: string | null };

async function readLocal<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(join(process.cwd(), "data", file), "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * The report on this computer when it has one (fresh from scripts/analyse-demos.ts), otherwise the copy
 * uploaded to Supabase with --push, which is what the live site shows.
 */
export async function loadInsights(): Promise<LoadedInsights> {
  const [report, notes] = await Promise.all([readLocal<InsightsReport>("demo-insights.local.json"), readLocal<CallNotes>("demo-call-notes.local.json")]);
  if (report) return { report, notes, problem: null };

  const env = readEnv();
  if (!env.supabaseUrl || !env.serviceRoleKey) return { report: null, notes: null, problem: "This site has no Supabase keys, so it cannot fetch the stored report." };
  const db = createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const [stored, storedNotes] = await Promise.all([
      downloadJson<InsightsReport>(db, STORED_FILES.report),
      downloadJson<CallNotes>(db, STORED_FILES.notes),
    ]);
    return { report: stored, notes: storedNotes, problem: stored ? null : "No report has been uploaded to Supabase yet." };
  } catch (error) {
    log("error", "insights_load_failed", { error: error instanceof Error ? error.message : "unknown" });
    return { report: null, notes: null, problem: "Could not read the stored report from Supabase." };
  }
}

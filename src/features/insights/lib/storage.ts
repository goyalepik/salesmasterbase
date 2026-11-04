// The live site has no copy of the demo sheet, so the finished report (totals and rates only, no customer details)
// is copied to a private Supabase Storage bucket. The analysis script uploads it; the /insights page reads it.

import type { SupabaseClient } from "@supabase/supabase-js";

export const INSIGHTS_BUCKET = "insights";
export const STORED_FILES = { report: "demo-insights.json", notes: "demo-call-notes.json" } as const;

/** Upload the report files, creating the private bucket the first time. Uploading again replaces them. */
export async function uploadInsights(db: SupabaseClient, files: { name: string; json: string }[]): Promise<void> {
  const { error: missing } = await db.storage.getBucket(INSIGHTS_BUCKET);
  if (missing) {
    const { error } = await db.storage.createBucket(INSIGHTS_BUCKET, { public: false });
    if (error && !/exist/i.test(error.message)) throw new Error(`Could not create the "${INSIGHTS_BUCKET}" storage bucket: ${error.message}`);
  }
  for (const f of files) {
    const { error } = await db.storage.from(INSIGHTS_BUCKET).upload(f.name, f.json, { upsert: true, contentType: "application/json", cacheControl: "60" });
    if (error) throw new Error(`Could not upload ${f.name}: ${error.message}`);
  }
}

/** One stored file, parsed. Null when it has not been uploaded yet. */
export async function downloadJson<T>(db: SupabaseClient, name: string): Promise<T | null> {
  const { data, error } = await db.storage.from(INSIGHTS_BUCKET).download(name);
  if (error || !data) return null;
  return JSON.parse(await data.text()) as T;
}

// The public repo never holds the MIS numbers. Localhost reads data/mis-oct26.local.json; the live site reads the
// copy in the private Supabase Storage bucket "mis", uploaded once with scripts/push-mis.ts.

import type { SupabaseClient } from "@supabase/supabase-js";

export const MIS_BUCKET = "mis";
export const MIS_FILE = "mis-oct26.json";
export const MIS_LOCAL_FILE = "mis-oct26.local.json";

export async function uploadMis(db: SupabaseClient, json: string): Promise<void> {
  const { error: missing } = await db.storage.getBucket(MIS_BUCKET);
  if (missing) {
    const { error } = await db.storage.createBucket(MIS_BUCKET, { public: false });
    if (error && !/exist/i.test(error.message)) throw new Error(`Could not create the "${MIS_BUCKET}" bucket: ${error.message}`);
  }
  const { error } = await db.storage.from(MIS_BUCKET).upload(MIS_FILE, json, { upsert: true, contentType: "application/json", cacheControl: "300" });
  if (error) throw new Error(`Could not upload ${MIS_FILE}: ${error.message}`);
}

export async function downloadMis<T>(db: SupabaseClient): Promise<T | null> {
  const { data, error } = await db.storage.from(MIS_BUCKET).download(MIS_FILE);
  if (error || !data) return null;
  return JSON.parse(await data.text()) as T;
}

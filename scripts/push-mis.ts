/**
 * Uploads the MIS snapshot (data/mis-oct26.local.json) to the private Supabase Storage bucket "mis",
 * which is what the live /mis page shows. The numbers never go into git (the repo is public).
 *
 *   npx tsx --env-file=.env.local scripts/push-mis.ts
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { MIS_LOCAL_FILE, uploadMis } from "../src/features/mis/lib/storage";
import { readEnv } from "../src/lib/env";

async function main() {
  const env = readEnv();
  if (!env.supabaseUrl || !env.serviceRoleKey) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (use --env-file=.env.local).");
  const json = await readFile(join(process.cwd(), "data", MIS_LOCAL_FILE), "utf8");
  const parsed = JSON.parse(json) as { month?: string; exec?: unknown[] };
  if (!parsed.month || !Array.isArray(parsed.exec)) throw new Error(`${MIS_LOCAL_FILE} does not look like an MIS snapshot.`);
  const db = createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  await uploadMis(db, json);
  console.log(`Uploaded the ${parsed.month} MIS (${Math.round(json.length / 1024)} KB).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

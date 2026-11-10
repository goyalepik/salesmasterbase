// Deploy step: copies the Shopify product list from the database into src/lib/ops/catalogue-snapshot.ts,
// so the Slack product search answers from the site itself. Never fails the build: on any problem the
// empty file stays and the app reads the database as before. Runs only on Vercel (or with CATALOGUE_OUT set).

import { writeFileSync } from "node:fs";

const out = process.env.CATALOGUE_OUT || "src/lib/ops/catalogue-snapshot.ts";
const skip = (why) => {
  console.log(`catalogue snapshot: skipped (${why})`);
  process.exit(0);
};

if (!process.env.VERCEL && !process.env.CATALOGUE_OUT) skip("not a Vercel build");
const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/$/, "");
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
if (!url || !key) skip("database settings missing");

const rows = [];
try {
  for (let offset = 0; offset < 20000; offset += 1000) {
    const query = "select=sku,name,brand,list_price_minor,shopify_status&active=eq.true&shopify_variant_id=not.is.null&order=sku";
    const response = await fetch(`${url}/rest/v1/products?${query}&limit=1000&offset=${offset}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) skip(`database answered ${response.status}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < 1000) break;
  }
} catch (error) {
  skip(error instanceof Error ? error.message : "read failed");
}
if (rows.length < 100) skip(`only ${rows.length} products found`);

const data = rows.map((r) => [r.sku, r.name ?? "", r.brand ?? null, r.list_price_minor ?? null, r.shopify_status ?? null]);
writeFileSync(
  out,
  `// Generated at deploy time by scripts/catalogue-snapshot.mjs. Do not edit by hand.\n\n` +
    `export type SnapshotRow = [sku: string, name: string, brand: string | null, listPriceMinor: number | null, shopifyStatus: string | null];\n\n` +
    `export const CATALOGUE_SNAPSHOT: SnapshotRow[] = ${JSON.stringify(data)};\n`,
);
console.log(`catalogue snapshot: ${data.length} products built into the site`);

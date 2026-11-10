/**
 * Copies the Shopify product list into the live product list now (the app also does this by itself every 6 hours).
 * Reads Shopify; writes only the products table (names, prices and the Shopify mark). Stock and orders are not touched.
 *
 *   npx tsx scripts/shopify-catalog.ts        (reads .env.local)
 */
import { existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { SupabaseOpsStore } from "../src/lib/ops/supabase-store";
import { catalogItems, fetchShopifyVariants } from "../src/lib/shopify/catalog";
import { shopifyConfigFromEnv, shopifyGraphql } from "../src/lib/shopify/client";

async function main() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const cfg = shopifyConfigFromEnv();
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!cfg || !url || !key) throw new Error("Needs the Shopify settings and SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
  const items = catalogItems(await fetchShopifyVariants(shopifyGraphql(cfg)));
  if (items.length < 50) throw new Error(`Shopify returned only ${items.length} products; nothing changed.`);
  const store = new SupabaseOpsStore(createClient(url, key, { auth: { persistSession: false } }));
  const result = await store.applyShopifyCatalog(items);
  console.log(`Shopify products: ${items.length}. Updated ${result.updated}, added ${result.added}, unmarked ${result.removed}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

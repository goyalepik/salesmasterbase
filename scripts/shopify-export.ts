/**
 * Saves the Shopify product list as a spreadsheet (CSV). Read-only: nothing in Shopify or the database changes.
 *
 *   npx tsx scripts/shopify-export.ts [file]      (reads .env.local; default ~/Desktop/EPIK-Shopify-products.csv)
 */
import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { catalogItems, fetchShopifyVariants } from "../src/lib/shopify/catalog";
import { shopifyConfigFromEnv, shopifyGraphql } from "../src/lib/shopify/client";

const cell = (value: string | number | null) => {
  const text = value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

async function main() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const cfg = shopifyConfigFromEnv();
  if (!cfg) throw new Error("Needs the Shopify settings in .env.local.");
  const items = catalogItems(await fetchShopifyVariants(shopifyGraphql(cfg)))
    .sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === "ACTIVE" ? -1 : 1));
  const file = process.argv[2] ?? join(homedir(), "Desktop", "EPIK-Shopify-products.csv");
  const rows = [
    ["SKU", "Product name", "Price (Rs)", "Where", "Category"],
    ...items.map((i) => [i.sku, i.name, i.priceMinor === null ? null : i.priceMinor / 100, i.status === "ACTIVE" ? "On website" : "Store only (draft)", i.category]),
  ];
  // The BOM makes Excel read the names correctly.
  writeFileSync(file, "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n");
  const onWebsite = items.filter((i) => i.status === "ACTIVE").length;
  console.log(`Saved ${items.length} products (${onWebsite} on the website, ${items.length - onWebsite} store only) to ${file}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

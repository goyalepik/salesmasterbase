// The Shopify product list, built into the site at deploy time by scripts/catalogue-snapshot.mjs (Vercel builds only),
// so the Slack product search needs no database. Empty here: then the app reads the list from the database instead.
// A new deploy picks up new Shopify products. Do not edit by hand.

export type SnapshotRow = [sku: string, name: string, brand: string | null, listPriceMinor: number | null, shopifyStatus: string | null];

export const CATALOGUE_SNAPSHOT: SnapshotRow[] = [];

// The Shopify catalogue → the product list the Slack sale form searches. Read-only on the Shopify side.

import type { ShopifyCatalogItem } from "@/lib/ops/types";
import type { Graphql } from "./client";

export type ShopifyVariantNode = {
  id: string;
  sku: string | null;
  title: string;
  price: string;
  product: { title: string; status: string; productType: string | null };
};

const VARIANTS = `query Catalogue($after: String) {
  productVariants(first: 250, after: $after, query: "-product_status:archived") {
    pageInfo { hasNextPage endCursor }
    nodes { id sku title price product { title status productType } }
  }
}`;

/** Every variant of every product that isn't archived. About 3,000 variants take ~10 seconds. */
export async function fetchShopifyVariants(gql: Graphql): Promise<ShopifyVariantNode[]> {
  const out: ShopifyVariantNode[] = [];
  let after: string | null = null;
  for (let page = 0; page < 80; page++) {
    const data: { productVariants: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ShopifyVariantNode[] } } = await gql(VARIANTS, { after });
    out.push(...data.productVariants.nodes);
    if (!data.productVariants.pageInfo.hasNextPage) break;
    after = data.productVariants.pageInfo.endCursor;
  }
  return out;
}

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

/** The catalogue as product-list rows. Pure: unit-tested without Shopify. Skips variants with no SKU and archived products. */
export function catalogItems(nodes: ShopifyVariantNode[]): ShopifyCatalogItem[] {
  const bySku = new Map<string, ShopifyCatalogItem>();
  for (const v of nodes) {
    const sku = v.sku?.trim().toLowerCase();
    const status = v.product.status === "ACTIVE" ? "ACTIVE" : v.product.status === "DRAFT" ? "DRAFT" : null;
    if (!sku || !status) continue;
    // Two variants with one SKU: keep the one on the website.
    if (bySku.get(sku)?.status === "ACTIVE") continue;
    const variant = clean(v.title);
    const name = clean(v.product.title) + (variant && variant !== "Default Title" ? ` - ${variant}` : "");
    const price = Number(v.price);
    bySku.set(sku, {
      sku,
      name: name.slice(0, 300),
      priceMinor: Number.isFinite(price) && price > 0 ? Math.round(price * 100) : null,
      variantId: v.id,
      status,
      category: v.product.productType?.trim() || null,
      needsInstallation: /robot(ic)? vac|robo vac|robot.{0,20}mop/i.test(name),
    });
  }
  return [...bySku.values()];
}

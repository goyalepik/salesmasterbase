// Product search used by the Slack product picker and the demo store. Pure: no database.

import type { Product } from "@/lib/ops/types";

const norm = (value: string | null | undefined) => (value ?? "").toLowerCase();

/**
 * Products whose SKU, name or brand contain every typed word, best first: exact SKU, then names that start with
 * the first word, then (with `preferActive`) the ones on the website, then shorter names.
 */
export function rankProducts(products: Product[], q: string, limit: number, opts: { preferActive?: boolean } = {}): Product[] {
  const terms = norm(q).split(/\s+/).filter(Boolean);
  if (!terms.length) {
    const list = opts.preferActive ? [...products].sort((a, b) => Number(b.shopifyStatus === "ACTIVE") - Number(a.shopifyStatus === "ACTIVE")) : products;
    return list.slice(0, limit);
  }
  const whole = norm(q).trim();
  return products
    .map((product) => {
      const hay = `${norm(product.sku)} ${norm(product.name)} ${norm(product.brand)}`;
      if (!terms.every((term) => hay.includes(term))) return null;
      const score = (norm(product.sku) === whole ? 100 : 0) + (norm(product.name).startsWith(terms[0]!) ? 10 : 0) + (opts.preferActive && product.shopifyStatus === "ACTIVE" ? 5 : 0) - product.name.length / 100;
      return { product, score };
    })
    .filter((item): item is { product: Product; score: number } => item !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.product);
}

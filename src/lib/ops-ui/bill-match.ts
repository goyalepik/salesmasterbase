import type { OpsStore } from "@/lib/ops/store";
import type { Product } from "@/lib/ops/types";
import type { BillLine } from "@/lib/ai/bill";

export type BillMatch = {
  description: string;
  qty: number;
  unitCostMinor: number | null;
  serials: string[];
  match: { sku: string; name: string } | null;
  candidates: Array<{ sku: string; name: string }>;
  /** Open brand POs for the matched SKU: receiving against one keeps "incoming" right. */
  pos: Array<{ id: string; poNumber: string; vendor: string | null; pending: number }>;
};

/** "iPhone 15 (128GB) Black" → ["iphone", "15", "128", "gb", "black"]. */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/([a-z])(\d)|(\d)([a-z])/g, (_, a, b, c, d) => (a ? `${a} ${b}` : `${c} ${d}`))
    .split(/[^a-z0-9]+/)
    .filter((t) => (t.length > 1 || /\d/.test(t)) && !STOP.has(t));
}

const STOP = new Set(["the", "with", "and", "for", "of", "new", "in", "to"]);

/** Words that mean a different product: a variant (Plus, Pro) or a part (kit, brush). Costly when the bill does not say them. */
const VARIANT = new Set([
  "plus", "pro", "max", "ultra", "mini", "lite", "fe", "se",
  "kit", "accessory", "accessories", "brush", "brushes", "filter", "filters", "bag", "bags", "pad", "pads",
  "compatible", "pack", "case", "cover", "charger", "cable", "adapter", "refill", "solution", "spare", "replacement", "protector", "glass",
]);

/** Share of the bill line's model words found in the product (0–1), up to 0.1 more for the rest of the description, minus 0.25 per variant or part word the bill does not say. */
export function matchScore(line: Pick<BillLine, "model" | "description">, product: Pick<Product, "name" | "brand" | "sku">): number {
  const want = [...new Set(tokens(line.model))];
  if (!want.length) return 0;
  const have = new Set(tokens(`${product.name} ${product.brand ?? ""} ${product.sku}`));
  const hits = want.filter((t) => have.has(t)).length;
  // The full description breaks ties between close models (colour, storage).
  const said = [...new Set(tokens(line.description))];
  const tie = said.length ? said.filter((t) => have.has(t)).length / said.length : 0;
  const onBill = new Set([...want, ...said]);
  const wrongKind = [...have].filter((t) => VARIANT.has(t) && !onBill.has(t)).length;
  return hits / want.length + tie * 0.1 - wrongKind * 0.25;
}

async function candidatesFor(store: OpsStore, line: BillLine): Promise<Product[]> {
  const words = line.model.split(/\s+/).filter(Boolean);
  const queries = [...new Set([line.model, words.slice(0, 3).join(" "), words.slice(0, 2).join(" "), words[0] ?? ""].filter((q) => q.trim().length >= 2))];
  const pool = new Map<string, Product>();
  for (const q of queries) {
    for (const product of await store.searchProducts(q, 25)) pool.set(product.sku, product);
    if (pool.size >= 60) break;
  }
  return [...pool.values()];
}

/** Matches each bill line to a catalogue SKU and lists open POs for it. The person reviews every match before saving. */
export async function matchBill(store: OpsStore, lines: BillLine[], vendor: string | null = null): Promise<BillMatch[]> {
  const vendorWords = new Set(tokens(vendor ?? "").filter((t) => !["pvt", "ltd", "private", "limited", "llp", "india", "retail"].includes(t)));
  const sameVendor = (name: string | null) => tokens(name ?? "").some((t) => vendorWords.has(t));
  return Promise.all(
    lines.map(async (line) => {
      const ranked = (await candidatesFor(store, line))
        .map((product) => ({ product, score: matchScore(line, product) }))
        .sort((a, b) => b.score - a.score);
      const best = ranked[0] && ranked[0].score >= 0.6 ? ranked[0].product : null;
      // The bill's own vendor first, then the PO due soonest: that is the PO these goods most likely belong to.
      const pos = best
        ? (await store.listPurchaseOrders({ status: "open", sku: best.sku }))
            .filter((po) => po.qtyOrdered > po.qtyReceived)
            .sort((a, b) => Number(sameVendor(b.vendor)) - Number(sameVendor(a.vendor)) || (a.eta ?? "9999").localeCompare(b.eta ?? "9999") || a.createdAt.localeCompare(b.createdAt))
        : [];
      return {
        description: line.description,
        qty: line.qty,
        unitCostMinor: line.unitCost == null ? null : Math.round(line.unitCost * 100),
        serials: line.serials,
        match: best ? { sku: best.sku, name: best.name } : null,
        candidates: ranked.slice(0, 5).map(({ product }) => ({ sku: product.sku, name: product.name })),
        pos: pos.map((po) => ({ id: po.id, poNumber: po.poNumber, vendor: po.vendor, pending: po.qtyOrdered - po.qtyReceived })),
      };
    }),
  );
}

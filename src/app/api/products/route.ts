import { NextResponse, type NextRequest } from "next/server";
import { getOpsStore } from "@/lib/ops";

/** Catalogue search for the product picker. Top 20 matches, small payload. */
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (q.length < 2) return NextResponse.json({ items: [] });
  const store = await getOpsStore();
  if (!store) return NextResponse.json({ items: [], error: "Catalogue is not available." }, { status: 503 });
  const products = await store.searchProducts(q, 20);
  return NextResponse.json(
    { items: products.map((p) => ({ sku: p.sku, name: p.name, brand: p.brand, listPriceMinor: p.listPriceMinor })) },
    { headers: { "cache-control": "private, max-age=30" } },
  );
}

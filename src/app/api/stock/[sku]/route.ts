import { NextResponse, type NextRequest } from "next/server";
import { getOpsStore } from "@/lib/ops";
import { stockDetail } from "@/lib/ops-ui/serials";

/** Serial numbers on the shelf and recent movements for one product. Behind the dashboard sign-in, like every /api route. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ sku: string }> }) {
  const { sku: raw } = await params;
  const sku = decodeURIComponent(raw).trim().toLowerCase().slice(0, 60);
  const store = await getOpsStore();
  if (!store) return NextResponse.json({ error: "Stock is not available." }, { status: 503 });
  const [level, movements] = await Promise.all([store.stockFor(sku), store.listMovements(sku, 1000)]);
  if (!level) return NextResponse.json({ error: "Product not found." }, { status: 404 });
  return NextResponse.json({ level, ...stockDetail(movements, level.onHand) }, { headers: { "cache-control": "private, no-store" } });
}

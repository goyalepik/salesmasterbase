import { NextResponse } from "next/server";
import { getOpsStore } from "@/lib/ops";
import { buildExport, EXPORT_KINDS, type ExportKind } from "@/lib/ops/export";

export const maxDuration = 60;

/** /api/export/orders and friends. Behind the same sign-in as the dashboard (see proxy.ts). */
export async function GET(_request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!(EXPORT_KINDS as readonly string[]).includes(kind)) return NextResponse.json({ error: "Unknown download." }, { status: 404 });
  const store = await getOpsStore();
  if (!store) return NextResponse.json({ error: "The operations database is not configured." }, { status: 503 });
  const csv = await buildExport(store, kind as ExportKind);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="epik-${kind}-${day}.csv"`,
      "cache-control": "no-store",
    },
  });
}

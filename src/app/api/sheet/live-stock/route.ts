// The app's live stock as CSV, for the "EPIK App live stock" tab in the team sheet:
//   =IMPORTDATA("https://salesmasterbase.vercel.app/api/sheet/live-stock?key=<SHEET_SYNC_TOKEN>")
// Stock only: no customer names or phones. Needs the key; read-only.

import { createHash, timingSafeEqual } from "node:crypto";
import { getOpsStore } from "@/lib/ops";
import { liveStockRows } from "@/lib/sheets/live-stock";
import { pullTeamSheet } from "@/lib/sheets/run";
import { sheetSyncConfigFromEnv } from "@/lib/sheets/sheet-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const digest = (text: string) => createHash("sha256").update(text).digest();

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request) {
  const cfg = sheetSyncConfigFromEnv();
  if (!cfg?.feedKey) return new Response("The live stock feed is off. Set SHEET_SYNC_FROM and SHEET_SYNC_TOKEN.", { status: 503 });
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!timingSafeEqual(digest(key), digest(cfg.feedKey))) return new Response("Not allowed.", { status: 401 });
  const store = await getOpsStore();
  if (!store) return new Response("The operations database is not configured.", { status: 503 });
  // Google refreshes the formula on its own; take the chance to bring the sheet's new rows in first.
  await pullTeamSheet(store);
  const rows = liveStockRows(await store.stockLevels({ only: "all", limit: 10_000 }), new Date());
  const width = rows.reduce((w, r) => Math.max(w, r.length), 1);
  const body = rows.map((r) => Array.from({ length: width }, (_, i) => csvCell(r[i] ?? "")).join(",")).join("\n");
  return new Response(body, { headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store" } });
}

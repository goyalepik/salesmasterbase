// Called every few minutes by the Apps Script inside the team's sheet (EPIK's copy of Inventory Masterbase).
// GET: the sync start date. POST: the sheet's rows in, the app's stock and dispatches out.
// Needs `Authorization: Bearer <SHEET_SYNC_TOKEN>`. Every stock change goes through service.ts.

import { createHash, timingSafeEqual } from "node:crypto";
import { getOpsStore } from "@/lib/ops";
import { applySheetRows } from "@/lib/ops/service";
import { log } from "@/lib/log";
import { parseSheetPayload, sheetReply, sheetSyncConfigFromEnv } from "@/lib/sheets/sheet-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SHEET_ACTOR = { name: "Team sheet", slackUserId: null };
const digest = (text: string) => createHash("sha256").update(text).digest();

async function guard(request: Request) {
  const cfg = sheetSyncConfigFromEnv();
  if (!cfg) return { error: Response.json({ error: "Sheet sync is off. Set SHEET_SYNC_TOKEN and SHEET_SYNC_FROM." }, { status: 503 }) };
  if (!timingSafeEqual(digest(request.headers.get("authorization") ?? ""), digest(`Bearer ${cfg.token}`))) return { error: Response.json({ error: "Not allowed." }, { status: 401 }) };
  const store = await getOpsStore();
  if (!store) return { error: Response.json({ error: "The operations database is not configured." }, { status: 503 }) };
  return { cfg, store };
}

export async function GET(request: Request) {
  const g = await guard(request);
  if ("error" in g) return g.error;
  return Response.json({ from: g.cfg.from });
}

export async function POST(request: Request) {
  const g = await guard(request);
  if ("error" in g) return g.error;
  const { cfg, store } = g;
  const now = new Date();
  try {
    const body = await request.json().catch(() => null);
    const { rows, counts } = parseSheetPayload(body);
    const applied = await applySheetRows(store, rows, cfg.from, SHEET_ACTOR);
    const reply = await sheetReply(store, cfg.from, counts, now);
    await store.claimAction(`sheet-sync-ok:${now.toISOString()}`).catch(() => false);
    if (applied.inward || applied.dispatched || applied.returned) log("info", "sheet_sync_applied", { inward: applied.inward, dispatched: applied.dispatched, returned: applied.returned });
    return Response.json({ from: cfg.from, received: rows.length, applied, ...reply });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    log("error", "sheet_sync_failed", { message });
    await store.claimAction(`sheet-sync-error:${now.toISOString()}`).catch(() => false);
    return Response.json({ error: `Sync failed: ${message.slice(0, 200)}` }, { status: 500 });
  }
}

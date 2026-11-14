// Called every 10 minutes by a Supabase scheduled job, so website orders come in (and CDEs get credited) even
// when nobody has the dashboard open. Also reads new rows from the team's inventory sheet, and puts new sales and status changes in the sales sheet (when connected). Needs `Authorization: Bearer <CRON_SECRET>`.

import { createHash, timingSafeEqual } from "node:crypto";
import { getOpsStore } from "@/lib/ops";
import { syncShopify } from "@/lib/shopify/run";
import { pullTeamSheet } from "@/lib/sheets/run";
import { sweepSalesSheet } from "@/lib/sheets/sales-sheet-run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const digest = (text: string) => createHash("sha256").update(text).digest();

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  if (secret.length < 16) return false;
  return timingSafeEqual(digest(request.headers.get("authorization") ?? ""), digest(`Bearer ${secret}`));
}

async function handle(request: Request): Promise<Response> {
  if (!(process.env.CRON_SECRET?.trim().length ?? 0)) return Response.json({ error: "CRON_SECRET is not set." }, { status: 503 });
  if (!authorised(request)) return Response.json({ error: "Not allowed." }, { status: 401 });
  const store = await getOpsStore();
  if (!store) return Response.json({ error: "The operations database is not configured." }, { status: 503 });
  const [result, sheet] = await Promise.all([syncShopify(store), pullTeamSheet(store)]);
  // After Shopify, so new website orders are in the sales sheet too.
  const salesSheet = await sweepSalesSheet(store);
  return Response.json({
    ran: result.ran,
    created: result.created.length,
    linked: result.linked.length,
    flagged: result.flagged.length,
    cancelled: result.cancelled ?? 0,
    paymentUpdated: result.paymentUpdated ?? 0,
    matched: result.matched ?? 0,
    error: result.error ?? null,
    salesSheet: salesSheet.ran ? (salesSheet.ok ? { added: salesSheet.added, updated: salesSheet.updated } : { error: salesSheet.error }) : { skipped: salesSheet.reason },
    sheet: sheet.ran ? (sheet.ok ? { inward: sheet.applied.inward, dispatched: sheet.applied.dispatched, problems: sheet.applied.problems.length } : { error: sheet.error }) : { skipped: sheet.reason },
  });
}

export const GET = handle;
export const POST = handle;

// Daily backup, called by Vercel Cron (vercel.json) with `Authorization: Bearer <CRON_SECRET>`.

import { createHash, timingSafeEqual } from "node:crypto";
import { runBackup } from "@/lib/backup";
import { getOpsStore } from "@/lib/ops";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const digest = (text: string) => createHash("sha256").update(text).digest();

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  if (secret.length < 16) return Response.json({ error: "CRON_SECRET is not set." }, { status: 503 });
  if (!timingSafeEqual(digest(request.headers.get("authorization") ?? ""), digest(`Bearer ${secret}`))) return Response.json({ error: "Not allowed." }, { status: 401 });
  const store = await getOpsStore();
  if (!store) return Response.json({ error: "The database is not configured." }, { status: 503 });
  const result = await runBackup(store);
  return Response.json(result, { status: result.ok ? 200 : 500 });
}

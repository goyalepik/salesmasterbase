import { timingSafeEqual, createHash } from "node:crypto";
import { sagepilotConfig } from "@/features/cx/data/adapters/sagepilot/client";
import { syncStep } from "@/features/cx/server/sagepilot-sync";
import { getCxStore } from "@/features/cx/server/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const digest = (s: string) => createHash("sha256").update(s).digest();

/**
 * Scheduled sync step (v5 5.2): Vercel Cron (Pro plan: every 2 minutes) or any scheduler, with
 * "Authorization: Bearer <CRON_SECRET>". Without a scheduler, open consoles trigger the same step every 2 minutes.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || secret.length < 16 || !timingSafeEqual(digest(given), digest(secret))) return Response.json({ error: "Not allowed." }, { status: 401 });
  if (process.env.NEXT_PUBLIC_CX_PILOT !== "true") return Response.json({ skipped: "pilot off" });
  const config = sagepilotConfig();
  if (!config) return Response.json({ skipped: "Sagepilot not connected" });
  const report = await syncStep(getCxStore(), config).catch((e: unknown) => ({ error: e instanceof Error ? e.message : "failed" }));
  return Response.json(report);
}

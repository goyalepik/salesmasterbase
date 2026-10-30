import { runBriefing, type AgentResult } from "@/lib/ai/agent";
import { allowAsk } from "@/lib/ai/rate-limit";
import { agentConfig, toolContext } from "@/lib/ai/runtime";
import { todayIst } from "@/lib/ai/util";
import { isSameOrigin } from "@/lib/same-origin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CACHE_MS = 10 * 60 * 1000;
const holder = globalThis as { __epikBriefing?: { day: string; at: number; result: AgentResult } };

/** Writes the founder briefing. A written briefing is reused for 10 minutes unless `fresh` is set. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Cross-origin request refused." }, { status: 403 });
  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  const now = new Date();
  const cached = holder.__epikBriefing;
  if (!fresh && cached && cached.day === todayIst(now) && now.getTime() - cached.at < CACHE_MS) {
    return Response.json({ ...cached.result, cachedAt: new Date(cached.at).toISOString() });
  }
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowAsk(`briefing:${forwarded}`, now.getTime(), 4)) {
    return Response.json({ error: "The briefing was refreshed too often. Wait a minute." }, { status: 429 });
  }
  const ctx = await toolContext();
  if (!ctx) return Response.json({ error: "The operations data is not configured." }, { status: 503 });
  const result = await runBriefing({ ctx, config: agentConfig() });
  if (result.provider !== "rules") holder.__epikBriefing = { day: todayIst(now), at: now.getTime(), result };
  return Response.json({ ...result, cachedAt: null });
}

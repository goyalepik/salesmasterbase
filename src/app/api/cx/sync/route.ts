import { sagepilotConfig, SagepilotError } from "@/features/cx/data/adapters/sagepilot/client";
import { handle, json } from "@/features/cx/server/http";
import { RANGES, syncStep } from "@/features/cx/server/sagepilot-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One step of the read-only Sagepilot sync (by last activity, no cap). The answer says whether the range is complete;
 * the page calls again until it is. L1 and Admin. { restart: true, range } starts a fresh full read of that range.
 */
export async function POST(request: Request) {
  return handle(async ({ store }) => {
    const config = sagepilotConfig();
    if (!config) return json({ error: "Sagepilot is not connected. Set CX_SAGEPILOT_ENABLED=true and SAGEPILOT_API_TOKEN." }, 503);
    const { range, restart } = (await request.json().catch(() => ({}))) as { range?: string; restart?: boolean };
    if (range && !RANGES.has(range)) return json({ error: "Unknown range." }, 400);
    try {
      const report = await syncStep(store, config, { range, restart: Boolean(restart) });
      return json({ ...report, added: report.created });
    } catch (error) {
      if (error instanceof SagepilotError) return json({ error: error.message }, error.status === 429 ? 429 : 502);
      throw error;
    }
  }, { can: "sync" });
}

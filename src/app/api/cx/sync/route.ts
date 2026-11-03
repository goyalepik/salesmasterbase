import { sagepilotConfig, SagepilotError } from "@/features/cx/data/adapters/sagepilot/client";
import { handle, json } from "@/features/cx/server/http";
import { RANGES, syncSagepilot } from "@/features/cx/server/sagepilot-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Pull tickets from Sagepilot into the shared store (read-only towards Sagepilot). L1 and Admin. */
export async function POST(request: Request) {
  return handle(async ({ store }) => {
    const config = sagepilotConfig();
    if (!config) return json({ error: "Sagepilot is not connected. Set CX_SAGEPILOT_ENABLED=true and SAGEPILOT_API_TOKEN." }, 503);
    const { range = "last_7_days" } = (await request.json().catch(() => ({}))) as { range?: string };
    if (!RANGES.has(range)) return json({ error: "Unknown range." }, 400);
    try {
      return json(await syncSagepilot(store, config, range));
    } catch (error) {
      if (error instanceof SagepilotError) return json({ error: error.message }, error.status === 429 ? 429 : 502);
      throw error;
    }
  }, { roles: ["l1", "admin"] });
}

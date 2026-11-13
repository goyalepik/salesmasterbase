import { sagepilotConfig } from "@/features/cx/data/adapters/sagepilot/client";
import { rightsOf } from "@/features/cx/domain/rights";
import { handle, json } from "@/features/cx/server/http";
import { loadRoster } from "@/features/cx/server/roster";
import { syncSagepilot } from "@/features/cx/server/sagepilot-sync";
import type { CxStore } from "@/features/cx/server/store";
import { ticketIndex } from "@/features/cx/server/workspace";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** An empty store with Sagepilot connected fills itself (read-only), e.g. on a fresh setup. */
async function fillIfEmpty(store: CxStore) {
  const config = sagepilotConfig();
  if (!config) return;
  const { tickets, meta } = await ticketIndex(store);
  if (tickets.size || meta.source === "sample") return;
  if (!(await store.lock("autosync", 60_000))) return;
  try {
    await syncSagepilot(store, config, "last_7_days");
  } catch {
    // The banner shows the sync error; the page still loads.
  } finally {
    await store.unlock("autosync");
  }
}

/**
 * Who is signed in, what they may do, where the data comes from. The browser polls with ?v=<version>;
 * when nothing changed the answer is tiny. Tickets come from /api/cx/tickets (paged) and /api/cx/ticket (one).
 */
export async function GET(request: Request) {
  return handle(async ({ user, store }) => {
    const seen = Number(new URL(request.url).searchParams.get("v") ?? -1);
    if (seen === -1) await fillIfEmpty(store);
    const { version, tickets, meta } = await ticketIndex(store);
    if (seen === version) return json({ unchanged: true, version });
    const roster = await loadRoster(store);
    return json({
      version,
      user,
      rights: rightsOf(user.role),
      store: store.kind,
      sharedNote: store.kind === "mock" && process.env.NODE_ENV === "production"
        ? "Pilot mode: tickets are kept in this server's memory for now, so actions may reset after an update. Connecting the shared store (Vercel KV) makes them permanent."
        : null,
      meta: {
        source: meta.source || (tickets.size ? "sample" : "empty"),
        syncedAt: meta.syncedAt || null, syncRange: meta.syncRange || null, syncCount: Number(meta.syncCount || 0), syncError: meta.syncError || null,
        total: tickets.size,
      },
      people: roster.map((p) => ({ id: p.id, name: p.name, role: p.role, department: p.department ?? "", queueIds: p.queueIds, active: p.active !== false })),
      sagepilot: Boolean(sagepilotConfig()),
      sampleAllowed: store.kind === "mock" && (process.env.CX_ALLOW_SAMPLE === "true" || process.env.NODE_ENV !== "production"),
    });
  });
}

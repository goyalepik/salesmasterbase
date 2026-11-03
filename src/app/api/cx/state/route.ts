import { sagepilotConfig } from "@/features/cx/data/adapters/sagepilot/client";
import { sessionSecret } from "@/features/cx/server/auth";
import { handle, json } from "@/features/cx/server/http";
import { redactSnapshot } from "@/features/cx/server/redact";
import { syncSagepilot } from "@/features/cx/server/sagepilot-sync";
import type { CxStoreAdapter } from "@/features/cx/server/store";
import { loadWorkspace } from "@/features/cx/server/workspace";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** An empty store with Sagepilot connected fills itself (read-only), e.g. after a server restart. */
async function fillIfEmpty(store: CxStoreAdapter) {
  const config = sagepilotConfig();
  if (!config) return;
  const { snapshot, meta } = await loadWorkspace(store);
  if (snapshot.tickets.length || meta.source === "sample") return;
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
 * The shared tickets, as this person may see them (phones masked).
 * The browser polls with ?v=<version>; when nothing changed the answer is tiny.
 */
export async function GET(request: Request) {
  return handle(async ({ user, store }) => {
    const seen = Number(new URL(request.url).searchParams.get("v") ?? -1);
    if (seen === -1) await fillIfEmpty(store);
    const version = await store.version();
    if (seen === version) return json({ unchanged: true, version });
    const { snapshot, meta } = await loadWorkspace(store);
    return json({
      version,
      user,
      store: store.kind,
      sharedNote: store.kind === "mock" && process.env.NODE_ENV === "production"
        ? "Pilot mode: tickets are read from Sagepilot and kept on the server for now. Actions may reset after an update. A shared store (Vercel KV) makes them permanent."
        : null,
      meta: { source: meta.source || (snapshot.tickets.length ? "sample" : "empty"), syncedAt: meta.syncedAt || null, syncRange: meta.syncRange || null, syncCount: Number(meta.syncCount || 0), syncError: meta.syncError || null },
      sagepilot: Boolean(sagepilotConfig()),
      sampleAllowed: process.env.CX_ALLOW_SAMPLE === "true" || process.env.NODE_ENV !== "production",
      snapshot: redactSnapshot(snapshot, sessionSecret() ?? ""),
    });
  });
}

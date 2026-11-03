import { listChats, listMessages, SagepilotError, type SagepilotConfig, type SpChat } from "../data/adapters/sagepilot/client";
import { importSagepilot } from "../data/adapters/sagepilot/import";
import { mapChat, type ImportedChat } from "../data/adapters/sagepilot/map";
import type { CxStoreAdapter } from "./store";
import { mutate } from "./workspace";

// Read-only pull from Sagepilot into the shared store. Phase 2 replaces this with sync by last activity.

export const RANGES = new Set(["today", "yesterday", "last_7_days", "last_30_days"]);

export async function fetchSagepilot(config: SagepilotConfig, range: string, max: number): Promise<ImportedChat[]> {
  const chats = await listChats(config, { dateRange: range, max });
  const items: ImportedChat[] = [];
  // A few at a time, to stay polite with Sagepilot's rate limits.
  for (let i = 0; i < chats.length; i += 5) {
    const batch = await Promise.all(
      chats.slice(i, i + 5).map(async (chat: SpChat) => mapChat(chat, await listMessages(config, chat.id).catch(() => []))),
    );
    for (const r of batch) if (r?.msg.text?.trim()) items.push(r);
  }
  return items;
}

export async function syncSagepilot(store: CxStoreAdapter, config: SagepilotConfig, range: string, max = 200, now = new Date()) {
  try {
    const items = await fetchSagepilot(config, range, max);
    const { meta } = await store.load();
    // Switching from the sample week to real data starts clean, so made-up tickets never mix with real ones.
    if (meta.source !== "sagepilot") await store.replaceAll({ tickets: [], events: [], customers: [], interactions: [], orders: [], demos: [], calls: [] }, { source: "sagepilot" });
    const { result } = await mutate(store, "ingest", (repo) => importSagepilot(repo, items, now));
    await store.setMeta({ source: "sagepilot", syncedAt: now.toISOString(), syncRange: range, syncCount: String(items.length), syncError: "" });
    return { fetched: items.length, ...result };
  } catch (error) {
    // Status only: never customer data in logs or meta.
    const message = error instanceof SagepilotError ? error.message : "Could not reach Sagepilot.";
    await store.setMeta({ syncError: message }).catch(() => undefined);
    console.error(JSON.stringify({ event: "cx_sagepilot_sync_failed", status: error instanceof SagepilotError ? error.status : 500 }));
    throw error;
  }
}

import { listAllMessages, listChatsByActivity, SagepilotError, type SagepilotConfig, type SpChat } from "../data/adapters/sagepilot/client";
import { applyChat, autoCloseAiAnswered, type ApplyResult } from "../data/adapters/sagepilot/import";
import { CxError } from "../domain/service";
import { sharedMemoryKv } from "./kv";
import type { CxStore } from "./store";
import { dropIndex, mutate, ticketIndex } from "./workspace";

// Read-only sync from Sagepilot by LAST ACTIVITY (v5 5.2), with no item cap. It runs in steps that fit a server call
// (about 40 seconds each) and remembers where it stopped, so the first full sync of 30 days finishes over a few steps
// and later steps only read what changed since the last one. Re-running never duplicates anything.

export const RANGES = new Set(["today", "yesterday", "last_7_days", "last_30_days"]);

type SyncState = {
  mode: "initial" | "incremental";
  range: string;
  pageCursor: string | null;
  /** Newest last activity seen in this run: the next incremental run stops at it. */
  newest: string | null;
  /** Incremental runs stop at tickets older than this. */
  stopAt: string | null;
  processed: number;
  startedAt: string;
};

export type SyncReport = { ran: boolean; complete: boolean; processed: number; created: number; updated: number; subTickets: number; autoClosed: number; mode?: string; busy?: boolean };

const OVERLAP_MS = 2 * 60_000;

function readState(raw: string | undefined): SyncState | null {
  try {
    return raw ? (JSON.parse(raw) as SyncState) : null;
  } catch {
    return null;
  }
}

/** One step of the sync. Returns quickly (busy) when another server is syncing. Never writes to Sagepilot. */
export async function syncStep(store: CxStore, config: SagepilotConfig, opts: { budgetMs?: number; now?: Date; range?: string; restart?: boolean } = {}): Promise<SyncReport> {
  const now = opts.now ?? new Date();
  const started = Date.now();
  const budget = opts.budgetMs ?? 40_000;
  const report: SyncReport = { ran: false, complete: false, processed: 0, created: 0, updated: 0, subTickets: 0, autoClosed: 0 };
  if (!(await store.lock("sync", budget + 20_000))) return { ...report, busy: true };
  try {
    const meta = await store.meta();
    // Made-up sample tickets never mix with real ones. The local store starts clean; the shared store must be emptied first.
    if (meta.source === "sample") {
      if (store.kind !== "mock") throw new CxError("Sample tickets are loaded. Clear them before syncing real tickets.");
      sharedMemoryKv().clear();
      dropIndex();
    }
    let state = opts.restart ? null : readState(meta.syncState);
    if (!state) state = { mode: meta.syncCursor ? "incremental" : "initial", range: opts.range ?? (meta.syncCursor ? "last_7_days" : "last_30_days"), pageCursor: null, newest: null, stopAt: meta.syncCursor ?? null, processed: 0, startedAt: now.toISOString() };
    report.ran = true;
    report.mode = state.mode;

    let done = false;
    while (!done && Date.now() - started < budget) {
      const page = await listChatsByActivity(config, { range: state.range, cursor: state.pageCursor, pageSize: 100 });
      const records = page.records ?? [];
      const stopAt = state.stopAt ? new Date(state.stopAt).getTime() - OVERLAP_MS : null;
      const wanted: SpChat[] = [];
      for (const chat of records) {
        const last = chat.last_message_created_at ?? chat.updated_at ?? chat.created_at;
        if (!state.newest || last > state.newest) state.newest = last;
        if (stopAt !== null && new Date(last).getTime() < stopAt) { done = true; break; }
        wanted.push(chat);
      }
      // Only tickets whose last activity changed need their messages read again.
      const { tickets } = await ticketIndex(store);
      const changed = wanted.filter((chat) => {
        const known = tickets.get(`sp:${chat.id}`);
        return !known || known.sp?.lastMessageAt !== (chat.last_message_created_at ?? null) || known.sp?.status !== chat.status;
      });
      for (let i = 0; i < changed.length; i += 10) {
        const batch = changed.slice(i, i + 10);
        const withMessages = await Promise.all(batch.map(async (chat) => ({ chat, messages: await listAllMessages(config, chat.id).catch(() => null) })));
        const { result } = await mutate(store, "ingest", async (repo) => {
          const out: ApplyResult[] = [];
          for (const { chat, messages } of withMessages) if (messages) out.push(await applyChat(repo, chat, messages, now));
          return out;
        });
        for (const r of result) {
          if (r.action === "created") report.created++;
          if (r.action === "updated") report.updated++;
          if (r.subTicketId) report.subTickets++;
        }
      }
      report.processed += wanted.length;
      state.processed += wanted.length;
      state.pageCursor = page.cursor ?? null;
      if (!state.pageCursor) done = true;
    }

    const { result: closed } = await mutate(store, "ingest", (repo) => autoCloseAiAnswered(repo, now));
    report.autoClosed = closed.length;
    const total = (await ticketIndex(store)).tickets.size;
    if (done) {
      report.complete = true;
      await store.setMeta({ source: "sagepilot", syncCursor: state.newest ?? meta.syncCursor ?? now.toISOString(), syncedAt: now.toISOString(), syncRange: state.range, syncCount: String(total), syncComplete: "true", syncError: "", syncState: "" });
    } else {
      await store.setMeta({ source: "sagepilot", syncedAt: now.toISOString(), syncRange: state.range, syncCount: String(total), syncComplete: "false", syncError: "", syncState: JSON.stringify(state) });
    }
    return report;
  } catch (error) {
    // Status only: never customer data in logs or meta.
    const message = error instanceof SagepilotError || error instanceof CxError ? error.message : "Could not reach Sagepilot.";
    await store.setMeta({ syncError: message, syncFailedAt: now.toISOString() }).catch(() => undefined);
    console.error(JSON.stringify({ event: "cx_sagepilot_sync_failed", status: error instanceof SagepilotError ? error.status : 500 }));
    throw error;
  } finally {
    await store.unlock("sync");
  }
}

/** The button and older callers: one step for a range ("last_7_days", "last_30_days", …). */
export async function syncSagepilot(store: CxStore, config: SagepilotConfig, range: string, _max?: number, now = new Date()) {
  const report = await syncStep(store, config, { now, range, restart: false });
  return { fetched: report.processed, added: report.created, updated: report.updated, complete: report.complete, busy: report.busy ?? false };
}

/** Runs a step in the background when the last one is older than `everyMs` (page polls keep the data fresh). */
export async function syncIfDue(store: CxStore, config: SagepilotConfig, everyMs = 2 * 60_000): Promise<void> {
  const meta = await store.meta();
  const last = meta.syncedAt ? new Date(meta.syncedAt).getTime() : 0;
  const incomplete = meta.syncComplete === "false";
  if (Date.now() - last < (incomplete ? 15_000 : everyMs)) return;
  await syncStep(store, config).catch(() => undefined);
}

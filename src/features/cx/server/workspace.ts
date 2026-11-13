import type { Ticket } from "../domain/types";
import { migrateTicketIds } from "./migrate-ids";
import { StoreRepository } from "./store-repo";
import type { CxStore, StoreMeta } from "./store";

// Each server keeps every ticket snapshot in memory and refreshes only what changed since its last look
// (the store's change log), so a 10-second poll costs one small read. Events are read per ticket, on demand.

type Index = { kind: string; version: number; seenAt: number; tickets: Map<string, Ticket>; meta: StoreMeta };
const cache = globalThis as unknown as { __cxIndex?: Map<string, Index>; __cxMigrated?: Set<string> };

/** How far back each refresh re-reads, so a clock that runs a little behind on another server never loses a change. */
const OVERLAP_MS = 15_000;

function slot(store: CxStore): string {
  return store.kind;
}

/** Moves the old single-hash layout over, once per server start. */
async function ensureMigrated(store: CxStore): Promise<void> {
  cache.__cxMigrated ??= new Set();
  if (cache.__cxMigrated.has(slot(store))) return;
  await store.migrateLegacy().catch(() => undefined);
  cache.__cxMigrated.add(slot(store));
  // CX-10001 numbering → Sagepilot keys / W- numbers (once; the old records are kept under cx:legacy:*).
  const keys = await store.allKeys().catch(() => [] as string[]);
  const old = keys.filter((k) => k.startsWith("CX-"));
  if (old.length) await migrateTicketIds(store, await store.getTickets(old)).catch(() => 0);
}

/** Every ticket snapshot, kept fresh. */
export async function ticketIndex(store: CxStore): Promise<{ version: number; tickets: Map<string, Ticket>; meta: StoreMeta }> {
  await ensureMigrated(store);
  cache.__cxIndex ??= new Map();
  const hit = cache.__cxIndex.get(slot(store));
  const version = await store.version();
  if (hit && hit.version === version) return hit;
  if (!hit || version < hit.version) {
    const changed = await store.changedSince(0);
    const tickets = new Map((await store.getTickets(await store.allKeys())).map((t) => [t.id, t]));
    const fresh: Index = { kind: store.kind, version: changed.version, seenAt: changed.latest, tickets, meta: await store.meta() };
    cache.__cxIndex.set(slot(store), fresh);
    return fresh;
  }
  const changed = await store.changedSince(hit.seenAt - OVERLAP_MS);
  if (changed.keys.length) {
    for (const t of await store.getTickets([...new Set(changed.keys)])) hit.tickets.set(t.id, t);
  }
  hit.version = changed.version;
  hit.seenAt = Math.max(hit.seenAt, changed.latest);
  hit.meta = await store.meta();
  return hit;
}

/** Forgets this server's copy (after a reset, or in tests). */
export function dropIndex(store?: CxStore): void {
  if (!cache.__cxIndex) return;
  if (store) cache.__cxIndex.delete(slot(store));
  else cache.__cxIndex.clear();
}

export class BusyError extends Error {}

/**
 * Runs domain code against the shared store under a lock: reads go through the index, writes are buffered and
 * committed once. `lockName` keeps two writers off the same ticket (or off ticket numbering) at the same time.
 */
export async function mutate<T>(store: CxStore, lockName: string, fn: (repo: StoreRepository) => Promise<T>): Promise<{ result: T; version: number }> {
  if (!(await store.lock(lockName, 20_000))) throw new BusyError("Someone else is changing this right now. Try again in a moment.");
  try {
    const { tickets } = await ticketIndex(store);
    const repo = new StoreRepository(store, tickets);
    const result = await fn(repo);
    const version = await store.commit(repo.changes());
    return { result, version };
  } finally {
    await store.unlock(lockName);
  }
}

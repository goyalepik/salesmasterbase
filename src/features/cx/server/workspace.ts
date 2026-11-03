import { MemoryCxRepository, type CxSnapshot } from "../data/adapters/mock/memory-repo";
import type { Changes, CxStoreAdapter, StoreMeta } from "./store";

// Runs domain code (service.ts) against the shared store: load, change in memory, write back only what changed.

const cache = globalThis as unknown as { __cxSnapshotCache?: { kind: string; version: number; snapshot: CxSnapshot; meta: StoreMeta } };

/** The current data. A poll that finds the same version reuses the copy in memory (one cheap read). */
export async function loadWorkspace(store: CxStoreAdapter): Promise<{ version: number; snapshot: CxSnapshot; meta: StoreMeta }> {
  const hit = cache.__cxSnapshotCache;
  if (hit && hit.kind === store.kind && hit.version === (await store.version())) return { version: hit.version, snapshot: structuredClone(hit.snapshot), meta: { ...hit.meta } };
  const fresh = await store.load();
  cache.__cxSnapshotCache = { kind: store.kind, ...fresh };
  return { version: fresh.version, snapshot: structuredClone(fresh.snapshot), meta: { ...fresh.meta } };
}

/** What changed between two snapshots. Events, interactions and calls only ever grow. */
export function diff(before: CxSnapshot, after: CxSnapshot): Changes {
  const oldT = new Map(before.tickets.map((t) => [t.id, JSON.stringify(t)]));
  const oldC = new Map(before.customers.map((c) => [c.uid, JSON.stringify(c)]));
  const seen = (list: Array<{ id: string }>) => new Set(list.map((x) => x.id));
  const ev = seen(before.events);
  const it = seen(before.interactions);
  const ca = seen(before.calls);
  return {
    tickets: after.tickets.filter((t) => oldT.get(t.id) !== JSON.stringify(t)),
    customers: after.customers.filter((c) => oldC.get(c.uid) !== JSON.stringify(c)),
    events: after.events.filter((e) => !ev.has(e.id)),
    interactions: after.interactions.filter((i) => !it.has(i.id)),
    calls: after.calls.filter((c) => !ca.has(c.id)),
  };
}

export class BusyError extends Error {}

/**
 * Loads the data, runs `fn` on an in-memory repository and commits the difference.
 * `lockName` keeps two writers off the same ticket (or off ticket numbering) at the same time.
 */
export async function mutate<T>(store: CxStoreAdapter, lockName: string, fn: (repo: MemoryCxRepository, snapshot: CxSnapshot) => Promise<T>): Promise<{ result: T; version: number }> {
  if (!(await store.lock(lockName, 15_000))) throw new BusyError("Someone else is changing this right now. Try again in a moment.");
  try {
    const { snapshot } = await loadWorkspace(store);
    const before = structuredClone(snapshot);
    const repo = new MemoryCxRepository(snapshot);
    const result = await fn(repo, before);
    const version = await store.commit(diff(before, repo.snapshot()));
    return { result, version };
  } finally {
    await store.unlock(lockName);
  }
}

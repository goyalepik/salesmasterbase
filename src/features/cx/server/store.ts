import type { CxSnapshot } from "../data/adapters/mock/memory-repo";
import { emptySnapshot } from "../data/adapters/mock/memory-repo";

// The shared CX store: one copy on the server for everyone, so two people see the same tickets.
// No schema. Tickets and customers are JSON by key; events, interactions and calls are append-only lists.
//
//   cx:t      hash  ticketId → ticket JSON (a cache: it can be rebuilt from the events)
//   cx:ev     list  events, append-only
//   cx:c      hash  customerUid → customer JSON
//   cx:i      list  interactions, append-only
//   cx:calls  list  calls, append-only
//   cx:meta   hash  source, last sync, counters
//   cx:ver    int   bumped on every write, so a poll that sees no change costs one read
//
// One list for all events (not one per ticket) keeps a full load to a single round trip.

export type StoreMeta = {
  /** Where the tickets came from: nothing yet, the sample week, or Sagepilot. */
  source?: "empty" | "sample" | "sagepilot";
  syncedAt?: string;
  syncRange?: string;
  syncCount?: string;
  syncError?: string;
};

export type Changes = Pick<CxSnapshot, "tickets" | "customers" | "events" | "interactions" | "calls">;

export interface CxStoreAdapter {
  readonly kind: "kv" | "mock";
  version(): Promise<number>;
  load(): Promise<{ version: number; snapshot: CxSnapshot; meta: StoreMeta }>;
  /** Upserts tickets and customers, appends the rest. Returns the new version. */
  commit(changes: Changes): Promise<number>;
  replaceAll(snapshot: CxSnapshot, meta: StoreMeta): Promise<number>;
  setMeta(meta: StoreMeta): Promise<void>;
  /** A short lock for work that must not run twice at once (creating tickets, syncing). */
  lock(name: string, ms: number): Promise<boolean>;
  unlock(name: string): Promise<void>;
}

// --- In memory (local development and tests). One copy per server process. --------------------------

type MemoryState = { snapshot: CxSnapshot; meta: StoreMeta; version: number; locks: Map<string, number> };
const g = globalThis as unknown as { __cxMemoryStore?: MemoryState };

export class MemoryStore implements CxStoreAdapter {
  readonly kind = "mock" as const;
  private get s(): MemoryState {
    g.__cxMemoryStore ??= { snapshot: emptySnapshot(), meta: { source: "empty" }, version: 0, locks: new Map() };
    return g.__cxMemoryStore;
  }
  async version() {
    return this.s.version;
  }
  async load() {
    // A deep copy, so a caller can never change the stored data without commit().
    return { version: this.s.version, snapshot: structuredClone(this.s.snapshot), meta: { ...this.s.meta } };
  }
  async commit(changes: Changes) {
    const cur = this.s.snapshot;
    const tickets = new Map(cur.tickets.map((t) => [t.id, t]));
    for (const t of changes.tickets) tickets.set(t.id, structuredClone(t));
    const customers = new Map(cur.customers.map((c) => [c.uid, c]));
    for (const c of changes.customers) customers.set(c.uid, structuredClone(c));
    this.s.snapshot = {
      ...cur,
      tickets: [...tickets.values()],
      customers: [...customers.values()],
      events: [...cur.events, ...structuredClone(changes.events)],
      interactions: [...cur.interactions, ...structuredClone(changes.interactions)],
      calls: [...cur.calls, ...structuredClone(changes.calls)],
    };
    return ++this.s.version;
  }
  async replaceAll(snapshot: CxSnapshot, meta: StoreMeta) {
    this.s.snapshot = structuredClone(snapshot);
    this.s.meta = { ...meta };
    return ++this.s.version;
  }
  async setMeta(meta: StoreMeta) {
    this.s.meta = { ...this.s.meta, ...meta };
    this.s.version += 1;
  }
  async lock(name: string, ms: number) {
    const until = this.s.locks.get(name) ?? 0;
    if (until > Date.now()) return false;
    this.s.locks.set(name, Date.now() + ms);
    return true;
  }
  async unlock(name: string) {
    this.s.locks.delete(name);
  }
}

// --- Vercel KV / Upstash Redis over its REST API (no extra package) -------------------------------

type KvConfig = { url: string; token: string };

export function kvConfig(env: Record<string, string | undefined> = process.env): KvConfig | null {
  const url = (env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || "").trim().replace(/\/+$/, "");
  const token = (env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  return url && token ? { url, token } : null;
}

export class KvStore implements CxStoreAdapter {
  readonly kind = "kv" as const;
  constructor(private config: KvConfig, private fetcher: typeof fetch = fetch) {}

  private async pipeline(commands: Array<Array<string | number>>): Promise<unknown[]> {
    const response = await this.fetcher(`${this.config.url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(commands),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Shared store answered ${response.status}.`);
    const results = (await response.json()) as Array<{ result?: unknown; error?: string }>;
    const failed = results.find((r) => r.error);
    if (failed) throw new Error("Shared store refused a command.");
    return results.map((r) => r.result);
  }

  async version() {
    const [v] = await this.pipeline([["GET", "cx:ver"]]);
    return Number(v ?? 0);
  }

  async load() {
    const [ver, t, ev, c, i, calls, meta] = await this.pipeline([
      ["GET", "cx:ver"],
      ["HVALS", "cx:t"],
      ["LRANGE", "cx:ev", 0, -1],
      ["HVALS", "cx:c"],
      ["LRANGE", "cx:i", 0, -1],
      ["LRANGE", "cx:calls", 0, -1],
      ["HGETALL", "cx:meta"],
    ]);
    const parse = (list: unknown) => ((list as string[] | null) ?? []).map((s) => JSON.parse(s));
    const flat = (meta as string[] | null) ?? [];
    const m: Record<string, string> = {};
    for (let k = 0; k < flat.length; k += 2) m[flat[k]] = flat[k + 1];
    return {
      version: Number(ver ?? 0),
      snapshot: { ...emptySnapshot(), tickets: parse(t), events: parse(ev), customers: parse(c), interactions: parse(i), calls: parse(calls) } as CxSnapshot,
      meta: m as StoreMeta,
    };
  }

  private writes(changes: Changes): Array<Array<string | number>> {
    const cmds: Array<Array<string | number>> = [];
    if (changes.tickets.length) cmds.push(["HSET", "cx:t", ...changes.tickets.flatMap((t) => [t.id, JSON.stringify(t)])]);
    if (changes.customers.length) cmds.push(["HSET", "cx:c", ...changes.customers.flatMap((c) => [c.uid, JSON.stringify(c)])]);
    // Large lists go in chunks, so one request never gets too big.
    const push = (key: string, items: unknown[]) => {
      for (let k = 0; k < items.length; k += 500) cmds.push(["RPUSH", key, ...items.slice(k, k + 500).map((x) => JSON.stringify(x))]);
    };
    push("cx:ev", changes.events);
    push("cx:i", changes.interactions);
    push("cx:calls", changes.calls);
    return cmds;
  }

  async commit(changes: Changes) {
    const cmds = this.writes(changes);
    if (!cmds.length) return this.version();
    const results = await this.pipeline([...cmds, ["INCR", "cx:ver"]]);
    return Number(results[results.length - 1]);
  }

  async replaceAll(snapshot: CxSnapshot, meta: StoreMeta) {
    const metaArgs = Object.entries(meta).flatMap(([k, v]) => [k, String(v ?? "")]);
    const results = await this.pipeline([
      ["DEL", "cx:t", "cx:ev", "cx:c", "cx:i", "cx:calls", "cx:meta"],
      ...this.writes(snapshot),
      ...(metaArgs.length ? [["HSET", "cx:meta", ...metaArgs]] : []),
      ["INCR", "cx:ver"],
    ]);
    return Number(results[results.length - 1]);
  }

  async setMeta(meta: StoreMeta) {
    const args = Object.entries(meta).flatMap(([k, v]) => [k, String(v ?? "")]);
    if (args.length) await this.pipeline([["HSET", "cx:meta", ...args], ["INCR", "cx:ver"]]);
  }

  async lock(name: string, ms: number) {
    const [ok] = await this.pipeline([["SET", `cx:lock:${name}`, "1", "NX", "PX", ms]]);
    return ok === "OK";
  }

  async unlock(name: string) {
    await this.pipeline([["DEL", `cx:lock:${name}`]]);
  }
}

export class StoreNotConfigured extends Error {}

/**
 * CX_DATA_ADAPTER picks the store: "kv" (default) or "mock".
 * Without KV settings it falls back to the server's memory. The UI then says so plainly, because on Vercel
 * that memory is per server and is emptied on restart (tickets are then re-read from Sagepilot).
 * CX_REQUIRE_KV=true refuses instead.
 */
export function getCxStore(env: Record<string, string | undefined> = process.env): CxStoreAdapter {
  const choice = (env.CX_DATA_ADAPTER || "kv").trim();
  if (choice === "mock") return new MemoryStore();
  const kv = kvConfig(env);
  if (kv) return new KvStore(kv);
  if (env.CX_REQUIRE_KV !== "true") return new MemoryStore();
  throw new StoreNotConfigured("The shared store is not set up. Add Vercel KV (Upstash) to the project.");
}

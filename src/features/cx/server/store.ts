import type { CallRecord, Customer, Interaction, Ticket, TicketEvent } from "../domain/types";
import { kvConfig, MemoryKv, sharedMemoryKv, UpstashKv, type Cmd, type Kv } from "./kv";

// The shared CX store. Events are the record; ticket snapshots are kept per key so a list never has to read every event.
//
//   cx:ver                 int     bumped on every write (a poll that sees the same number costs one read)
//   cx:chg                 zset    ticketKey → time of its last change (each server refreshes only what changed)
//   cx:t:<key>             string  ticket snapshot (JSON); rebuildable from its events
//   cx:t:<key>:ev          list    the ticket's events, append-only
//   cx:idx:activity        zset    ticketKey → last activity (ms)
//   cx:idx:open            set     keys of open tickets
//   cx:idx:phone:<uid>     set     a customer's ticket keys
//   cx:idx:code:<code>     string  Sagepilot ticket number → ticketKey
//   cx:c:<uid>             string  customer (JSON); cx:c:<uid>:i and cx:c:<uid>:calls are append-only lists
//   cx:meta                hash    source, sync times and counts
//   cx:cfg:<name>          string  admin overrides (JSON): sla, categories, users
//   cx:seq:<name>          int     counters (website-only ticket numbers)
//   cx:audit               list    who did what outside a ticket (sign-ins refused, numbers shown, settings), newest last
//   cx:lock:<name>         string  short locks
//
// The older layout (one hash cx:t for every ticket, one list cx:ev for every event) is moved here once by
// migrateLegacy(); the old keys are renamed to cx:legacy:*, never deleted.

export type StoreMeta = {
  source?: "empty" | "sample" | "sagepilot";
  syncedAt?: string;
  syncRange?: string;
  syncCount?: string;
  syncError?: string;
  /** Sync cursor: last activity time already read from Sagepilot. */
  syncCursor?: string;
  syncComplete?: string;
  syncFailedAt?: string;
  /** Where an unfinished sync stopped (JSON); empty when the range is complete. */
  syncState?: string;
};

export type Changes = { tickets: Ticket[]; events: TicketEvent[]; customers: Customer[]; interactions: Interaction[]; calls: CallRecord[] };
export const noChanges = (): Changes => ({ tickets: [], events: [], customers: [], interactions: [], calls: [] });

export type AuditEntry = { at: string; actorId: string; kind: string; ticketId?: string; detail?: Record<string, unknown> };

const OPEN = (t: Ticket) => t.status !== "resolved" && t.status !== "closed";
const ms = (iso: string | undefined) => (iso ? new Date(iso).getTime() : 0);

export class StoreNotConfigured extends Error {}

export class CxStore {
  constructor(readonly kv: Kv, private clock: () => number = Date.now) {}

  get kind(): "kv" | "mock" {
    return this.kv.kind;
  }

  async version(): Promise<number> {
    const [v] = await this.kv.run([["GET", "cx:ver"]]);
    return Number(v ?? 0);
  }

  /** Every ticket key, oldest activity first. */
  async allKeys(): Promise<string[]> {
    const [keys] = await this.kv.run([["ZRANGEBYSCORE", "cx:idx:activity", "-inf", "+inf"]]);
    return (keys as string[] | null) ?? [];
  }

  /** Keys with activity in a time window, newest first. */
  async keysByActivity(fromMs: number, toMs = Infinity, limit?: number): Promise<string[]> {
    const cmd: Cmd = ["ZREVRANGEBYSCORE", "cx:idx:activity", toMs === Infinity ? "+inf" : toMs, fromMs];
    if (limit) cmd.push("LIMIT", 0, limit);
    const [keys] = await this.kv.run([cmd]);
    return (keys as string[] | null) ?? [];
  }

  /** Tickets changed at or after `sinceMs`, with the latest change time seen. */
  async changedSince(sinceMs: number): Promise<{ version: number; keys: string[]; latest: number }> {
    const [v, raw] = await this.kv.run([["GET", "cx:ver"], ["ZRANGEBYSCORE", "cx:chg", sinceMs, "+inf", "WITHSCORES"]]);
    const flat = (raw as string[] | null) ?? [];
    const keys: string[] = [];
    let latest = sinceMs;
    for (let i = 0; i < flat.length; i += 2) {
      keys.push(flat[i]);
      latest = Math.max(latest, Number(flat[i + 1]));
    }
    return { version: Number(v ?? 0), keys, latest };
  }

  async getTickets(keys: string[]): Promise<Ticket[]> {
    const out: Ticket[] = [];
    for (let i = 0; i < keys.length; i += 300) {
      const part = keys.slice(i, i + 300);
      const [values] = await this.kv.run([["MGET", ...part.map((k) => `cx:t:${k}`)]]);
      for (const v of (values as Array<string | null>) ?? []) if (v) out.push(JSON.parse(v) as Ticket);
    }
    return out;
  }

  async getTicket(key: string): Promise<Ticket | null> {
    return (await this.getTickets([key]))[0] ?? null;
  }

  async getEvents(key: string): Promise<TicketEvent[]> {
    const [list] = await this.kv.run([["LRANGE", `cx:t:${key}:ev`, 0, -1]]);
    return ((list as string[] | null) ?? []).map((s) => JSON.parse(s) as TicketEvent);
  }

  async getCustomer(uid: string): Promise<Customer | null> {
    const [v] = await this.kv.run([["GET", `cx:c:${uid}`]]);
    return v ? (JSON.parse(String(v)) as Customer) : null;
  }

  async interactions(uid: string): Promise<Interaction[]> {
    const [list] = await this.kv.run([["LRANGE", `cx:c:${uid}:i`, 0, -1]]);
    return ((list as string[] | null) ?? []).map((s) => JSON.parse(s) as Interaction);
  }

  async calls(uid: string): Promise<CallRecord[]> {
    const [list] = await this.kv.run([["LRANGE", `cx:c:${uid}:calls`, 0, -1]]);
    return ((list as string[] | null) ?? []).map((s) => JSON.parse(s) as CallRecord);
  }

  async keysForCustomer(uid: string): Promise<string[]> {
    const [m] = await this.kv.run([["SMEMBERS", `cx:idx:phone:${uid}`]]);
    return (m as string[] | null) ?? [];
  }

  async keyForCode(code: string): Promise<string | null> {
    const [v] = await this.kv.run([["GET", `cx:idx:code:${code}`]]);
    return v ? String(v) : null;
  }

  /**
   * Writes tickets (bumping rev and last activity), appends events, customers, interactions and calls,
   * keeps every index right, logs the changed keys and bumps the version. Returns the new version.
   */
  async commit(changes: Changes): Promise<number> {
    const now = this.clock();
    const cmds: Cmd[] = [];
    const eventsBy = new Map<string, TicketEvent[]>();
    for (const e of changes.events) eventsBy.set(e.ticketId, [...(eventsBy.get(e.ticketId) ?? []), e]);
    for (const t of changes.tickets) {
      const latest = (eventsBy.get(t.id) ?? []).reduce((m, e) => Math.max(m, ms(e.at)), 0);
      const activity = Math.max(ms(t.lastActivityAt), ms(t.createdAt), latest);
      const saved: Ticket = { ...t, lastActivityAt: new Date(activity).toISOString(), rev: (t.rev ?? 0) + 1 };
      cmds.push(["SET", `cx:t:${t.id}`, JSON.stringify(saved)]);
      cmds.push(["ZADD", "cx:idx:activity", activity, t.id]);
      cmds.push(OPEN(t) ? ["SADD", "cx:idx:open", t.id] : ["SREM", "cx:idx:open", t.id]);
      cmds.push(["SADD", `cx:idx:phone:${t.customerUid}`, t.id]);
      if (t.external?.code) cmds.push(["SET", `cx:idx:code:${t.external.code}`, t.id]);
      cmds.push(["ZADD", "cx:chg", now, t.id]);
    }
    for (const [key, list] of eventsBy) {
      for (let i = 0; i < list.length; i += 300) cmds.push(["RPUSH", `cx:t:${key}:ev`, ...list.slice(i, i + 300).map((e) => JSON.stringify(e))]);
      // Events on a ticket that was not saved still change what the browser shows.
      if (!changes.tickets.some((t) => t.id === key)) cmds.push(["ZADD", "cx:chg", now, key]);
    }
    for (const c of changes.customers) cmds.push(["SET", `cx:c:${c.uid}`, JSON.stringify(c)]);
    for (const i of changes.interactions) cmds.push(["RPUSH", `cx:c:${i.customerUid}:i`, JSON.stringify(i)]);
    for (const c of changes.calls) cmds.push(["RPUSH", `cx:c:${c.customerUid}:calls`, JSON.stringify(c)]);
    if (!cmds.length) return this.version();
    // A week of change log is plenty: a server further behind than that reloads everything.
    cmds.push(["ZREMRANGEBYSCORE", "cx:chg", "-inf", now - 7 * 86_400_000]);
    cmds.push(["INCR", "cx:ver"]);
    const results = await this.kv.run(cmds);
    return Number(results[results.length - 1]);
  }

  async meta(): Promise<StoreMeta> {
    const [flat] = await this.kv.run([["HGETALL", "cx:meta"]]);
    const list = (flat as string[] | null) ?? [];
    const m: Record<string, string> = {};
    for (let k = 0; k < list.length; k += 2) m[list[k]] = list[k + 1];
    return m as StoreMeta;
  }

  async setMeta(meta: StoreMeta): Promise<void> {
    const args = Object.entries(meta).flatMap(([k, v]) => [k, String(v ?? "")]);
    if (args.length) await this.kv.run([["HSET", "cx:meta", ...args], ["INCR", "cx:ver"]]);
  }

  async lock(name: string, msHeld: number): Promise<boolean> {
    const [ok] = await this.kv.run([["SET", `cx:lock:${name}`, "1", "NX", "PX", msHeld]]);
    return ok === "OK";
  }

  async unlock(name: string): Promise<void> {
    await this.kv.run([["DEL", `cx:lock:${name}`]]);
  }

  /** The next number of a counter, starting after `start`. */
  async nextSeq(name: string, start = 1000): Promise<number> {
    const [n] = await this.kv.run([["INCR", `cx:seq:${name}`]]);
    return start + Number(n);
  }

  async getConfig<T>(name: string): Promise<T | null> {
    const [v] = await this.kv.run([["GET", `cx:cfg:${name}`]]);
    return v ? (JSON.parse(String(v)) as T) : null;
  }

  async setConfig(name: string, value: unknown): Promise<void> {
    await this.kv.run([["SET", `cx:cfg:${name}`, JSON.stringify(value)], ["INCR", "cx:ver"]]);
  }

  /** Counts attempts in a window (for sign-in rate limits). */
  async hit(name: string, windowMs: number): Promise<number> {
    const [n] = await this.kv.run([["INCR", `cx:rl:${name}`], ["PEXPIRE", `cx:rl:${name}`, windowMs]]);
    return Number(n);
  }

  async audit(entries: AuditEntry[]): Promise<void> {
    if (!entries.length) return;
    await this.kv.run([["RPUSH", "cx:audit", ...entries.map((e) => JSON.stringify(e))], ["LTRIM", "cx:audit", -20000, -1]]);
  }

  async listAudit(limit = 500): Promise<AuditEntry[]> {
    const [list] = await this.kv.run([["LRANGE", "cx:audit", -limit, -1]]);
    return ((list as string[] | null) ?? []).map((s) => JSON.parse(s) as AuditEntry).reverse();
  }

  /**
   * Moves data from the old single-hash layout into this one, once. The old keys are renamed to cx:legacy:*
   * (kept, never deleted). Safe to call on every start: it does nothing when there is nothing old.
   */
  async migrateLegacy(): Promise<{ migrated: boolean; tickets: number }> {
    const [exists] = await this.kv.run([["EXISTS", "cx:t"]]);
    if (!Number(exists)) return { migrated: false, tickets: 0 };
    if (!(await this.lock("migrate", 120_000))) return { migrated: false, tickets: 0 };
    try {
      const [t, ev, c, i, calls] = await this.kv.run([
        ["HVALS", "cx:t"], ["LRANGE", "cx:ev", 0, -1], ["HVALS", "cx:c"], ["LRANGE", "cx:i", 0, -1], ["LRANGE", "cx:calls", 0, -1],
      ]);
      const parse = <T>(list: unknown) => ((list as string[] | null) ?? []).map((s) => JSON.parse(s) as T);
      const tickets = parse<Ticket>(t);
      await this.commit({ tickets, events: parse<TicketEvent>(ev), customers: parse<Customer>(c), interactions: parse<Interaction>(i), calls: parse<CallRecord>(calls) });
      const stamp = new Date(this.clock()).toISOString().slice(0, 19).replace(/\D/g, "");
      const renames: Cmd[] = [];
      for (const key of ["cx:t", "cx:ev", "cx:c", "cx:i", "cx:calls"]) {
        const [has] = await this.kv.run([["EXISTS", key]]);
        if (Number(has)) renames.push(["RENAME", key, `cx:legacy:${stamp}:${key.slice(3)}`]);
      }
      await this.kv.run(renames);
      return { migrated: true, tickets: tickets.length };
    } finally {
      await this.unlock("migrate");
    }
  }
}

/**
 * CX_DATA_ADAPTER picks the store: "kv" (default) or "mock".
 * Without KV settings it falls back to this server's memory; the UI then says so plainly.
 * CX_REQUIRE_KV=true refuses instead.
 */
export function getCxStore(env: Record<string, string | undefined> = process.env): CxStore {
  const choice = (env.CX_DATA_ADAPTER || "kv").trim();
  if (choice === "mock") return new CxStore(sharedMemoryKv());
  const kv = kvConfig(env);
  if (kv) return new CxStore(new UpstashKv(kv));
  if (env.CX_REQUIRE_KV !== "true") return new CxStore(sharedMemoryKv());
  throw new StoreNotConfigured("The shared store is not set up. Add Vercel KV (Upstash) to the project.");
}

/** A fresh empty store (tests, showcase rehearsals). */
export function memoryStore(clock?: () => number): CxStore {
  return new CxStore(new MemoryKv(clock), clock);
}

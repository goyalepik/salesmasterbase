// The few Redis commands the CX store uses, behind one small interface. Two implementations:
// - UpstashKv: Vercel KV / Upstash Redis over its REST pipeline (no extra package);
// - MemoryKv: the same commands in memory, for local development and tests, so both run the same store code.

export type Cmd = Array<string | number>;

export interface Kv {
  readonly kind: "kv" | "mock";
  /** Runs the commands in order and returns each result, Redis-style (strings, numbers, arrays, null). */
  run(commands: Cmd[]): Promise<unknown[]>;
}

export type KvConfig = { url: string; token: string };

export function kvConfig(env: Record<string, string | undefined> = process.env): KvConfig | null {
  const url = (env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || "").trim().replace(/\/+$/, "");
  const token = (env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  return url && token ? { url, token } : null;
}

export class UpstashKv implements Kv {
  readonly kind = "kv" as const;
  constructor(private config: KvConfig, private fetcher: typeof fetch = fetch) {}

  async run(commands: Cmd[]): Promise<unknown[]> {
    if (!commands.length) return [];
    const out: unknown[] = [];
    // Upstash takes up to 1 MB per request: send big batches in parts.
    for (const part of chunkBySize(commands, 600_000)) {
      const response = await this.fetcher(`${this.config.url}/pipeline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.config.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(part),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`Shared store answered ${response.status}.`);
      const results = (await response.json()) as Array<{ result?: unknown; error?: string }>;
      const failed = results.find((r) => r.error);
      if (failed) throw new Error("Shared store refused a command.");
      out.push(...results.map((r) => r.result ?? null));
    }
    return out;
  }
}

function chunkBySize(commands: Cmd[], max: number): Cmd[][] {
  const parts: Cmd[][] = [];
  let current: Cmd[] = [];
  let size = 2;
  for (const c of commands) {
    const n = JSON.stringify(c).length + 1;
    if (current.length && size + n > max) {
      parts.push(current);
      current = [];
      size = 2;
    }
    current.push(c);
    size += n;
  }
  if (current.length) parts.push(current);
  return parts;
}

type Value = { t: "s"; v: string } | { t: "h"; v: Map<string, string> } | { t: "l"; v: string[] } | { t: "set"; v: Set<string> } | { t: "z"; v: Map<string, number> };

/** Enough of Redis for the CX store: strings, hashes, lists, sets, sorted sets, NX/PX locks. */
export class MemoryKv implements Kv {
  readonly kind = "mock" as const;
  private data = new Map<string, Value>();
  private expires = new Map<string, number>();
  constructor(private now: () => number = Date.now) {}

  private live(key: string): Value | undefined {
    const exp = this.expires.get(key);
    if (exp !== undefined && exp <= this.now()) {
      this.data.delete(key);
      this.expires.delete(key);
    }
    return this.data.get(key);
  }
  private get<T extends Value["t"]>(key: string, t: T, create: boolean): Extract<Value, { t: T }> | undefined {
    const found = this.live(key);
    if (found) {
      if (found.t !== t) throw new Error(`WRONGTYPE ${key}`);
      return found as Extract<Value, { t: T }>;
    }
    if (!create) return undefined;
    const fresh = (t === "s" ? { t, v: "" } : t === "h" ? { t, v: new Map() } : t === "l" ? { t, v: [] } : t === "set" ? { t, v: new Set() } : { t, v: new Map() }) as Extract<Value, { t: T }>;
    this.data.set(key, fresh);
    return fresh;
  }

  async run(commands: Cmd[]): Promise<unknown[]> {
    return commands.map((c) => this.one(c.map(String)));
  }

  /** Empties everything (local store only). */
  clear(): void {
    this.data.clear();
    this.expires.clear();
  }

  private one([name, ...args]: string[]): unknown {
    switch (name.toUpperCase()) {
      case "GET": return this.get(args[0], "s", false)?.v ?? null;
      case "SET": {
        const [key, value, ...opts] = args;
        const upper = opts.map((o) => o.toUpperCase());
        if (upper.includes("NX") && this.live(key)) return null;
        this.data.set(key, { t: "s", v: value });
        this.expires.delete(key);
        const px = upper.indexOf("PX");
        if (px >= 0) this.expires.set(key, this.now() + Number(opts[px + 1]));
        return "OK";
      }
      case "MGET": return args.map((k) => this.get(k, "s", false)?.v ?? null);
      case "DEL": return args.reduce((n, k) => n + (this.data.delete(k) ? 1 : 0), 0);
      case "EXISTS": return args.reduce((n, k) => n + (this.live(k) ? 1 : 0), 0);
      case "RENAME": {
        const v = this.live(args[0]);
        if (!v) throw new Error("ERR no such key");
        this.data.set(args[1], v);
        this.data.delete(args[0]);
        return "OK";
      }
      case "INCR": case "INCRBY": {
        const s = this.get(args[0], "s", true)!;
        s.v = String((Number(s.v) || 0) + (name.toUpperCase() === "INCR" ? 1 : Number(args[1])));
        return Number(s.v);
      }
      case "PEXPIRE": {
        if (!this.live(args[0])) return 0;
        this.expires.set(args[0], this.now() + Number(args[1]));
        return 1;
      }
      case "HSET": {
        const h = this.get(args[0], "h", true)!;
        let added = 0;
        for (let i = 1; i < args.length; i += 2) { if (!h.v.has(args[i])) added++; h.v.set(args[i], args[i + 1]); }
        return added;
      }
      case "HGET": return this.get(args[0], "h", false)?.v.get(args[1]) ?? null;
      case "HGETALL": return [...(this.get(args[0], "h", false)?.v ?? new Map())].flat();
      case "HVALS": return [...(this.get(args[0], "h", false)?.v.values() ?? [])];
      case "HDEL": { const h = this.get(args[0], "h", false); return h ? args.slice(1).reduce((n, f) => n + (h.v.delete(f) ? 1 : 0), 0) : 0; }
      case "RPUSH": { const l = this.get(args[0], "l", true)!; l.v.push(...args.slice(1)); return l.v.length; }
      case "LLEN": return this.get(args[0], "l", false)?.v.length ?? 0;
      case "LRANGE": {
        const l = this.get(args[0], "l", false)?.v ?? [];
        const [a, b] = [Number(args[1]), Number(args[2])];
        const start = a < 0 ? Math.max(0, l.length + a) : a;
        const end = b < 0 ? l.length + b : b;
        return l.slice(start, end + 1);
      }
      case "LTRIM": {
        const l = this.get(args[0], "l", false);
        if (!l) return "OK";
        const [a, b] = [Number(args[1]), Number(args[2])];
        const start = a < 0 ? Math.max(0, l.v.length + a) : a;
        const end = b < 0 ? l.v.length + b : b;
        l.v = l.v.slice(start, end + 1);
        return "OK";
      }
      case "SADD": { const s = this.get(args[0], "set", true)!; let n = 0; for (const m of args.slice(1)) if (!s.v.has(m)) { s.v.add(m); n++; } return n; }
      case "SREM": { const s = this.get(args[0], "set", false); return s ? args.slice(1).reduce((n, m) => n + (s.v.delete(m) ? 1 : 0), 0) : 0; }
      case "SMEMBERS": return [...(this.get(args[0], "set", false)?.v ?? [])];
      case "SCARD": return this.get(args[0], "set", false)?.v.size ?? 0;
      case "ZADD": {
        const z = this.get(args[0], "z", true)!;
        let n = 0;
        for (let i = 1; i < args.length; i += 2) { if (!z.v.has(args[i + 1])) n++; z.v.set(args[i + 1], Number(args[i])); }
        return n;
      }
      case "ZREM": { const z = this.get(args[0], "z", false); return z ? args.slice(1).reduce((n, m) => n + (z.v.delete(m) ? 1 : 0), 0) : 0; }
      case "ZCARD": return this.get(args[0], "z", false)?.v.size ?? 0;
      case "ZSCORE": { const s = this.get(args[0], "z", false)?.v.get(args[1]); return s === undefined ? null : String(s); }
      case "ZRANGEBYSCORE": case "ZREVRANGEBYSCORE": return this.zrange(name.toUpperCase() === "ZREVRANGEBYSCORE", args);
      case "ZREMRANGEBYSCORE": {
        const z = this.get(args[0], "z", false);
        if (!z) return 0;
        const [lo, hi] = [bound(args[1]), bound(args[2])];
        let n = 0;
        for (const [m, s] of [...z.v]) if (inBound(s, lo) && inUpper(s, hi)) { z.v.delete(m); n++; }
        return n;
      }
      default: throw new Error(`MemoryKv does not support ${name}`);
    }
  }

  private zrange(rev: boolean, args: string[]): string[] {
    const z = this.get(args[0], "z", false);
    if (!z) return [];
    // ZRANGEBYSCORE key min max; ZREVRANGEBYSCORE key max min.
    const [lo, hi] = rev ? [bound(args[2]), bound(args[1])] : [bound(args[1]), bound(args[2])];
    const withScores = args.some((a) => a.toUpperCase() === "WITHSCORES");
    const li = args.findIndex((a) => a.toUpperCase() === "LIMIT");
    let items = [...z.v].filter(([, s]) => inBound(s, lo) && inUpper(s, hi)).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
    if (rev) items.reverse();
    if (li >= 0) items = items.slice(Number(args[li + 1]), Number(args[li + 1]) + Number(args[li + 2]));
    return withScores ? items.flatMap(([m, s]) => [m, String(s)]) : items.map(([m]) => m);
  }
}

type Bound = { v: number; open: boolean };
function bound(raw: string): Bound {
  if (raw === "-inf") return { v: -Infinity, open: false };
  if (raw === "+inf" || raw === "inf") return { v: Infinity, open: false };
  return raw.startsWith("(") ? { v: Number(raw.slice(1)), open: true } : { v: Number(raw), open: false };
}
const inBound = (s: number, b: Bound) => (b.open ? s > b.v : s >= b.v);
const inUpper = (s: number, b: Bound) => (b.open ? s < b.v : s <= b.v);

const g = globalThis as unknown as { __cxMemoryKv?: MemoryKv };

/** One in-memory KV per server process (local development). */
export function sharedMemoryKv(): MemoryKv {
  g.__cxMemoryKv ??= new MemoryKv();
  return g.__cxMemoryKv;
}

"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Customer360 } from "../domain/customer360";
import { can as canDo, type Capability } from "../domain/rights";
import type { Actor } from "../domain/service";
import type { Role, Ticket, TicketEvent } from "../domain/types";

// The shared store lives on the server. This browser asks for one page of the list (50 rows) and for the opened
// ticket, checks every 10 seconds whether anything changed, and sends every change to /api/cx/actions.
// Nothing about tickets is saved in the browser.

export type CxUser = { id: string; email: string; name: string; role: Role; queueIds: string[]; department: string };
export type Person = { id: string; name: string; role: Role; department: string; queueIds: string[]; active: boolean };
export type StoreMeta = { source: "empty" | "sample" | "sagepilot"; syncedAt: string | null; syncRange: string | null; syncCount: number; syncError: string | null; total: number; syncComplete?: boolean; syncFailedAt?: string | null };
export type Counters = { open: number; p0: number; atRisk: number; breached: number; callbacks: number };
export type ListQuery = { view: string; range: string; q: string; level: string; queue: string; bucket: string; channel: string; type: string; label: string; status: string; priority: string; owner: string };
export type Detail = { ticket: Ticket; events: TicketEvent[]; customer: Customer360 | null };

export const DEFAULT_QUERY: ListQuery = { view: "open", range: "30d", q: "", level: "", queue: "", bucket: "", channel: "", type: "", label: "", status: "", priority: "", owner: "" };

type Toast = { ok: boolean; text: string; key: number } | null;
type StateResponse = { unchanged?: boolean; version: number; user?: CxUser; rights?: Capability[]; people?: Person[]; store?: string; meta?: StoreMeta; sagepilot?: boolean; sagepilotUrl?: string | null; sampleAllowed?: boolean; sharedNote?: string | null; error?: string };
type ListResponse = { version: number; total: number; page: number; pageSize: number; rows: Ticket[]; counters: Counters; error?: string };

const POLL_MS = 10_000;

type Store = {
  user: CxUser;
  actor: Actor;
  now: Date;
  version: number;
  meta: StoreMeta | null;
  storeKind: string | null;
  sagepilot: boolean;
  /** Link template to a ticket in Sagepilot ("…/{id}"), when set. */
  sagepilotUrl: string | null;
  sampleAllowed: boolean;
  sharedNote: string | null;
  loadError: string | null;
  people: Map<string, Person>;
  /** A person's name, the AI, the system or Sagepilot. */
  nameOf: (id: string) => string;
  /** May this person do `cap` (on this ticket, for department-limited rights)? The server checks again. */
  can: (cap: Capability, ticket?: Pick<Ticket, "queueId" | "ownerId"> | null) => boolean;
  // List
  query: ListQuery;
  setQuery: (q: Partial<ListQuery>) => void;
  rows: Ticket[] | null;
  total: number;
  counters: Counters | null;
  loadMore: () => void;
  // Opened ticket
  openId: string | null;
  open: (id: string | null) => void;
  detail: Detail | null;
  // Changes
  act: (action: string, ticket: Pick<Ticket, "id" | "rev">, payload?: Record<string, unknown>, success?: string) => Promise<boolean>;
  simulate: (payload: Record<string, unknown>, success: string) => Promise<string | null>;
  sync: (range: string) => Promise<void>;
  resetTo: (to: "sample" | "empty") => Promise<void>;
  syncing: boolean;
  toast: Toast;
  say: (ok: boolean, text: string) => void;
};

const Ctx = createContext<Store | null>(null);

export function useCx(): Store {
  const store = useContext(Ctx);
  if (!store) throw new Error("useCx outside CxProvider");
  return store;
}

async function post(url: string, body: unknown): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    return { ok: response.ok, status: response.status, body: (await response.json().catch(() => ({}))) as Record<string, unknown> };
  } catch {
    return { ok: false, status: 0, body: { error: "No connection to the server. Check the internet and try again." } };
  }
}

const SYSTEM_NAMES: Record<string, string> = { ai: "EPIK AI", system: "System", sagepilot: "Sagepilot" };

function listUrl(query: ListQuery, page: number): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) params.set(k, v);
  params.set("page", String(page));
  return `/api/cx/tickets?${params}`;
}

export function CxProvider({ user, children }: { user: CxUser; children: ReactNode }) {
  const [meta, setMeta] = useState<StoreMeta | null>(null);
  const [extra, setExtra] = useState({ storeKind: null as string | null, sagepilot: false, sagepilotUrl: null as string | null, sampleAllowed: false, sharedNote: null as string | null });
  const [peopleList, setPeople] = useState<Person[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [toast, setToast] = useState<Toast>(null);
  const [syncing, setSyncing] = useState(false);
  const [version, setVersion] = useState(-1);
  const [query, setQueryState] = useState<ListQuery>(DEFAULT_QUERY);
  const [rows, setRows] = useState<Ticket[] | null>(null);
  const [total, setTotal] = useState(0);
  const [counters, setCounters] = useState<Counters | null>(null);
  const [pages, setPages] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const versionRef = useRef(-1);
  const queryRef = useRef(query);
  const pagesRef = useRef(1);
  const openRef = useRef<string | null>(null);

  const say = useCallback((ok: boolean, text: string) => setToast((prev) => ({ ok, text, key: (prev?.key ?? 0) + 1 })), []);

  const loadList = useCallback(async () => {
    try {
      const all: Ticket[] = [];
      let last: ListResponse | null = null;
      for (let page = 0; page < pagesRef.current; page++) {
        const response = await fetch(listUrl(queryRef.current, page), { cache: "no-store" });
        const body = (await response.json()) as ListResponse;
        if (!response.ok) throw new Error(body.error ?? "Could not load tickets.");
        all.push(...body.rows);
        last = body;
        if ((page + 1) * body.pageSize >= body.total) break;
      }
      if (last) {
        setRows(all);
        setTotal(last.total);
        setCounters(last.counters);
      }
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load tickets.");
    }
  }, []);

  const loadDetail = useCallback(async (id: string | null) => {
    if (!id) {
      setDetail(null);
      return;
    }
    try {
      const response = await fetch(`/api/cx/ticket?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const body = (await response.json()) as Detail & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not open the ticket.");
      if (openRef.current === id) setDetail(body);
    } catch (error) {
      if (openRef.current === id) say(false, error instanceof Error ? error.message : "Could not open the ticket.");
    }
  }, [say]);

  /** Checks the version; reloads the list and the opened ticket only when something changed. */
  const refresh = useCallback(async (force = false) => {
    try {
      const response = await fetch(`/api/cx/state?v=${force ? -1 : versionRef.current}`, { cache: "no-store" });
      const body = (await response.json()) as StateResponse;
      if (response.status === 401) {
        window.location.reload();
        return;
      }
      if (!response.ok) throw new Error(body.error ?? "Could not load tickets.");
      setLoadError(null);
      if (body.unchanged && !force) return;
      versionRef.current = body.version;
      setVersion(body.version);
      if (body.meta) setMeta(body.meta);
      if (body.people) setPeople(body.people);
      setExtra({ storeKind: body.store ?? null, sagepilot: Boolean(body.sagepilot), sagepilotUrl: body.sagepilotUrl ?? null, sampleAllowed: Boolean(body.sampleAllowed), sharedNote: body.sharedNote ?? null });
      await Promise.all([loadList(), loadDetail(openRef.current)]);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load tickets.");
    }
  }, [loadList, loadDetail]);

  // First load, then every 10 seconds while the tab is open, and at once when the tab comes back.
  useEffect(() => {
    const first = window.setTimeout(() => void refresh(true), 0);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, POLL_MS);
    const onShow = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [refresh]);

  // SLA countdowns tick every 30 seconds.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), toast.ok ? 3200 : 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const setQuery = useCallback((change: Partial<ListQuery>) => {
    const next = { ...queryRef.current, ...change };
    queryRef.current = next;
    pagesRef.current = 1;
    setPages(1);
    setQueryState(next);
    setRows(null);
    void loadList();
  }, [loadList]);

  const loadMore = useCallback(() => {
    pagesRef.current += 1;
    setPages(pagesRef.current);
    void loadList();
  }, [loadList]);

  const open = useCallback((id: string | null) => {
    openRef.current = id;
    setOpenId(id);
    setDetail((d) => (d && d.ticket.id === id ? d : null));
    void loadDetail(id);
  }, [loadDetail]);

  const people = useMemo(() => new Map(peopleList.map((p) => [p.id, p])), [peopleList]);
  const nameOf = useCallback((id: string) => SYSTEM_NAMES[id] ?? people.get(id)?.name ?? (id.startsWith("u:") ? id.slice(2) : id), [people]);
  const actor = useMemo<Actor>(() => ({ id: user.id, role: user.role, queueIds: user.queueIds, dept: user.department }), [user]);
  const can = useCallback((cap: Capability, ticket?: Pick<Ticket, "queueId" | "ownerId"> | null) => canDo(actor, cap, ticket), [actor]);

  const act = useCallback<Store["act"]>(async (action, ticket, payload = {}, success) => {
    const res = await post("/api/cx/actions", { action, ticketKey: ticket.id, expectedVersion: ticket.rev ?? 0, payload });
    await refresh(true);
    if (!res.ok) {
      say(false, String(res.body.error ?? "That did not work. Try again."));
      return false;
    }
    if (success) say(true, success);
    return true;
  }, [refresh, say]);

  const simulate = useCallback<Store["simulate"]>(async (payload, success) => {
    const res = await post("/api/cx/actions", { action: "simulate", payload });
    await refresh(true);
    if (!res.ok) {
      say(false, String(res.body.error ?? "That did not work. Try again."));
      return null;
    }
    say(true, success);
    return String(res.body.ticketId ?? "");
  }, [refresh, say]);

  const sync = useCallback(async (range: string) => {
    setSyncing(true);
    const res = await post("/api/cx/sync", { range });
    setSyncing(false);
    await refresh(true);
    if (!res.ok) say(false, String(res.body.error ?? "Sync failed."));
    else say(true, `Synced from Sagepilot (read-only): ${res.body.added ?? 0} new, ${res.body.updated ?? 0} updated${res.body.complete ? ", range complete." : ". More is coming in the background."}`);
  }, [refresh, say]);

  const resetTo = useCallback(async (to: "sample" | "empty") => {
    const res = await post("/api/cx/reset", { to });
    await refresh(true);
    say(res.ok, res.ok ? (to === "sample" ? "Sample week loaded for everyone." : "All tickets cleared.") : String(res.body.error ?? "Reset failed."));
  }, [refresh, say]);

  const value: Store = {
    user, actor, now, version, meta, ...extra, loadError, people, nameOf, can,
    query, setQuery, rows, total, counters, loadMore: pages * 50 < total ? loadMore : () => undefined,
    openId, open, detail, act, simulate, sync, resetTo, syncing, toast, say,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MemoryCxRepository, type CxSnapshot } from "../data/adapters/mock/memory-repo";
import type { Actor } from "../domain/service";
import type { Role } from "../domain/types";

// The shared store lives on the server. This browser keeps a read-only copy, refreshed every 10 seconds,
// and sends every change to /api/cx/actions. Nothing about tickets is saved in the browser.

export type CxUser = { id: string; email: string; name: string; role: Role; queueIds: string[] };
export type StoreMeta = { source: "empty" | "sample" | "sagepilot"; syncedAt: string | null; syncRange: string | null; syncCount: number; syncError: string | null };

type Toast = { ok: boolean; text: string; key: number } | null;
type StateResponse = { unchanged?: boolean; version: number; user?: CxUser; store?: string; meta?: StoreMeta; sagepilot?: boolean; sampleAllowed?: boolean; snapshot?: CxSnapshot; sharedNote?: string | null; error?: string };

const POLL_MS = 10_000;

type Store = {
  data: CxSnapshot | null;
  /** Read-only copy for the panels that compute things (Customer 360). Changes go through `act`. */
  repo: MemoryCxRepository | null;
  user: CxUser;
  actor: Actor;
  now: Date;
  meta: StoreMeta | null;
  storeKind: string | null;
  sagepilot: boolean;
  sampleAllowed: boolean;
  /** Said plainly when the live site has no shared store yet. */
  sharedNote: string | null;
  loadError: string | null;
  /** Sends one action for a ticket. Shows the result; on a clash it reloads and says who changed it. */
  act: (action: string, ticketId: string, payload?: Record<string, unknown>, success?: string) => Promise<boolean>;
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

export function CxProvider({ user, children }: { user: CxUser; children: ReactNode }) {
  const [data, setData] = useState<CxSnapshot | null>(null);
  const [meta, setMeta] = useState<StoreMeta | null>(null);
  const [extra, setExtra] = useState({ storeKind: null as string | null, sagepilot: false, sampleAllowed: false, sharedNote: null as string | null });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [toast, setToast] = useState<Toast>(null);
  const [syncing, setSyncing] = useState(false);
  const version = useRef(-1);

  const say = useCallback((ok: boolean, text: string) => setToast((prev) => ({ ok, text, key: (prev?.key ?? 0) + 1 })), []);

  const refresh = useCallback(async (force = false) => {
    try {
      const response = await fetch(`/api/cx/state?v=${force ? -1 : version.current}`, { cache: "no-store" });
      const body = (await response.json()) as StateResponse;
      if (response.status === 401) {
        window.location.reload();
        return;
      }
      if (!response.ok) throw new Error(body.error ?? "Could not load tickets.");
      setLoadError(null);
      if (body.unchanged || !body.snapshot) return;
      version.current = body.version;
      setData(body.snapshot);
      setMeta(body.meta ?? null);
      setExtra({ storeKind: body.store ?? null, sagepilot: Boolean(body.sagepilot), sampleAllowed: Boolean(body.sampleAllowed), sharedNote: body.sharedNote ?? null });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load tickets.");
    }
  }, []);

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

  const repo = useMemo(() => (data ? new MemoryCxRepository(data) : null), [data]);
  const actor = useMemo<Actor>(() => ({ id: user.id, role: user.role }), [user]);

  const act = useCallback<Store["act"]>(async (action, ticketId, payload = {}, success) => {
    const expect = data?.events.filter((e) => e.ticketId === ticketId).length;
    const res = await post("/api/cx/actions", { action, ticketId, payload, expect });
    await refresh();
    if (!res.ok) {
      say(false, String(res.body.error ?? "That did not work. Try again."));
      return false;
    }
    if (success) say(true, success);
    return true;
  }, [data, refresh, say]);

  const simulate = useCallback<Store["simulate"]>(async (payload, success) => {
    const res = await post("/api/cx/actions", { action: "simulate", payload });
    await refresh();
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
    else say(true, `Synced: ${res.body.added} new tickets from Sagepilot (read-only).`);
  }, [refresh, say]);

  const resetTo = useCallback(async (to: "sample" | "empty") => {
    const res = await post("/api/cx/reset", { to });
    await refresh(true);
    say(res.ok, res.ok ? (to === "sample" ? "Sample week loaded for everyone." : "All tickets cleared.") : String(res.body.error ?? "Reset failed."));
  }, [refresh, say]);

  const value: Store = { data, repo, user, actor, now, meta, ...extra, loadError, act, simulate, sync, resetTo, syncing, toast, say };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { MemoryCxRepository, type CxSnapshot } from "../data/adapters/mock/memory-repo";
import type { ImportedChat } from "../data/adapters/sagepilot/map";
import { buildFromSagepilot } from "../data/adapters/sagepilot/import";
import { buildSyntheticSeed } from "../data/seed/synthetic";
import { CxError, type Actor } from "../domain/service";
import type { Role } from "../domain/types";

// The pilot keeps everything in this browser ("localfile" adapter). Supabase replaces this later, one file.
const STORAGE_KEY = "epik-cx-v1";

export const PERSONAS: Array<{ id: string; name: string; role: Role; note: string }> = [
  { id: "khadija", name: "N Khadija", role: "l1", note: "L1 · reviews and assigns" },
  { id: "sales_owner", name: "Sales owner", role: "l2", note: "L2 · department" },
  { id: "aftersales_owner", name: "After-sales owner", role: "l2", note: "L2 · department" },
  { id: "ceo", name: "CEO", role: "l3", note: "L3 · escalations" },
  { id: "admin", name: "Admin", role: "admin", note: "Sees everything" },
  { id: "viewer", name: "Viewer", role: "viewer", note: "Read only, phones masked" },
];

type Toast = { ok: boolean; text: string; key: number } | null;

export type Source = "sample" | "sagepilot";
export type SourceInfo = { status: "idle" | "loading" | "ready" | "error"; message?: string; fetchedAt?: string; count?: number; range?: string };

type Store = {
  data: CxSnapshot | null;
  repo: MemoryCxRepository | null;
  actor: Actor;
  persona: (typeof PERSONAS)[number];
  setPersona: (id: string) => void;
  now: Date;
  /** Runs an action, shows the result, and catches the plain-language errors from the service. */
  act: (fn: (repo: MemoryCxRepository, actor: Actor, now: Date) => Promise<unknown>, success?: string) => Promise<boolean>;
  toast: Toast;
  say: (ok: boolean, text: string) => void;
  reset: () => Promise<void>;
  source: Source;
  sourceInfo: SourceInfo;
  /** Sample data from this browser, or a fresh read-only pull of real tickets from Sagepilot. */
  loadSource: (source: Source, range?: string) => Promise<void>;
};

const Ctx = createContext<Store | null>(null);

export function useCx(): Store {
  const store = useContext(Ctx);
  if (!store) throw new Error("useCx outside CxProvider");
  return store;
}

function save(data: CxSnapshot) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage full or blocked: the pilot still works until the tab closes.
  }
}

export function CxProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<CxSnapshot | null>(null);
  const [repo, setRepo] = useState<MemoryCxRepository | null>(null);
  const [personaId, setPersonaId] = useState("khadija");
  const [now, setNow] = useState(() => new Date());
  const [toast, setToast] = useState<Toast>(null);

  const [source, setSource] = useState<Source>("sample");
  const [sourceInfo, setSourceInfo] = useState<SourceInfo>({ status: "idle" });

  // Real Sagepilot data is held in memory only: never saved in the browser, since it is customer data.
  const attach = useCallback((snapshot: CxSnapshot, persist: boolean) => {
    setRepo(new MemoryCxRepository(snapshot, (next) => {
      setData(next);
      if (persist) save(next);
    }));
    setData(snapshot);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let snapshot: CxSnapshot | null = null;
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) snapshot = JSON.parse(raw) as CxSnapshot;
      } catch {
        snapshot = null;
      }
      if (!snapshot?.tickets?.length) {
        snapshot = await buildSyntheticSeed(new Date());
        save(snapshot);
      }
      if (!cancelled) attach(snapshot, true);
    })();
    return () => {
      cancelled = true;
    };
  }, [attach]);

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

  const persona = PERSONAS.find((p) => p.id === personaId) ?? PERSONAS[0];
  const actor = useMemo<Actor>(() => ({ id: persona.id, role: persona.role }), [persona]);

  const say = useCallback((ok: boolean, text: string) => setToast((prev) => ({ ok, text, key: (prev?.key ?? 0) + 1 })), []);

  const act = useCallback<Store["act"]>(
    async (fn, success) => {
      if (!repo) return false;
      try {
        await fn(repo, actor, new Date());
        if (success) say(true, success);
        return true;
      } catch (error) {
        say(false, error instanceof CxError ? error.message : "That did not work. Try again.");
        return false;
      }
    },
    [repo, actor, say],
  );

  const reset = useCallback(async () => {
    const snapshot = await buildSyntheticSeed(new Date());
    save(snapshot);
    attach(snapshot, true);
    setSource("sample");
    say(true, "Sample data restored.");
  }, [attach, say]);

  const loadSource = useCallback(async (next: Source, range = "last_7_days") => {
    if (next === "sample") {
      let snapshot: CxSnapshot | null = null;
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) snapshot = JSON.parse(raw) as CxSnapshot;
      } catch {
        snapshot = null;
      }
      if (!snapshot?.tickets?.length) snapshot = await buildSyntheticSeed(new Date());
      attach(snapshot, true);
      setSource("sample");
      setSourceInfo({ status: "idle" });
      return;
    }
    setSourceInfo({ status: "loading", range });
    try {
      const response = await fetch(`/api/cx/sagepilot?range=${encodeURIComponent(range)}&max=200`, { cache: "no-store" });
      const body = (await response.json()) as { error?: string; items?: ImportedChat[]; fetchedAt?: string; count?: number };
      if (!response.ok || !body.items) throw new Error(body.error ?? "Could not load Sagepilot tickets.");
      const snapshot = await buildFromSagepilot(body.items, new Date());
      attach(snapshot, false);
      setSource("sagepilot");
      setSourceInfo({ status: "ready", fetchedAt: body.fetchedAt, count: snapshot.tickets.length, range });
      say(true, `${snapshot.tickets.length} real tickets loaded from Sagepilot (read-only).`);
    } catch (error) {
      setSourceInfo({ status: "error", message: error instanceof Error ? error.message : "Could not load Sagepilot tickets.", range });
    }
  }, [attach, say]);

  const value: Store = { data, repo, actor, persona, setPersona: setPersonaId, now, act, toast, say, reset, source, sourceInfo, loadSource };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

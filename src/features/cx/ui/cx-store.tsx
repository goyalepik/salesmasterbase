"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { MemoryCxRepository, type CxSnapshot } from "../data/adapters/mock/memory-repo";
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

  const attach = useCallback((snapshot: CxSnapshot) => {
    setRepo(new MemoryCxRepository(snapshot, (next) => {
      setData(next);
      save(next);
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
      if (!cancelled) attach(snapshot);
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
    attach(snapshot);
    say(true, "Sample data restored.");
  }, [attach, say]);

  const value: Store = { data, repo, actor, persona, setPersona: setPersonaId, now, act, toast, say, reset };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

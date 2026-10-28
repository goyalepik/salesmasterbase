"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { attachLiveSource, shouldSubscribe, type LiveSource } from "@/lib/live/merge";
import { connectionLabel, type LiveConnection } from "@/lib/live/state";
import type { InboxRow } from "@/lib/types";

export type LiveChange = { table: string; action: string; id: string; row?: InboxRow };

type LiveApi = {
  mode: "demo" | "live" | "blocked";
  status: LiveConnection;
  subscribe: (listener: (change: LiveChange) => void) => () => void;
  reconnect: () => void;
};

const LiveContext = createContext<LiveApi | null>(null);

function initialStatus(mode: LiveApi["mode"]): LiveConnection {
  if (mode === "demo") return "demo";
  if (mode === "blocked") return "not_configured";
  return "connecting";
}

export function LiveProvider({ mode, children }: { mode: LiveApi["mode"]; children: ReactNode }) {
  const [status, setStatus] = useState<LiveConnection>(initialStatus(mode));
  const [generation, setGeneration] = useState(0);
  const listeners = useRef(new Set<(change: LiveChange) => void>());

  const subscribe = useCallback((listener: (change: LiveChange) => void) => {
    listeners.current.add(listener);
    return () => listeners.current.delete(listener);
  }, []);

  const reconnect = useCallback(() => {
    setStatus("connecting");
    setGeneration((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!shouldSubscribe(mode)) return;
    const source = new EventSource("/api/live");
    const adapter: LiveSource = {
      addEventListener(type, listener) {
        source.addEventListener(type, listener as unknown as EventListener);
      },
      removeEventListener(type, listener) {
        source.removeEventListener(type, listener as unknown as EventListener);
      },
      close() {
        source.close();
      },
    };
    const binding = attachLiveSource(adapter, {
      onStatus(next) {
        if (next === "SUBSCRIBED") setStatus("on");
        else if (next === "CHANNEL_ERROR" || next === "TIMED_OUT") setStatus("unavailable");
        else if (next === "CLOSED") setStatus("offline");
      },
      onChange(change) {
        listeners.current.forEach((listener) => listener(change));
      },
    });
    source.onerror = () => setStatus("reconnecting");
    return () => binding.close();
  }, [generation, mode]);

  const shown = mode === "live" ? status : initialStatus(mode);
  const api = useMemo(() => ({ mode, status: shown, subscribe, reconnect }), [mode, reconnect, shown, subscribe]);
  return <LiveContext.Provider value={api}>{children}</LiveContext.Provider>;
}

export function useLiveEvent(listener: (change: LiveChange) => void) {
  const live = useContext(LiveContext);
  const saved = useRef(listener);
  useEffect(() => {
    saved.current = listener;
  }, [listener]);
  useEffect(() => {
    if (!live) return;
    return live.subscribe((change) => saved.current(change));
  }, [live]);
}

export function ConnectionStatus() {
  const router = useRouter();
  const live = useContext(LiveContext);
  const status = live?.status ?? "offline";
  const tone = status === "on" ? "bg-good" : status === "demo" ? "bg-warn" : status === "connecting" || status === "reconnecting" ? "bg-accent" : status === "not_configured" ? "bg-faint" : "bg-bad";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <p className="flex items-center gap-2">
        <span className={`inline-block size-1.5 rounded-full ${tone}`} />
        <span>{connectionLabel(status)}</span>
      </p>
      <button type="button" className="text-ink hover:text-accent" onClick={() => router.refresh()}>Refresh</button>
      {live?.mode === "live" ? (
        <button type="button" className="text-ink hover:text-accent" onClick={live.reconnect}>Reconnect</button>
      ) : null}
    </div>
  );
}

export function RefreshOnChange() {
  const router = useRouter();
  const timer = useRef<number | null>(null);
  useLiveEvent(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => router.refresh(), 300);
  });
  return null;
}

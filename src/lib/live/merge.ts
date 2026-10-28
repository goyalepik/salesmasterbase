import type { LiveConnection } from "@/lib/live/state";
import type { InboxRow } from "@/lib/types";
import { matchesInboxQuery } from "@/lib/query";
import type { MessageQuery } from "@/lib/types";

export function mergeInboxRows(
  items: InboxRow[],
  incoming: InboxRow,
  query: MessageQuery,
): { items: InboxRow[]; totalDelta: number } {
  const existingIndex = items.findIndex((item) => item.id === incoming.id);
  if (!matchesInboxQuery(incoming, query)) {
    if (existingIndex === -1) return { items, totalDelta: 0 };
    const next = items.filter((item) => item.id !== incoming.id);
    return { items: next, totalDelta: -1 };
  }
  if (existingIndex >= 0) {
    const next = items.slice();
    next[existingIndex] = incoming;
    return { items: next, totalDelta: 0 };
  }
  if (query.page !== 1) return { items, totalDelta: 1 };
  const next = [incoming, ...items].sort((a, b) => b.eventReceivedAt.localeCompare(a.eventReceivedAt));
  if (next.length > query.pageSize) next.length = query.pageSize;
  return { items: next, totalDelta: 1 };
}

export function shouldSubscribe(mode: "demo" | "live" | "blocked"): boolean {
  return mode === "live";
}

export type LiveSource = {
  addEventListener(type: string, listener: (event: { data: string }) => void): void;
  removeEventListener(type: string, listener: (event: { data: string }) => void): void;
  close(): void;
};

export function attachLiveSource(
  source: LiveSource,
  handlers: {
    onStatus: (status: string) => void;
    onChange: (change: { table: string; action: string; id: string; row?: InboxRow }) => void;
  },
): { close: () => void } {
  const onStatus = (event: { data: string }) => {
    const payload = JSON.parse(event.data) as { status?: string };
    if (payload.status) handlers.onStatus(payload.status);
  };
  const onChange = (event: { data: string }) => {
    handlers.onChange(JSON.parse(event.data) as { table: string; action: string; id: string; row?: InboxRow });
  };
  source.addEventListener("status", onStatus);
  source.addEventListener("change", onChange);
  return {
    close() {
      source.removeEventListener("status", onStatus);
      source.removeEventListener("change", onChange);
      source.close();
    },
  };
}

export function nextConnection(current: LiveConnection, event: "subscribed" | "error" | "channel_error" | "closed"): LiveConnection {
  if (event === "subscribed") return "on";
  if (event === "channel_error") return "unavailable";
  if (event === "closed") return "offline";
  if (event === "error") return current === "on" || current === "reconnecting" ? "reconnecting" : "reconnecting";
  return current;
}

"use client";

import type { CSSProperties } from "react";
import { teamOf, type Person, type Priority, type TeamId } from "../lib/model";

const HUES = [214, 152, 268, 32, 340, 188, 48, 290];

export function Face({ person, size = 26, title }: { person: Person | null | undefined; size?: number; title?: string }) {
  if (!person) {
    return <span className="tk-face is-empty" style={{ width: size, height: size }} title={title ?? "Unassigned"} aria-label="Unassigned" />;
  }
  let hash = 0;
  for (const ch of person.name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = HUES[hash % HUES.length];
  const parts = person.name.trim().split(/\s+/);
  const letters = (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0][1] ?? "")).toUpperCase();
  return (
    <span
      className="tk-face"
      title={title ?? person.name}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: `linear-gradient(160deg, hsl(${hue} 72% 64%), hsl(${hue} 60% 44%))` }}
    >
      {letters}
    </span>
  );
}

export function TeamTag({ team, small }: { team: TeamId; small?: boolean }) {
  const t = teamOf(team);
  return (
    <span className={`tk-team ${small ? "is-small" : ""}`} style={{ "--team": t.colour } as CSSProperties}>
      <i />
      {t.short}
    </span>
  );
}

export function PriorityMark({ priority }: { priority: Priority }) {
  const bars = priority === "urgent" ? 4 : priority === "high" ? 3 : priority === "normal" ? 2 : 1;
  return (
    <span className={`tk-prio is-${priority}`} title={`${priority[0].toUpperCase()}${priority.slice(1)} priority`} aria-label={`${priority} priority`}>
      {[1, 2, 3, 4].map((n) => <i key={n} className={n <= bars ? "on" : ""} />)}
    </span>
  );
}

export function shortDate(iso: string | null): string {
  if (!iso) return "No date";
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function ago(at: string, now: Date = new Date()): string {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(at).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

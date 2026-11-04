"use client";

import type { CSSProperties } from "react";
import type { Branch } from "../lib/org";

const HUES = [214, 152, 268, 32, 340, 188, 48, 290];

export function Face({ person, size = 26, title }: { person: { name: string } | null | undefined; size?: number; title?: string }) {
  if (!person) {
    return <span className="tk-face is-empty" style={{ width: size, height: size }} title={title ?? "Nobody yet"} aria-label="Nobody yet" />;
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

export function BranchTag({ branch, small }: { branch: Branch | null; small?: boolean }) {
  if (!branch) return null;
  return (
    <span className={`tk-team ${small ? "is-small" : ""}`} style={{ "--team": branch.colour } as CSSProperties}>
      <i />
      {branch.name}
    </span>
  );
}

export function shortDate(iso: string | null): string {
  if (!iso) return "No date";
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** "Today", "Tomorrow", "Fri 7 Nov" or "12 Nov": how a due date reads on a card. */
export function dueText(iso: string | null, today: string): string {
  if (!iso) return "No date";
  const diff = Math.round((new Date(`${iso}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff > 1 && diff < 7) return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  return shortDate(iso);
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

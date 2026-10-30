import type { CSSProperties } from "react";

const AVATAR_HUES = [214, 152, 268, 32, 340, 188, 48, 290];

/** Same colour for the same name everywhere. */
export function avatarStyle(name: string): CSSProperties {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = AVATAR_HUES[hash % AVATAR_HUES.length];
  return { background: `linear-gradient(180deg, hsl(${hue} 70% 62%), hsl(${hue} 62% 46%))` };
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0][1] ?? "")).toUpperCase();
}

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span className="avatar" style={{ ...avatarStyle(name), width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

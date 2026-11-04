"use client";

import type { PointerEvent, ReactNode } from "react";

/** The card grid. Tracks the pointer so each card's soft light follows the cursor. */
export function CardGrid({ children }: { children: ReactNode }) {
  const move = (e: PointerEvent<HTMLElement>) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>(".hm-card");
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${e.clientX - r.left}px`);
    card.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  return (
    <nav className="hm-grid" aria-label="Workspaces" onPointerMove={move}>
      {children}
    </nav>
  );
}

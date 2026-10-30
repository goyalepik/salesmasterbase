"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Space } from "@/lib/spaces";

const MIN_MS = 1500;
const MAX_MS = 6000;
const LEAVE_MS = 320;

/**
 * A bullet train crosses the screen, then the space says hello. The welcome stays until the new
 * space's page has loaded (at least 1.5 seconds, at most 6), so the old page never flashes back.
 */
export function SpaceTransition({ space, arrived, onDone }: { space: Space | null; arrived: boolean; onDone: () => void }) {
  const [minDone, setMinDone] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);

  useEffect(() => {
    if (!space) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const min = window.setTimeout(() => setMinDone(true), reduced ? 600 : MIN_MS);
    const max = window.setTimeout(() => setTimedOut(true), MAX_MS);
    return () => {
      window.clearTimeout(min);
      window.clearTimeout(max);
      setMinDone(false);
      setTimedOut(false);
    };
  }, [space]);

  const leaving = Boolean(space) && ((minDone && arrived) || timedOut);
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => done.current(), LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  if (!space) return null;
  return (
    <div key={space.id} className={`space-transition ${leaving ? "is-leaving" : ""}`} style={{ "--space": space.colour } as CSSProperties} role="status" aria-live="polite">
      <div className="space-transition-lines" aria-hidden="true">
        {Array.from({ length: 9 }, (_, i) => <i key={i} style={{ top: `${18 + i * 8}%`, animationDelay: `${(i % 4) * 70}ms` }} />)}
      </div>
      <div className="space-train" aria-hidden="true">
        <span className="space-train-trail" />
        <Train />
      </div>
      <div className="space-welcome">
        <p className="space-welcome-kicker">Now arriving</p>
        <h2>{space.welcome}</h2>
        <p className="space-welcome-tagline">{space.tagline}</p>
      </div>
    </div>
  );
}

function Train() {
  return (
    <svg viewBox="0 0 1000 140" className="h-full w-auto" role="presentation">
      <defs>
        <linearGradient id="train-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="70%" stopColor="#d6deea" />
          <stop offset="100%" stopColor="#9aa6b8" />
        </linearGradient>
        <linearGradient id="train-glass" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#0a1220" />
          <stop offset="100%" stopColor="#1b2a44" />
        </linearGradient>
      </defs>
      <path d="M0 40 H630 C770 40 890 72 988 110 C998 114 996 126 984 126 H0 Z" fill="url(#train-body)" />
      <rect x="18" y="56" width="590" height="18" rx="9" fill="url(#train-glass)" />
      {Array.from({ length: 12 }, (_, i) => <rect key={i} x={30 + i * 48} y="58" width="2" height="14" fill="#d6deea" opacity="0.5" />)}
      <path d="M672 52 C760 54 838 78 892 102 L846 102 C800 84 742 68 672 66 Z" fill="url(#train-glass)" />
      <path d="M0 92 H760 C840 92 900 104 950 116 L940 118 C890 108 830 100 760 100 H0 Z" fill="var(--space)" />
      <rect x="0" y="122" width="960" height="6" rx="3" fill="#5b6576" />
      <circle cx="975" cy="117" r="4" fill="#fff8d6" />
    </svg>
  );
}

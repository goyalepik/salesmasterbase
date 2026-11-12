"use client";

import type { CSSProperties, ReactNode } from "react";
import { Mark, useMis, type Detail } from "./kit";

/* ---------- Waterfall: a starting amount, the steps that take it up or down, and the subtotals ---------- */

export type Step = { label: string; value: number; kind: "start" | "delta" | "subtotal" | "total"; display: string; detail: Detail };

export function Waterfall({ steps, height = "100%" }: { steps: Step[]; height?: string }) {
  // Each bar starts where the one before it ended (a delta) or at zero (a total).
  const levels = steps.reduce<number[]>((acc, s, i) => [...acc, s.kind === "delta" ? (i ? acc[i - 1] : 0) + s.value : s.value], []);
  const bars = steps.map((s, i) => {
    const level = levels[i];
    const from = s.kind === "delta" ? (i ? levels[i - 1] : 0) : 0;
    return { ...s, lo: Math.min(from, level), hi: Math.max(from, level), level };
  });
  const min = Math.min(0, ...bars.map((b) => b.lo));
  const max = Math.max(0, ...bars.map((b) => b.hi));
  const span = max - min || 1;
  const y = (v: number) => ((v - min) / span) * 100;

  return (
    <div className="wf" style={{ height, gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))` } as CSSProperties}>
      {bars.map((b, i) => {
        const tone = b.kind === "delta" ? (b.value >= 0 ? "is-up" : "is-down") : b.kind === "total" ? "is-total" : b.kind === "start" ? "is-start" : "is-sub";
        const next = bars[i + 1];
        return (
          <div key={b.label} className="wf-col">
            <div className="wf-plot">
              <span className={`wf-zero ${next ? "" : "is-last"}`} style={{ bottom: `${y(0)}%` }} aria-hidden="true" />
              {next ? <span className="wf-link" style={{ bottom: `${y(b.level)}%` }} aria-hidden="true" /> : null}
              <Mark detail={b.detail} className={`wf-bar ${tone}`} style={{ bottom: `${y(b.lo)}%`, height: `max(2px, ${y(b.hi) - y(b.lo)}%)` }}>
                <span className={`wf-val ${b.value < 0 && b.kind !== "delta" ? "is-below" : ""}`}>{b.display}</span>
              </Mark>
            </div>
            <span className="wf-label">{b.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Donut ---------- */

export type Slice = { label: string; value: number; color: string; detail: Detail };

export function Donut({ slices, center, sub, size = 180 }: { slices: Slice[]; center: string; sub: string; size?: number }) {
  const { open, tip } = useMis();
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0) || 1;
  const r = 48;
  const c = 2 * Math.PI * r;
  const gap = slices.length > 1 ? 1.6 : 0;
  const lens = slices.map((s) => (Math.max(0, s.value) / total) * c);
  const starts = lens.map((_, i) => lens.slice(0, i).reduce((a, b) => a + b, 0));
  return (
    <div className="donut" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" role="img" aria-label={`${center} ${sub}`}>
        <circle cx="60" cy="60" r={r} className="donut-track" />
        {slices.map((s, i) => {
          const dash = Math.max(0, lens[i] - gap);
          return (
            <circle
              key={s.label}
              cx="60" cy="60" r={r}
              className="donut-seg"
              style={{ stroke: s.color }}
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-starts[i]}
              tabIndex={0}
              role="button"
              aria-label={`${s.label}: ${s.detail.value ?? ""}`}
              onMouseMove={(e) => tip({ x: e.clientX, y: e.clientY, detail: s.detail })}
              onMouseLeave={() => tip(null)}
              onClick={() => open(s.detail)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && open(s.detail)}
            />
          );
        })}
      </svg>
      <div className="donut-center">
        <b>{center}</b>
        <span>{sub}</span>
      </div>
    </div>
  );
}

/* ---------- Horizontal bars, with last month as a tick ---------- */

export type BarRow = { label: string; sub?: string; value: number; display: string; prev?: number | null; right?: ReactNode; tone?: "neg" | "muted"; detail: Detail };

export function BarList({ rows, max, dense, stacked }: { rows: BarRow[]; max?: number; dense?: boolean; stacked?: boolean }) {
  const top = max ?? Math.max(...rows.map((r) => Math.max(r.value, r.prev ?? 0)), 1);
  return (
    <ul className={`bl ${dense ? "is-dense" : ""} ${stacked ? "is-stacked" : ""}`}>
      {rows.map((r) => (
        <li key={r.label}>
          <Mark detail={r.detail} className="bl-row">
            <span className="bl-label">
              <b>{r.label}</b>
              {r.sub ? <i>{r.sub}</i> : null}
            </span>
            <span className="bl-track">
              <span className={`bl-fill ${r.tone ? `is-${r.tone}` : ""}`} style={{ width: `${Math.max(0.6, (Math.abs(r.value) / top) * 100)}%` }} />
              {r.prev != null && r.prev > 0 ? <span className="bl-prev" style={{ left: `${Math.min(100, (r.prev / top) * 100)}%` }} aria-hidden="true" /> : null}
            </span>
            <span className="bl-val">{r.display}</span>
            {r.right ? <span className="bl-right">{r.right}</span> : null}
          </Mark>
        </li>
      ))}
    </ul>
  );
}

/* ---------- One stacked bar with a legend ---------- */

export type Segment = { label: string; value: number; color: string; display: string; detail: Detail };

export function StackBar({ segments, legend = true }: { segments: Segment[]; legend?: boolean }) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0) || 1;
  return (
    <div className="sb">
      <div className="sb-bar">
        {segments.map((s) => (
          <Mark key={s.label} detail={s.detail} className="sb-seg" style={{ flexGrow: Math.max(0, s.value) / total, background: s.color }} />
        ))}
      </div>
      {legend ? (
        <ul className="sb-legend">
          {segments.map((s) => (
            <li key={s.label}>
              <Mark detail={s.detail} className="sb-key">
                <i style={{ background: s.color }} />
                <span>{s.label}</span>
                <b>{s.display}</b>
              </Mark>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ---------- Columns (one per month) ---------- */

export type Column = { label: string; value: number; display: string; faded?: boolean; detail: Detail };

export function Columns({ cols }: { cols: Column[] }) {
  const max = Math.max(...cols.map((c) => c.value), 1);
  return (
    <div className="cols" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
      {cols.map((c) => (
        <div key={c.label} className="cols-col">
          <div className="cols-plot">
            <Mark detail={c.detail} className={`cols-bar ${c.faded ? "is-faded" : ""}`} style={{ height: `${(c.value / max) * 100}%` }}>
              <span className="cols-val">{c.display}</span>
            </Mark>
          </div>
          <span className="cols-label">{c.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- Lines on one % axis ---------- */

export type Line = { key: string; label: string; color: string; points: (number | null)[]; details: (Detail | null)[] };

export function Lines({ labels, lines, max = 100 }: { labels: string[]; lines: Line[]; max?: number }) {
  const x = (i: number) => (labels.length === 1 ? 50 : (i / (labels.length - 1)) * 100);
  const y = (v: number) => 100 - (v / max) * 100;
  return (
    <div className="ln">
      <div className="ln-plot">
        {[0, 25, 50, 75, 100].map((g) => (
          <span key={g} className="ln-grid" style={{ bottom: `${g}%` }}><i>{Math.round((g / 100) * max)}%</i></span>
        ))}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {lines.map((l) => {
            const pts = l.points.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(" ");
            return <polyline key={l.key} points={pts} fill="none" stroke={l.color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />;
          })}
        </svg>
        {lines.map((l) =>
          l.points.map((v, i) =>
            v == null || !l.details[i] ? null : (
              <Mark key={`${l.key}-${i}`} detail={l.details[i]!} className="ln-dot" style={{ left: `${x(i)}%`, bottom: `${100 - y(v)}%`, borderColor: l.color }} />
            ),
          ),
        )}
        {lines.map((l) => {
          const last = l.points.length - 1;
          const v = l.points[last];
          return v == null ? null : (
            <span key={`${l.key}-label`} className="ln-end" style={{ bottom: `${100 - y(v)}%`, color: "var(--ink)" }}>
              <i style={{ background: l.color }} />{v.toFixed(1)}%
            </span>
          );
        })}
      </div>
      <div className="ln-x" style={{ gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))` }}>
        {labels.map((l) => <span key={l}>{l}</span>)}
      </div>
      <ul className="ln-legend">
        {lines.map((l) => <li key={l.key}><i style={{ background: l.color }} />{l.label}</li>)}
      </ul>
    </div>
  );
}

/* ---------- A meter for one share ---------- */

export function Meter({ value, label, tone = "blue" }: { value: number; label: string; tone?: "blue" | "good" | "warn" | "bad" }) {
  return (
    <div className={`meter is-${tone}`}>
      <span className="meter-track"><span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></span>
      <span className="meter-label">{label}</span>
    </div>
  );
}

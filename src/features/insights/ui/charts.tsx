"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import type { Consultant, Rate } from "../lib/types";

export const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;
/** Percent for a style, rounded so the server and browser write the same string. */
export const w = (fraction: number) => `${(fraction * 100).toFixed(2)}%`;
export const num = (n: number) => Math.round(n).toLocaleString("en-IN");
const signed = (x: number, digits = 0) => `${x >= 0 ? "+" : "−"}${pct(Math.abs(x), digits)}`;

/** ₹ in Indian units: ₹4.7 cr, ₹47 L, ₹47,000. */
export function inr(minor: number | null): string {
  if (minor == null) return "Not known";
  const r = minor / 100;
  if (r >= 1e7) return `₹${(r / 1e7).toFixed(r >= 1e8 ? 0 : 2)} cr`;
  if (r >= 1e5) return `₹${(r / 1e5).toFixed(1)} L`;
  return `₹${num(r)}`;
}

// ── Data cards ────────────────────────────────────────────────────────────────────────────────
// Every mark carries the numbers behind it. Hover shows them; click pins a card with the method and the source.

export type TipData = { title: string; rows: [string, string][]; note?: string };
/** Serialise a data card onto an element: data-tip={tip(...)}. */
export const tip = (title: string, rows: [string, string][], note?: string) => JSON.stringify({ title, rows, note } satisfies TipData);

function parseTip(raw: string): TipData {
  try {
    const t = JSON.parse(raw) as TipData;
    if (t && typeof t.title === "string") return t;
  } catch { /* plain text */ }
  const [title, ...rest] = raw.split("\n");
  return { title, rows: [], note: rest.join(" ") || undefined };
}

/** What every number on the page is built from, shown at the foot of each pinned card. */
export const SourceContext = createContext("");

export function TipLayer({ children, source }: { children: ReactNode; source: string }) {
  const hover = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<TipData | null>(null);
  const [pinned, setPinned] = useState<{ data: TipData; x: number; y: number } | null>(null);
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = hover.current;
    const root = el?.parentElement;
    if (!el || !root) return;
    const place = (x: number, y: number) => {
      const wd = el.offsetWidth;
      el.style.left = `${Math.min(window.innerWidth - wd - 12, Math.max(12, x - wd / 2))}px`;
      el.style.top = `${Math.max(12, y - el.offsetHeight - 14)}px`;
    };
    const target = (e: Event) => (e.target as HTMLElement).closest<HTMLElement>("[data-tip]");
    const move = (e: PointerEvent) => {
      const t = target(e);
      setHovered(t?.dataset.tip ? parseTip(t.dataset.tip) : null);
      if (t) place(e.clientX, e.clientY);
    };
    const pin = (t: HTMLElement, x: number, y: number) => { setHovered(null); setPinned({ data: parseTip(t.dataset.tip!), x, y }); };
    const click = (e: MouseEvent) => {
      if (card.current?.contains(e.target as Node)) return;
      const t = target(e);
      if (t) { e.preventDefault(); pin(t, e.clientX, e.clientY); } else setPinned(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPinned(null);
      const t = target(e);
      if (t && (e.key === "Enter" || e.key === " ") && !t.closest("button, a")) { e.preventDefault(); const r = t.getBoundingClientRect(); pin(t, r.left + r.width / 2, r.bottom); }
    };
    const leave = () => setHovered(null);
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerleave", leave);
    root.addEventListener("click", click);
    root.addEventListener("keydown", key);
    window.addEventListener("scroll", leave, true);
    const close = () => setPinned(null);
    window.addEventListener("hashchange", close);
    return () => {
      window.removeEventListener("hashchange", close);
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerleave", leave);
      root.removeEventListener("click", click);
      root.removeEventListener("keydown", key);
      window.removeEventListener("scroll", leave, true);
    };
  }, []);

  useEffect(() => {
    const el = card.current;
    if (!el || !pinned) return;
    const r = el.getBoundingClientRect();
    el.style.left = `${Math.min(window.innerWidth - r.width - 16, Math.max(16, pinned.x + 14))}px`;
    el.style.top = `${Math.min(window.innerHeight - r.height - 16, Math.max(16, pinned.y - 24))}px`;
    el.focus();
  }, [pinned]);

  return (
    <SourceContext.Provider value={source}>
      {children}
      <div ref={hover} className={`ci-tip ${hovered && !pinned ? "is-on" : ""}`} role="tooltip">
        {hovered ? (
          <>
            <b>{hovered.title}</b>
            {hovered.rows.slice(0, 4).map(([k, v]) => <span key={k}>{k}: <em>{v}</em></span>)}
            <small>Click for the full card</small>
          </>
        ) : null}
      </div>
      {pinned ? (
        <div ref={card} className="ci-pin" role="dialog" aria-label={pinned.data.title} tabIndex={-1}>
          <header>
            <b>{pinned.data.title}</b>
            <button type="button" onClick={() => setPinned(null)} aria-label="Close"><X size={14} /></button>
          </header>
          {pinned.data.rows.length ? (
            <dl>{pinned.data.rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          ) : null}
          {pinned.data.note ? <p>{pinned.data.note}</p> : null}
          <footer>Source: {source}</footer>
        </div>
      ) : null}
    </SourceContext.Provider>
  );
}

export const useSource = () => useContext(SourceContext);

// ── Bars ──────────────────────────────────────────────────────────────────────────────────────

/** Conversion by group: a bar per group, a whisker for the 95% range, and a dashed line at the average. */
export function RateBars({ rows, base, label = (k) => k }: { rows: Rate[]; base: number; label?: (key: string) => string }) {
  const max = Math.max(base * 1.6, ...rows.map((r) => r.hi)) || 1;
  const total = rows.reduce((s, r) => s + r.n, 0);
  const x = (v: number) => w(v / max);
  return (
    <div className="ci-bars" role="table" aria-label="Conversion by group">
      {rows.map((r) => (
        <div key={r.key} className="ci-bar-row" role="row" tabIndex={0} data-tip={tip(label(r.key), [
          ["Demos", num(r.n)],
          ["Sales", num(r.won)],
          ["Conversion", pct(r.rate, 1)],
          ["Likely range (95%)", `${pct(r.lo, 1)} to ${pct(r.hi, 1)}`],
          ["Vs average", signed(r.lift - 1)],
          ["Share of demos in this cut", pct(r.n / Math.max(1, total), 1)],
        ], "The likely range is a 95% Wilson interval: rerun the same demos and the true rate lands inside it 19 times in 20. If two ranges overlap, the gap may be chance.")}>
          <span className="ci-bar-label" role="rowheader">{label(r.key)}</span>
          <span className="ci-bar-track" role="cell">
            <span className="ci-bar-fill" style={{ width: x(r.rate) }} />
            <span className="ci-bar-ci" style={{ left: x(r.lo), width: `calc(${x(r.hi)} - ${x(r.lo)})` }} />
            <span className="ci-bar-avg" style={{ left: x(base) }} />
          </span>
          <span className="ci-bar-val" role="cell"><b>{pct(r.rate, 1)}</b><small>n {num(r.n)}</small></span>
        </div>
      ))}
      <div className="ci-bars-key"><span className="ci-key-avg" /> Average {pct(base, 1)} <span className="ci-key-ci" /> Likely range (95%) <span className="ci-key-n">n = demos in the group · click a bar for its card</span></div>
    </div>
  );
}

/** Helps vs hurts: odds ratios on a log scale, blue to the right, red to the left. */
export function DriverBars({ drivers }: { drivers: { group: string; level: string; odds: number; n: number }[] }) {
  const lim = Math.max(...drivers.map((d) => Math.abs(Math.log(d.odds))), Math.log(2));
  return (
    <div className="ci-drivers">
      <div className="ci-drivers-axis"><span>Lowers the chance</span><span>Raises the chance</span></div>
      {drivers.map((d) => {
        const half = w(Math.abs(Math.log(d.odds)) / lim / 2);
        const up = d.odds >= 1;
        return (
          <div key={`${d.group}:${d.level}`} className="ci-driver" tabIndex={0} data-tip={tip(`${d.group}: ${d.level}`, [
            ["Effect on the odds of a sale", up ? `${d.odds.toFixed(2)}× higher` : `${(1 / d.odds).toFixed(2)}× lower`],
            ["Demos with this", num(d.n)],
            ["Model", "Logistic regression, L2 regularised"],
          ], "With product, brand, source, hub, timing, demo length and the AI call signals all held equal. Odds, not rates: 2× the odds at a 20% base is about a 33% chance.")}>
            <span className="ci-driver-label"><small>{d.group}</small>{d.level}</span>
            <span className="ci-driver-track">
              <span className={`ci-driver-bar ${up ? "is-up" : "is-down"}`} style={up ? { left: "50%", width: half } : { right: "50%", width: half }} />
              <span className="ci-driver-mid" />
            </span>
            <span className="ci-driver-val">{up ? `${d.odds.toFixed(1)}×` : `÷${(1 / d.odds).toFixed(1)}`}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Ten columns: unseen demos ranked by the lead score, best first. */
export function DecileBars({ deciles, base }: { deciles: { decile: number; n: number; rate: number }[]; base: number }) {
  const max = Math.max(...deciles.map((d) => d.rate)) || 1;
  return (
    <div className="ci-deciles" role="img" aria-label={`Conversion by lead-score tenth: ${deciles.map((d) => pct(d.rate)).join(", ")}`}>
      {deciles.map((d) => (
        <div key={d.decile} className="ci-decile" tabIndex={0} data-tip={tip(d.decile === 1 ? "Top 10% by score" : d.decile === 10 ? "Bottom 10% by score" : `Score tenth ${d.decile} of 10`, [
          ["Demos", num(d.n)],
          ["Bought", num(d.rate * d.n)],
          ["Share that bought", pct(d.rate, 1)],
          ["Vs average", `${(d.rate / Math.max(base, 0.001)).toFixed(2)}×`],
        ], "Test demos the model never trained on, sorted by its predicted chance and cut into ten equal groups.")}>
          <span className="ci-decile-val">{pct(d.rate)}</span>
          <span className="ci-decile-bar" style={{ height: w(Math.max(0.02, d.rate / max)), opacity: Number((1 - (d.decile - 1) * 0.06).toFixed(2)) }} />
          <span className="ci-decile-x">{d.decile === 1 ? "Top 10%" : d.decile === 10 ? "Bottom" : d.decile}</span>
        </div>
      ))}
    </div>
  );
}

const RAMP = ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Day × hour: darker blue sells more. Cells with too few demos stay blank. */
export function Heatmap({ cells, base, minN = 15 }: { cells: { day: number; hour: number; n: number; rate: number }[]; base: number; minN?: number }) {
  const hours = Array.from({ length: 12 }, (_, i) => i + 9);
  const shown = cells.filter((c) => c.n >= minN);
  const lo = Math.min(...shown.map((c) => c.rate));
  const hi = Math.max(...shown.map((c) => c.rate));
  const colour = (r: number) => RAMP[Math.min(RAMP.length - 1, Math.floor(((r - lo) / Math.max(hi - lo, 0.0001)) * RAMP.length))];
  const at = new Map(cells.map((c) => [`${c.day}-${c.hour}`, c]));
  const hourLabel = (h: number) => (h === 12 ? "12p" : h > 12 ? `${h - 12}p` : `${h}a`);
  const slot = (h: number) => `${hourLabel(h)}m to ${hourLabel(h + 1)}m`;
  return (
    <div className="ci-heat">
      <div className="ci-heat-grid" style={{ gridTemplateColumns: `36px repeat(${hours.length}, 1fr)` }}>
        <span />
        {hours.map((h) => <span key={h} className="ci-heat-x">{hourLabel(h)}</span>)}
        {[1, 2, 3, 4, 5, 6, 0].map((d) => (
          <div key={d} className="ci-heat-row">
            <span className="ci-heat-y">{DAYS[d]}</span>
            {hours.map((h) => {
              const c = at.get(`${d}-${h}`);
              const ok = c && c.n >= minN;
              return <span key={h} className={`ci-heat-cell ${ok ? "" : "is-empty"}`} style={ok ? { background: colour(c.rate) } : undefined} tabIndex={ok ? 0 : -1} data-tip={c ? tip(`${DAY_NAMES[d]}, ${slot(h)}`, [
                ["Demos", num(c.n)],
                ["Bought", ok ? pct(c.rate, 1) : "Too few to judge"],
                ["Vs average", ok ? signed(c.rate / Math.max(base, 0.001) - 1) : "n/a"],
              ], `Demo start time in IST. Cells under ${minN} demos are left blank.`) : undefined} />;
            })}
          </div>
        ))}
      </div>
      <div className="ci-heat-key"><span>{pct(lo)}</span><span className="ci-heat-ramp" style={{ background: `linear-gradient(90deg, ${RAMP[0]}, ${RAMP[RAMP.length - 1]})` }} /><span>{pct(hi)} bought</span><span className="ci-heat-blank" /> Under {minN} demos</div>
    </div>
  );
}

/** Two small charts side by side instead of one with two scales: demos per month, and the share that bought. */
export function Trend({ months }: { months: { month: string; demos: number; won: number; rate: number; virtualShare: number; mature: boolean; tracked: boolean }[] }) {
  const maxD = Math.max(...months.map((m) => m.demos)) || 1;
  const maxR = Math.max(...months.filter((m) => m.mature && m.tracked).map((m) => m.rate), 0.01);
  const name = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });
  const full = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  const all = months.map((m, i) => ({ x: Number((((i + 0.5) / months.length) * 100).toFixed(2)), y: Number((100 - (m.rate / (maxR * 1.2)) * 100).toFixed(2)), m }));
  const pts = all.filter((p) => p.m.tracked);
  const line = (list: typeof pts) => list.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  const settled = pts.filter((p) => p.m.mature);
  const young = pts.filter((p) => !p.m.mature);
  const peak = settled.reduce<(typeof pts)[number] | null>((b, p) => (!b || p.m.rate > b.m.rate ? p : b), null);
  const last = settled.at(-1);
  const labelled = new Set([peak?.m.month, last?.m.month]);
  const untracked = months.filter((m) => !m.tracked);
  const status = (m: (typeof months)[number]) => (!m.tracked ? "Not tracked (old imported demos)" : m.mature ? "Settled" : "Still deciding, will rise");
  const card = (m: (typeof months)[number]) => tip(full(m.month), [
    ["Demos", num(m.demos)],
    ["Sales", m.tracked ? num(m.won) : "Not tracked"],
    ["Share that bought", m.tracked ? pct(m.rate, 1) : "Not tracked"],
    ["By video", pct(m.virtualShare)],
    ["Status", status(m)],
  ], "Sales counted by the demo's month, not the order's month.");
  return (
    <div className="ci-trend">
      <figure>
        <figcaption>Demos a month</figcaption>
        <div className="ci-cols">
          {months.map((m) => (
            <div key={m.month} className={`ci-col ${!m.tracked ? "is-untracked" : m.mature ? "" : "is-young"}`} tabIndex={0} data-tip={card(m)}>
              <span className="ci-col-bar" style={{ height: w(m.demos / maxD) }} />
              <span className="ci-col-x">{name(m.month)}</span>
            </div>
          ))}
        </div>
      </figure>
      <figure>
        <figcaption>Share of demos that bought</figcaption>
        <div className="ci-line">
          {untracked.length ? <span className="ci-line-gap" style={{ width: w(untracked.length / months.length) }}><small>Not tracked</small></span> : null}
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <path d={line(settled)} className="ci-line-path" vectorEffect="non-scaling-stroke" />
            {young.length && settled.length ? <path d={line([settled.at(-1)!, ...young])} className="ci-line-path is-young" vectorEffect="non-scaling-stroke" /> : null}
          </svg>
          {pts.map((p) => (
            <span key={p.m.month} className={`ci-dot ${p.m.mature ? "" : "is-young"}`} style={{ left: `${p.x}%`, top: `${p.y}%` }} tabIndex={0} data-tip={card(p.m)}>
              {labelled.has(p.m.month) ? <b className="ci-dot-label">{pct(p.m.rate)}</b> : null}
            </span>
          ))}
          <div className="ci-line-x">{months.map((m) => <span key={m.month}>{name(m.month)}</span>)}</div>
        </div>
      </figure>
    </div>
  );
}

/** A small inline bar for a value around zero, used in the CDE table. */
export function SkillBar({ value, max }: { value: number; max: number }) {
  const half = w(Math.min(0.5, Math.abs(value) / (max || 1) / 2));
  return (
    <span className="ci-skill">
      <span className={`ci-skill-bar ${value >= 0 ? "is-up" : "is-down"}`} style={value >= 0 ? { left: "50%", width: half } : { right: "50%", width: half }} />
      <span className="ci-skill-mid" />
    </span>
  );
}

// ── Part-to-whole, flow and model charts ──────────────────────────────────────────────────────

/** Categorical slots in fixed order (reference palette); "Other" is always grey. */
export const CAT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#6250d6"];
const OTHER = "#c3c2b7";
const colourOf = (label: string, i: number) => (label === "Other" ? OTHER : CAT[i % CAT.length]);

function arc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p = (a: number) => [cx + r * Math.sin(a), cy - r * Math.cos(a)].map((v) => v.toFixed(3)).join(" ");
  return `M ${p(a0)} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)}`;
}

/** A ring with a legend that carries the numbers, so colour never has to. */
export function Donut({ slices, centre, sub, colours, note, unit = "demos" }: { slices: { label: string; n: number }[]; centre: string; sub: string; colours?: string[]; note?: string; unit?: string }) {
  const total = slices.reduce((s, x) => s + x.n, 0) || 1;
  const gap = slices.length > 1 ? 0.025 : 0;
  const starts = slices.map((_, i) => slices.slice(0, i).reduce((s, x) => s + (x.n / total) * Math.PI * 2, 0));
  const card = (s: { label: string; n: number }, i: number) => tip(s.label, [
    [unit.charAt(0).toUpperCase() + unit.slice(1), num(s.n)],
    ["Share", pct(s.n / total, 1)],
    ["Rank", `${i + 1} of ${slices.length}`],
    ["Total", num(total)],
  ], note);
  return (
    <div className="ci-donut">
      <svg viewBox="0 0 120 120" role="img" aria-label={slices.map((s) => `${s.label} ${pct(s.n / total)}`).join(", ")}>
        {slices.map((s, i) => {
          const a0 = starts[i];
          const end = Math.max(a0 + 0.001, a0 + (s.n / total) * Math.PI * 2 - gap);
          return <path key={s.label} d={arc(60, 60, 46, a0, end)} stroke={colours?.[i] ?? colourOf(s.label, i)} className="ci-donut-arc" tabIndex={0} data-tip={card(s, i)} />;
        })}
        <text x="60" y="58" className="ci-donut-c">{centre}</text>
        <text x="60" y="73" className="ci-donut-s">{sub}</text>
      </svg>
      <ul className="ci-legend">
        {slices.map((s, i) => (
          <li key={s.label} tabIndex={0} data-tip={card(s, i)}><i style={{ background: colours?.[i] ?? colourOf(s.label, i) }} /><span>{s.label}</span><b>{pct(s.n / total)}</b><small>{num(s.n)}</small></li>
        ))}
      </ul>
    </div>
  );
}

/** Today's sales, each improvement stacked on top, and where that lands. */
export function Waterfall({ start, steps, startLabel, endLabel, valueOf }: { start: number; steps: { label: string; title: string; detail: string; n: number; valueMinor: number | null }[]; startLabel: string; endLabel: string; valueOf: (sales: number) => string }) {
  const end = start + steps.reduce((s, x) => s + x.n, 0);
  const max = end * 1.08;
  const before = (i: number) => start + steps.slice(0, i).reduce((s, x) => s + x.n, 0);
  const cols = [
    { label: startLabel, lo: 0, hi: start, kind: "total", card: tip("Sales today", [["Sales", num(start)], ["Value", valueOf(start)]], "Judged demos that became a sale, from the CRM status or a matched EPIK order.") },
    ...steps.map((s, i) => ({ label: s.label, lo: before(i), hi: before(i) + s.n, kind: "step", card: tip(s.title, [["Extra sales", `+${num(s.n)}`], ["Value", inr(s.valueMinor)], ["Lift on today", signed(s.n / start, 1)], ["Running total", num(before(i) + s.n)]], s.detail) })),
    { label: endLabel, lo: 0, hi: end, kind: "total", card: tip("Possible with the same demos", [["Sales", num(end)], ["Extra", `+${num(end - start)}`], ["Lift", signed((end - start) / start, 1)], ["Value", valueOf(end)]], "Each change is counted cautiously; together they assume no overlap between them.") },
  ];
  return (
    <div className="ci-fall" role="img" aria-label={`${startLabel} ${num(start)}, ${endLabel} ${num(end)}`}>
      {cols.map((c, i) => (
        <div key={i} className={`ci-fall-col is-${c.kind}`} tabIndex={0} data-tip={c.card}>
          <div className="ci-fall-plot">
            <span className="ci-fall-bar" style={{ bottom: w(c.lo / max), height: w((c.hi - c.lo) / max) }}>
              <b>{c.kind === "step" ? `+${num(c.hi - c.lo)}` : num(c.hi)}</b>
            </span>
          </div>
          <span className="ci-fall-x">{c.label}</span>
        </div>
      ))}
    </div>
  );
}

/** A 0–max by 0–max plot frame with a light grid, tick labels and axis titles. Children draw in percent. */
export function Frame({ x, y, children, overlay, max = 1 }: { x: string; y: string; children: ReactNode; overlay?: ReactNode; max?: number }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div className="ci-frame">
      <span className="ci-frame-y">{y}</span>
      <div className="ci-frame-plot">
        {ticks.map((t) => <span key={`h${t}`} className="ci-frame-h" style={{ bottom: w(t) }}><small>{pct(t * max)}</small></span>)}
        {ticks.map((t) => <span key={`v${t}`} className="ci-frame-v" style={{ left: w(t) }}><small>{pct(t * max)}</small></span>)}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{children}</svg>
        {overlay}
      </div>
      <span className="ci-frame-x">{x}</span>
    </div>
  );
}

const pathOf = (pts: [number, number][]) => pts.map(([a, b], i) => `${i ? "L" : "M"}${(a * 100).toFixed(2)},${(100 - b * 100).toFixed(2)}`).join(" ");

export function Dot({ x, y, card }: { x: number; y: number; card: string }) {
  return <span className="ci-pt" style={{ left: w(x), bottom: w(y) }} tabIndex={0} data-tip={card} />;
}

/** ROC curves: how many buyers each model catches for each false alarm. The chosen model is coloured; the rest stay grey. */
export function RocChart({ curves, names, aucs, active }: { curves: { id: string; points: [number, number][] }[]; names: Record<string, string>; aucs: Record<string, number>; active: string }) {
  const on = curves.find((c) => c.id === active);
  return (
    <Frame x="False alarms: share of non-buyers flagged" y="Buyers caught" overlay={on?.points.filter((_, i) => i % 5 === 2).map(([a, b], i) => (
      <Dot key={i} x={a} y={b} card={tip(names[active], [["Non-buyers flagged", pct(a, 1)], ["Buyers caught", pct(b, 1)], ["Lift over random", `${(b / Math.max(a, 0.001)).toFixed(2)}×`], ["AUC", aucs[active].toFixed(3)]], "One point per cut-off on the test demos. A random guess sits on the dashed diagonal.")} />
    ))}>
      <path d="M0,100 L100,0" className="ci-ref" vectorEffect="non-scaling-stroke" />
      {curves.filter((c) => c.id !== active).map((c) => <path key={c.id} d={pathOf(c.points)} className="ci-curve is-muted" vectorEffect="non-scaling-stroke" />)}
      {on ? <path d={pathOf(on.points)} className="ci-curve" vectorEffect="non-scaling-stroke" /> : null}
    </Frame>
  );
}

/** Cumulative gains: call demos in score order; how many of all buyers have you reached? */
export function GainsChart({ gains, mark = 0.3 }: { gains: [number, number][]; mark?: number }) {
  const at = gains.reduce((b, p) => (Math.abs(p[0] - mark) < Math.abs(b[0] - mark) ? p : b), gains[0]);
  return (
    <Frame x="Share of demos, best scored first" y="Share of all buyers found" overlay={<>
      {gains.filter((_, i) => i % 4 === 2).map(([a, b], i) => <Dot key={i} x={a} y={b} card={tip(`Top ${pct(a)} of demos`, [["Buyers found", pct(b, 1)], ["Random calling would find", pct(a, 1)], ["Lift", `${(b / Math.max(a, 0.001)).toFixed(2)}×`]], "Test demos the model never saw, called in order of predicted chance.")} />)}
      <span className="ci-callout" style={{ left: w(at[0]), bottom: w(at[1]) }}><b>{pct(at[1])}</b> of buyers in the top {pct(at[0])}</span>
    </>}>
      <path d="M0,100 L100,0" className="ci-ref" vectorEffect="non-scaling-stroke" />
      <path d={`${pathOf(gains)} L100,100 L0,100 Z`} className="ci-area" />
      <path d={pathOf(gains)} className="ci-curve" vectorEffect="non-scaling-stroke" />
    </Frame>
  );
}

/** Calibration: when the model says 30%, do 30% buy? Points on the diagonal are honest probabilities. */
export function CalibrationChart({ bins }: { bins: { p: number; actual: number; n: number }[] }) {
  const max = Math.min(1, Math.max(0.5, ...bins.map((b) => Math.max(b.p, b.actual))) * 1.1);
  const s = (v: number) => v / max;
  return (
    <Frame max={max} x="Predicted chance" y="Actually bought" overlay={bins.map((b, i) => <Dot key={i} x={s(b.p)} y={s(b.actual)} card={tip(`Tenth ${i + 1} by predicted chance`, [["Predicted", pct(b.p, 1)], ["Actually bought", pct(b.actual, 1)], ["Gap", `${((b.actual - b.p) * 100).toFixed(1)} points`], ["Demos", num(b.n)]], "On the dashed line, the model's chances are honest.")} />)}>
      <path d="M0,100 L100,0" className="ci-ref" vectorEffect="non-scaling-stroke" />
      <path d={pathOf(bins.map((b) => [s(b.p), s(b.actual)]))} className="ci-curve is-thin" vectorEffect="non-scaling-stroke" />
    </Frame>
  );
}

/** Each CDE: expected close rate (from their mix) against actual. Above the line beats the mix. */
export function ConsultantScatter({ people }: { people: Consultant[] }) {
  const max = Math.min(1, Math.max(...people.map((p) => Math.max(p.won / p.demos, p.expected / p.demos))) * 1.12);
  const s = (v: number) => v / max;
  const big = Math.max(...people.map((p) => p.demos));
  return (
    <div className="ci-scatter">
      <Frame max={max} x="Expected close rate, from their products, hubs and slots" y="Actual close rate" overlay={people.map((p) => {
        const actual = p.won / p.demos;
        const exp = p.expected / p.demos;
        const size = 6 + 14 * Math.sqrt(p.demos / big);
        return <span key={p.name} className={`ci-bubble ${actual >= exp ? "is-up" : "is-down"}`} style={{ left: w(s(exp)), bottom: w(s(actual)), width: size, height: size }} tabIndex={0} data-tip={consultantCard(p)} />;
      })}>
        <path d="M0,100 L100,0" className="ci-ref" vectorEffect="non-scaling-stroke" />
      </Frame>
      <div className="ci-scatter-key"><span><i className="is-up" /> Beats their mix</span><span><i className="is-down" /> Below their mix</span><span>Bigger dot = more demos</span></div>
    </div>
  );
}

export function consultantCard(c: Consultant): string {
  return tip(c.name, [
    ["Demos", num(c.demos)],
    ["Sales", num(c.won)],
    ["Close rate", pct(c.rate, 1)],
    ["Expected from their mix", pct(c.expected / c.demos, 1)],
    ["Skill (points per demo)", `${c.skill >= 0 ? "+" : "−"}${Math.abs(c.skill * 100).toFixed(1)}`],
    ["Fair rate (small samples shrunk)", pct(c.fair, 1)],
    ["Customer rating", c.rating ? `${c.rating.toFixed(1)} of 5` : "Not enough ratings"],
    ["Average demo", c.avgDemoMin ? `${Math.round(c.avgDemoMin)} min` : "Not logged"],
    ["Mostly demos", c.topCategory],
  ], "Expected = what an average CDE would close with the same products, brands, hubs, sources, days and time slots (logistic regression). Skill is shrunk toward zero for small samples.");
}

/** Steps the data went through, each bar against the first. */
export function Funnel({ steps }: { steps: { label: string; n: number; note: string }[] }) {
  const top = steps[0]?.n || 1;
  return (
    <ol className="ci-funnel">
      {steps.map((s, i) => (
        <li key={s.label} tabIndex={0} data-tip={tip(s.label, [
          ["Rows", num(s.n)],
          ["Share of the sheet", pct(s.n / top, 1)],
          ["Dropped at this step", i ? num(steps[i - 1].n - s.n) : "0"],
          ["Kept from the step before", i ? pct(s.n / steps[i - 1].n, 1) : "100%"],
        ], s.note)}>
          <span className="ci-funnel-label"><b>{s.label}</b><small>{s.note}</small></span>
          <span className="ci-funnel-track"><span style={{ width: w(s.n / top) }} /></span>
          <span className="ci-funnel-n"><b>{num(s.n)}</b><small>{pct(s.n / top)}</small></span>
        </li>
      ))}
    </ol>
  );
}

/** "X of Y" bars: how complete each field is. */
export function Coverage({ rows }: { rows: { label: string; n: number; of: number; note: string }[] }) {
  return (
    <div className="ci-cover">
      {rows.map((r) => (
        <div key={r.label} className="ci-cover-row" tabIndex={0} data-tip={tip(r.label, [["Filled", `${num(r.n)} of ${num(r.of)}`], ["Complete", pct(r.n / r.of, 1)], ["Missing", num(r.of - r.n)]], r.note)}>
          <span className="ci-cover-label">{r.label}</span>
          <span className="ci-cover-track"><span style={{ width: w(r.n / r.of) }} /></span>
          <span className="ci-cover-n"><b>{pct(r.n / r.of)}</b><small>{num(r.n)} of {num(r.of)}</small></span>
        </div>
      ))}
    </div>
  );
}

/** A half-ring score out of 100. */
export function Gauge({ value, label, card }: { value: number; label: string; card: string }) {
  const a = -Math.PI / 2 + (Math.PI * Math.max(0, Math.min(100, value))) / 100;
  return (
    <div className="ci-gauge" role="img" aria-label={`${label}: ${value} out of 100`} tabIndex={0} data-tip={card}>
      <svg viewBox="0 0 120 70">
        <path d={arc(60, 62, 48, -Math.PI / 2, Math.PI / 2)} className="ci-gauge-bg" />
        <path d={arc(60, 62, 48, -Math.PI / 2, a)} className="ci-gauge-fg" />
      </svg>
      <b>{value}<small>/100</small></b>
      <span>{label}</span>
    </div>
  );
}

/** Confusion matrix in plain words. */
export function Confusion({ c }: { c: { tp: number; fp: number; fn: number; tn: number } }) {
  const total = c.tp + c.fp + c.fn + c.tn || 1;
  const max = Math.max(c.tp, c.fp, c.fn, c.tn) || 1;
  const cell = (n: number, title: string, sub: string, good: boolean, meaning: string) => (
    <div className={`ci-cm-cell ${good ? "is-good" : "is-bad"}`} style={{ ["--a" as string]: (0.1 + 0.32 * (n / max)).toFixed(2) }} tabIndex={0} data-tip={tip(`${title} (${sub})`, [
      ["Demos", num(n)],
      ["Share of test demos", pct(n / total, 1)],
      ["Precision", pct(c.tp / Math.max(1, c.tp + c.fp), 1)],
      ["Recall", pct(c.tp / Math.max(1, c.tp + c.fn), 1)],
    ], meaning)}>
      <b>{num(n)}</b><span>{title}</span><small>{sub}</small>
    </div>
  );
  return (
    <div className="ci-cm">
      <span />
      <span className="ci-cm-h">Model says: will buy</span>
      <span className="ci-cm-h">Model says: won&apos;t</span>
      <span className="ci-cm-r">Bought</span>
      {cell(c.tp, "Caught", "true positive", true, "Buyers the model flagged. These are the calls worth making first.")}
      {cell(c.fn, "Missed", "false negative", false, "Buyers the model scored low. Never drop a lead on the score alone.")}
      <span className="ci-cm-r">Didn&apos;t buy</span>
      {cell(c.fp, "False alarm", "false positive", false, "Flagged, but did not buy. The cost is one extra follow-up call.")}
      {cell(c.tn, "Rightly skipped", "true negative", true, "Scored low and did not buy.")}
    </div>
  );
}

/** One bar per model for a 0–1 score, with the spread across folds as a whisker. */
export function ScoreBars({ rows, best }: { rows: { id: string; name: string; value: number; sd?: number; card: string }[]; best: string }) {
  const max = Math.max(...rows.map((r) => r.value + (r.sd ?? 0))) * 1.08 || 1;
  return (
    <div className="ci-score">
      {rows.map((r) => (
        <div key={r.id} className={`ci-score-row ${r.id === best ? "is-best" : ""} ${r.id === "base" || r.id === "aiflag" ? "is-ref" : ""}`} tabIndex={0} data-tip={r.card}>
          <span className="ci-score-label">{r.name}</span>
          <span className="ci-score-track">
            <span className="ci-score-bar" style={{ width: w(r.value / max) }} />
            {r.sd != null ? <span className="ci-score-sd" style={{ left: w((r.value - r.sd) / max), width: w((2 * r.sd) / max) }} /> : null}
          </span>
          <b>{r.value.toFixed(2)}</b>
        </div>
      ))}
    </div>
  );
}

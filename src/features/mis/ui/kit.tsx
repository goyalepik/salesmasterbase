"use client";

import { createContext, useCallback, useContext, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { X } from "lucide-react";
import { deltaNumber } from "./format";

/** What a click on any number, bar or row opens: the numbers behind it, how it is worked out and where it comes from. */
export type Detail = {
  kicker?: string;
  title: string;
  value?: string;
  delta?: { mom: string | null; better?: "up" | "down" };
  rows?: [string, string][];
  table?: { head: string[]; rows: string[][] };
  note?: string;
  method?: string;
  source: string;
  sample?: string;
};

type Tip = { x: number; y: number; detail: Detail };
type Ctx = { open: (d: Detail) => void; tip: (t: Tip | null) => void };

const MisContext = createContext<Ctx>({ open: () => {}, tip: () => {} });

export function MisProvider({ children }: { children: ReactNode }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const open = useCallback((d: Detail) => {
    setTip(null);
    setDetail(d);
  }, []);
  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDetail(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail]);

  return (
    <MisContext.Provider value={{ open, tip: setTip }}>
      {children}
      {tip ? <Tooltip tip={tip} /> : null}
      {detail ? <Drawer detail={detail} onClose={() => setDetail(null)} /> : null}
    </MisContext.Provider>
  );
}

export function useMis() {
  return useContext(MisContext);
}

function Tooltip({ tip }: { tip: Tip }) {
  const { detail } = tip;
  const left = typeof window !== "undefined" && tip.x > window.innerWidth - 280 ? tip.x - 272 : tip.x + 14;
  const top = typeof window !== "undefined" && tip.y > window.innerHeight - 160 ? tip.y - 120 : tip.y + 14;
  return (
    <div className="mis-tip" style={{ left, top }} role="status">
      <b>{detail.title}</b>
      {detail.value ? <span className="mis-tip-value">{detail.value}</span> : null}
      {(detail.rows ?? []).slice(0, 3).map(([k, v]) => (
        <span key={k} className="mis-tip-row"><i>{k}</i>{v}</span>
      ))}
      <span className="mis-tip-hint">Click for the numbers behind it</span>
    </div>
  );
}

function Drawer({ detail, onClose }: { detail: Detail; onClose: () => void }) {
  return (
    <div className="mis-drawer-wrap" onClick={onClose}>
      <aside className="mis-drawer" role="dialog" aria-modal="true" aria-label={detail.title} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="mis-drawer-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        {detail.kicker ? <p className="mis-kicker">{detail.kicker}</p> : null}
        <h2>{detail.title}</h2>
        {detail.value ? (
          <p className="mis-drawer-value">
            {detail.value}
            {detail.delta ? <Delta mom={detail.delta.mom} better={detail.delta.better} /> : null}
          </p>
        ) : null}
        {detail.note ? <p className="mis-drawer-note">{detail.note}</p> : null}
        {detail.rows?.length ? (
          <dl className="mis-drawer-rows">
            {detail.rows.map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        ) : null}
        {detail.table ? (
          <div className="mis-drawer-table">
            <table>
              <thead><tr>{detail.table.head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
              <tbody>{detail.table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
        ) : null}
        <div className="mis-drawer-foot">
          {detail.method ? <p><b>How it is worked out</b>{detail.method}</p> : null}
          {detail.sample ? <p><b>Based on</b>{detail.sample}</p> : null}
          <p><b>Source</b>{detail.source}</p>
        </div>
      </aside>
    </div>
  );
}

/** Anything clickable on the page: shows a tooltip on hover and opens the detail card on click. */
export function Mark({ detail, className, style, children, label }: { detail: Detail; className?: string; style?: CSSProperties; children?: ReactNode; label?: string }) {
  const { open, tip } = useMis();
  return (
    <button
      type="button"
      className={className}
      style={style}
      aria-label={label ?? `${detail.title}${detail.value ? `: ${detail.value}` : ""}`}
      onMouseMove={(e) => tip({ x: e.clientX, y: e.clientY, detail })}
      onMouseLeave={() => tip(null)}
      onBlur={() => tip(null)}
      onFocus={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        tip({ x: r.left + r.width / 2, y: r.bottom, detail });
      }}
      onClick={() => open(detail)}
    >
      {children}
    </button>
  );
}

/** "+4.5%" in green when that direction is good, red when it is bad. */
export function Delta({ mom, better = "up", vs, isNew }: { mom: string | null | undefined; better?: "up" | "down"; vs?: string; isNew?: boolean }) {
  const n = deltaNumber(mom);
  if (isNew) return <span className="mis-delta is-new">New</span>;
  if (n == null) return <span className="mis-delta is-flat">{vs ? `New vs ${vs}` : "No change"}</span>;
  const good = n === 0 ? null : (n > 0) === (better === "up");
  return (
    <span className={`mis-delta ${good == null ? "is-flat" : good ? "is-good" : "is-bad"}`}>
      {n > 0 ? "▲" : n < 0 ? "▼" : ""} {mom!.replace(/^[+-]/, "")}
      {vs ? <i> vs {vs}</i> : null}
    </span>
  );
}

export function Panel({ title, sub, className, children, aside }: { title: string; sub?: string; className?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className={`mis-panel ${className ?? ""}`}>
      <header className="mis-panel-head">
        <div>
          <h3>{title}</h3>
          {sub ? <p>{sub}</p> : null}
        </div>
        {aside}
      </header>
      <div className="mis-panel-body">{children}</div>
    </section>
  );
}

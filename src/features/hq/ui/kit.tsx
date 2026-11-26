import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { delta } from "./fmt";

export function Head({ title, sub, href, pill }: { title: string; sub?: ReactNode; href?: string; pill?: ReactNode }) {
  return (
    <div className="hq-head">
      <div><h3>{title}</h3>{sub ? <p>{sub}</p> : null}</div>
      {pill ?? (href ? <Link href={href} className="hq-circle" style={{ width: 34, height: 34, background: "var(--soft)" }} aria-label={`Open ${title}`}><ArrowUpRight size={16} /></Link> : null)}
    </div>
  );
}

export function Chip({ now, before, invert }: { now: number | null; before: number | null; invert?: boolean }) {
  const d = delta(now, before, invert);
  return d ? <span className={`hq-chip ${d.cls}`}>{d.text}</span> : null;
}

/** A headline number tile for the top row; the whole tile opens the tab that explains it. */
export function Kpi({ label, value, chip, sub, tone, href, children }: { label: string; value: string; chip?: ReactNode; sub?: ReactNode; tone?: "dark" | "coral"; href?: string; children?: ReactNode }) {
  const cls = `hq-kpi${tone === "dark" ? " is-dark" : tone === "coral" ? " is-coral" : ""}`;
  const body = (
    <>
      <span className="hq-kpi-top"><span className="hq-label">{label}</span>{chip}</span>
      <span className="hq-kpi-v">{value}</span>
      {sub ? <span className="hq-label hq-kpi-sub">{sub}</span> : null}
      {children}
    </>
  );
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

export function Stat({ label, value, chip, sub, tone }: { label: string; value: string; chip?: ReactNode; sub?: ReactNode; tone?: "dark" | "coral" }) {
  return (
    <div className={`hq-card${tone === "dark" ? " is-dark" : tone === "coral" ? " is-coral" : ""}`} style={{ display: "grid", gap: 10 }}>
      <span className="hq-label">{label}</span>
      <div className="hq-row"><span className="hq-big">{value}</span>{chip}</div>
      {sub ? <span className="hq-label">{sub}</span> : null}
    </div>
  );
}

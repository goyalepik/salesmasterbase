import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { change } from "./format";

/** A headline number with its change chip and a corner link, like the reference design. */
export function Kpi({ label, icon, value, chip, sub, href }: { label: string; icon?: ReactNode; value: string; chip?: { now: number; before: number; invert?: boolean } | null; sub?: ReactNode; href?: string }) {
  const c = chip ? change(chip.now, chip.before) : null;
  const tone = c ? (c.tone === "flat" ? "is-flat" : (c.tone === "up") !== !!chip?.invert ? "is-up" : "is-down") : "";
  return (
    <div className="ims-card ims-kpi">
      <div className="ims-card-head" style={{ marginBottom: 0 }}>
        <span className="ims-kpi-label">{icon}{label}</span>
        {href ? <Link href={href} className="ims-corner" aria-label={`Open ${label}`}><ArrowUpRight size={15} /></Link> : null}
      </div>
      <div className="ims-kpi-value">
        {value}
        {c ? <span className={`ims-chip ${tone}`}>{c.tone === "up" ? "▲" : c.tone === "down" ? "▼" : ""} {c.text}</span> : null}
      </div>
      {sub ? <div className="ims-kpi-sub">{sub}</div> : null}
    </div>
  );
}

export function CardHead({ title, sub, href }: { title: string; sub?: ReactNode; href?: string }) {
  return (
    <div className="ims-card-head">
      <div>
        <h2>{title}</h2>
        {sub ? <p>{sub}</p> : null}
      </div>
      {href ? <Link href={href} className="ims-corner" aria-label={`Open ${title}`}><ArrowUpRight size={15} /></Link> : null}
    </div>
  );
}

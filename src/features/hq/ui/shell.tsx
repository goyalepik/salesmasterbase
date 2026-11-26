import Link from "next/link";
import { Settings2 } from "lucide-react";
import { EpikLogo } from "@/features/brand/epik-logo";
import type { Dashboard } from "../domain/metrics";
import { AskButton } from "./ask";
import { day, minsAgo } from "./fmt";

export const HQ_TABS = [
  { id: "overview", href: "/hq", label: "Overview" },
  { id: "economics", href: "/hq/economics", label: "Unit economics" },
  { id: "marketing", href: "/hq/marketing", label: "Marketing" },
  { id: "team", href: "/hq/team", label: "Team" },
  { id: "customers", href: "/hq/customers", label: "Customers" },
  { id: "delivery", href: "/hq/delivery", label: "Delivery" },
] as const;
export type HqTab = (typeof HQ_TABS)[number]["id"] | "admin";

/**
 * One header for every tab: logo, tabs, Ask, Sources; then one thin bar with the period switch and how fresh the data is.
 * Everything else on the page fits under it on one laptop screen.
 */
export function HqShell({ current, d, at, stale, children }: { current: HqTab; d?: Dashboard; at?: number; stale?: boolean; children: React.ReactNode }) {
  const r = d?.range.id ?? "mtd";
  const q = r !== "mtd" ? `?r=${r}` : "";
  const path = HQ_TABS.find((t) => t.id === current)?.href ?? "/hq";
  const mins = at ? minsAgo(at) : null;
  return (
    <div className="hq">
      <div className={`hq-wrap${d && current !== "admin" ? " is-fit" : ""}`}>
        <header className="hq-top">
          <Link href={`/hq${q}`} className="hq-logo" aria-label="EPIK HQ">
            <span className="hq-logo-mark"><EpikLogo height={15} className="text-[#16140f]" /></span>
            <strong>HQ</strong>
          </Link>
          <nav className="hq-nav" aria-label="HQ">
            {HQ_TABS.map((t) => <Link key={t.id} href={`${t.href}${q}`} aria-current={current === t.id ? "page" : undefined}>{t.label}</Link>)}
          </nav>
          <div className="hq-right">
            <AskButton range={r} />
            <Link href="/hq/admin" className="hq-circle" aria-label="Sources and checks" title="Sources and checks"><Settings2 size={17} /></Link>
          </div>
        </header>
        {d ? (
          <div className="hq-bar-row">
            <nav className="hq-ranges" aria-label="Period">
              {d.ranges.map((x) => <Link key={x.id} href={`${path}${x.id === "mtd" ? "" : `?r=${x.id}`}`} aria-current={x.id === d.range.id ? "page" : undefined}>{x.label}</Link>)}
            </nav>
            <span className={`hq-live${stale ? " is-stale" : ""}`}>
              <i />{stale ? "Last good read" : "Live"}{mins != null ? ` · ${mins ? `${mins} min ago` : "just now"}` : ""}
              <span className="hq-dim"> · {day(d.range.from)} to {day(d.range.to)} · sales to {day(d.lastSaleDay)} · Meta to {day(d.lastAdDay)}</span>
            </span>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}

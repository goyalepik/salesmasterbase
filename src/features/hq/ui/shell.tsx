import Link from "next/link";
import { Settings2 } from "lucide-react";
import { EpikLogo } from "@/features/brand/epik-logo";
import type { Range } from "../domain/metrics";
import { minsAgo, todayParts } from "./fmt";

export const HQ_TABS = [
  { id: "overview", href: "/hq", label: "Overview" },
  { id: "economics", href: "/hq/economics", label: "Unit economics" },
  { id: "marketing", href: "/hq/marketing", label: "Marketing" },
  { id: "team", href: "/hq/team", label: "Team" },
  { id: "customers", href: "/hq/customers", label: "Customers" },
  { id: "delivery", href: "/hq/delivery", label: "Delivery" },
] as const;
export type HqTab = (typeof HQ_TABS)[number]["id"] | "admin";

export function HqShell({ current, range, children }: { current: HqTab; range?: Range; children: React.ReactNode }) {
  const q = range && range.id !== "mtd" ? `?r=${range.id}` : "";
  return (
    <div className="hq">
      <div className="hq-wrap">
        <header className="hq-top">
          <Link href={`/hq${q}`} className="hq-logo" aria-label="EPIK HQ">
            <span className="hq-logo-mark"><EpikLogo height={18} className="text-[#16140f]" /></span>
            <span><strong>HQ</strong><small>Sales and money, live</small></span>
          </Link>
          <nav className="hq-nav" aria-label="HQ">
            {HQ_TABS.map((t) => <Link key={t.id} href={`${t.href}${q}`} aria-current={current === t.id ? "page" : undefined}>{t.label}</Link>)}
          </nav>
          <div className="hq-right">
            <Link href="/hq/admin" className="hq-circle" aria-label="Sources and checks" title="Sources and checks"><Settings2 size={18} /></Link>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}

/** Date block + period pills + live dot. */
export function Period({ range, ranges, path, at, stale, lastSale, lastAd }: { range: Range; ranges: Range[]; path: string; at: number; stale: boolean; lastSale: string | null; lastAd: string | null }) {
  const t = todayParts();
  const mins = minsAgo(at);
  return (
    <div className="hq-when">
      <span className="hq-day">{t.day}</span>
      <span className="hq-when-text"><strong>{t.weekday}, {t.month}</strong><span className={`hq-live${stale ? " is-stale" : ""}`}><i />{stale ? "Last good read" : "Live"} · {mins ? `${mins} min ago` : "just now"}</span></span>
      <nav className="hq-ranges" aria-label="Period" style={{ width: "100%" }}>
        {ranges.map((r) => <Link key={r.id} href={`${path}${r.id === "mtd" ? "" : `?r=${r.id}`}`} aria-current={r.id === range.id ? "page" : undefined}>{r.label}</Link>)}
      </nav>
      <span className="hq-note" style={{ width: "100%" }}>Sales to {lastSale ? new Date(`${lastSale}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }) : "—"} · Meta spend to {lastAd ? new Date(`${lastAd}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }) : "—"}</span>
    </div>
  );
}

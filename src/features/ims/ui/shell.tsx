import Link from "next/link";
import { Boxes, Settings2 } from "lucide-react";
import type { ImsRole } from "../role";
import { AskPanel } from "./ask-panel";
import { RangePicker } from "./range-picker";
import { RoleSwitch } from "./role-switch";

export const TABS = [
  { id: "overview", href: "/ims", label: "Overview" },
  { id: "stock", href: "/ims/stock", label: "Stock" },
  { id: "in", href: "/ims/stock-in", label: "Stock in" },
  { id: "out", href: "/ims/dispatch", label: "Dispatch" },
  { id: "incoming", href: "/ims/incoming", label: "Incoming" },
  { id: "finance", href: "/ims/finance", label: "Finance" },
] as const;
export type TabId = (typeof TABS)[number]["id"] | "admin";

const ago = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

/** The IMS frame: brand, the parts, live dot, range, Ask, role switch and (admin) settings. */
export function ImsShell({ current, role, readAt, stale, range, children }: { current: TabId; role: ImsRole; readAt: number | null; stale?: boolean; range?: string; children: React.ReactNode }) {
  return (
    <div className="ims">
      <header className="ims-top">
        <div className="ims-top-in">
          <Link href="/ims" className="ims-brand" aria-label="Inventory home">
            <span className="ims-brand-mark"><Boxes size={16} /></span>
            <span className="ims-hide-sm">EPIK Inventory</span>
          </Link>
          <nav className="ims-nav" aria-label="Inventory">
            {TABS.map((t) => (
              <Link key={t.id} href={t.href} aria-current={current === t.id ? "page" : undefined}>{t.label}</Link>
            ))}
          </nav>
          <div className="ims-top-right">
            {readAt ? (
              <span className={`ims-fresh${stale ? " is-stale" : ""}`} title="Read from the team sheets every 2 minutes">
                <i aria-hidden="true" /><span>{stale ? "Last read " : "Live · "}{ago(readAt)}</span>
              </span>
            ) : null}
            {range !== undefined ? <RangePicker value={range} /> : null}
            <AskPanel />
            <RoleSwitch role={role} />
            {role === "admin" ? (
              <Link href="/ims/admin" className="ims-icon-btn" aria-label="Admin" aria-current={current === "admin" ? "page" : undefined} title="Sources, categories, data checks"><Settings2 size={17} /></Link>
            ) : null}
          </div>
        </div>
      </header>
      <main className="ims-main">{children}</main>
    </div>
  );
}

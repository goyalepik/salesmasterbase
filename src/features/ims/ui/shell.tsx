import Link from "next/link";
import { Boxes, Settings2 } from "lucide-react";
import type { ImsRole } from "../role";
import { RoleSwitch } from "./role-switch";

const TABS = [
  { id: "overview", href: "/ims", label: "Overview" },
  { id: "stock", href: "/ims/stock", label: "Stock" },
  { id: "incoming", href: "/ims/incoming", label: "Incoming" },
] as const;

const ago = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

/** The IMS frame: brand, the three parts, freshness, Sources (admin) and the Viewer/Admin switch. */
export function ImsShell({ current, role, readAt, stale, children }: { current: (typeof TABS)[number]["id"] | "sources"; role: ImsRole; readAt: number | null; stale?: boolean; children: React.ReactNode }) {
  return (
    <div className="ims">
      <header className="ims-top">
        <div className="ims-top-in">
          <Link href="/ims" className="ims-brand" aria-label="Inventory home">
            <span className="ims-brand-mark"><Boxes size={16} /></span>
            <span>Inventory</span>
          </Link>
          <nav className="ims-nav" aria-label="Inventory">
            {TABS.map((t) => (
              <Link key={t.id} href={t.href} aria-current={current === t.id ? "page" : undefined}>{t.label}</Link>
            ))}
          </nav>
          <div className="ims-top-right">
            {readAt ? (
              <span className={`ims-fresh${stale ? " is-stale" : ""}`} title="Read live from the team sheets every 2 minutes">
                <i aria-hidden="true" />
                <span>{stale ? "Last good read " : "Live · "}{ago(readAt)}</span>
              </span>
            ) : null}
            {role === "admin" ? (
              <Link href="/ims/sources" className="ims-icon-btn" aria-label="Sources" aria-current={current === "sources" ? "page" : undefined} title="Sources and how it works">
                <Settings2 size={18} />
              </Link>
            ) : null}
            <RoleSwitch role={role} />
          </div>
        </div>
      </header>
      <main className="ims-main">{children}</main>
    </div>
  );
}

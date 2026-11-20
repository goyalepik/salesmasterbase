import Link from "next/link";
import { Search } from "lucide-react";

const TABS = [
  { id: "home", href: "/wms", label: "Warehouse" },
  { id: "receive", href: "/wms/receive", label: "Receive" },
  { id: "dispatch", href: "/wms/dispatch", label: "Dispatch" },
  { id: "returns", href: "/wms/returns", label: "Returns" },
  { id: "po", href: "/wms/po", label: "Purchase orders" },
  { id: "stock", href: "/wms/stock", label: "Stock" },
  { id: "counts", href: "/wms/counts", label: "Counts" },
  { id: "reorder", href: "/wms/reorder", label: "Reorder" },
  { id: "dashboard", href: "/wms/dashboard", label: "Dashboard" },
  { id: "day", href: "/wms/movements", label: "Day report" },
  { id: "lists", href: "/wms/lists", label: "Lists" },
  { id: "switch", href: "/wms/switch", label: "Switch-over" },
] as const;

/** The warehouse tabs and the one search box (serial, IMEI, PO, GRN, order, product). Scanning into it works too. */
export function WmsNav({ current, q = "" }: { current: (typeof TABS)[number]["id"] | null; q?: string }) {
  return (
    <div className="wms-nav">
      <nav className="s-chips" aria-label="Warehouse">
        {TABS.map((t) => (
          <Link key={t.id} href={t.href} aria-current={current === t.id ? "page" : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>
      <form action="/wms/search" className="wms-search" role="search">
        <Search size={16} aria-hidden="true" />
        <label className="sr-only" htmlFor="wms-q">Find a serial, PO, GRN, order or product</label>
        <input id="wms-q" name="q" defaultValue={q} placeholder="Scan or type a serial, PO, GRN, order or product" autoComplete="off" enterKeyHint="search" />
      </form>
    </div>
  );
}

/** Shown when the warehouse screens are switched off (live site before the cut-over). */
export function WmsOff() {
  return (
    <section className="dashboard-panel">
      <h1 className="dashboard-panel-title">The warehouse screens aren&apos;t switched on yet</h1>
      <p className="dashboard-panel-subtitle mt-1">Stock still comes from the team sheet. Use the Inventory view for now.</p>
      <Link href="/inventory" className="glow-button mt-4 inline-flex h-11 items-center rounded-[14px] px-4 text-[14px] font-medium text-white">Open the Inventory view</Link>
    </section>
  );
}

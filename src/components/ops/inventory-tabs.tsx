import { Suspense } from "react";
import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import type { OpsStore } from "@/lib/ops/store";

export type InventoryTab = "home" | "new" | "incoming" | "stock" | "pos" | "activity" | "view";

const TABS: Array<{ id: InventoryTab; href: string; label: string }> = [
  { id: "home", href: "/inventory", label: "Home" },
  { id: "new", href: "/inventory/orders", label: "New orders" },
  { id: "incoming", href: "/inventory/incoming", label: "Incoming" },
  { id: "stock", href: "/inventory/stock", label: "Stock" },
  { id: "pos", href: "/procurement", label: "Purchase orders" },
  { id: "activity", href: "/inventory/activity", label: "Today's activity" },
];

/** The Inventory steps in order, each with how many are waiting: New orders, Incoming, plus Stock and POs. */
export function InventoryTabs({ store, current }: { store: OpsStore; current: InventoryTab }) {
  return (
    <Suspense fallback={<Tabs current={current} counts={{}} />}>
      <TabsWithCounts store={store} current={current} />
    </Suspense>
  );
}

async function TabsWithCounts({ store, current }: { store: OpsStore; current: InventoryTab }) {
  const [fresh, waiting, pos] = await Promise.all([
    store.listOrders({ stage: "awaiting_inventory", limit: 1 }),
    store.listOrders({ stage: "awaiting_stock", limit: 1 }),
    store.listPurchaseOrders({ status: "open" }),
  ]);
  return <Tabs current={current} counts={{ new: fresh.total, incoming: waiting.total, pos: new Set(pos.map((p) => p.poNumber)).size }} />;
}

function Tabs({ current, counts }: { current: InventoryTab; counts: Partial<Record<InventoryTab, number>> }) {
  return (
    <div className="inv-tabs-row">
      <nav className="inv-tabs" aria-label="Inventory">
        {TABS.map((tab) => (
          <Link key={tab.id} href={tab.href} aria-current={current === tab.id ? "page" : undefined}>
            {tab.label}
            {counts[tab.id] != null ? <span className={tab.id === "new" && counts.new ? "is-hot" : undefined}>{counts[tab.id]}</span> : null}
          </Link>
        ))}
      </nav>
      <Link href="/inventory/view" className="inv-view-btn" aria-current={current === "view" ? "page" : undefined}>
        <LayoutGrid size={15} /> Inventory view
      </Link>
    </div>
  );
}

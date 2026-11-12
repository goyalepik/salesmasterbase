import { Suspense, cache } from "react";
import Link from "next/link";
import { after } from "next/server";
import { Activity, LayoutGrid, ListChecks, PackagePlus, ShoppingCart } from "lucide-react";
import { AssistantScreen } from "@/components/assistant-screen";
import { BlockedState } from "@/components/blocked-state";
import { assistantStatus } from "@/lib/ai/runtime";
import { isoDateInIst } from "@/lib/format";
import type { OpsStore } from "@/lib/ops/store";
import { actorName, DEFAULT_ACTOR } from "@/lib/ops-ui/actor";
import { loadOps } from "@/lib/ops-ui/load";
import { loadQueue } from "@/lib/ops-ui/queue-load";
import { syncShopify } from "@/lib/shopify/run";
import { pullTeamSheet } from "@/lib/sheets/run";

const ASK = ["What should I reorder this week?", "Which paid orders are short of stock?", "Which POs are late?"];

/** Inventory home: a greeting, one line on what needs doing, a chat, and the five places to go. Nothing repeated. */
export default async function InventoryHome() {
  const [ops, name] = await Promise.all([loadOps(), actorName()]);
  if (ops.kind !== "ready") return <BlockedState health={ops.workspace.health} />;
  after(() => syncShopify(ops.store));
  after(() => pullTeamSheet(ops.store));
  const first = name !== DEFAULT_ACTOR ? name.split(" ")[0] : null;
  return (
    <section className="hh">
      <div className="hh-center">
        <h1 className="hh-greet">
          <span className="hh-spark" aria-hidden="true">✳</span>
          {greetingWord()}{first ? `, ${first}` : ""}
        </h1>
        <Suspense fallback={<p className="hh-line">&nbsp;</p>}>
          <Line store={ops.store} />
        </Suspense>
        <div className="hh-chat">
          <AssistantScreen initialQuestion="" status={assistantStatus()} compact hero placeholder="How can I help with stock today?" suggestions={ASK} />
        </div>
        <Suspense fallback={<Places counts={null} />}>
          <PlacesWithCounts store={ops.store} />
        </Suspense>
      </div>
    </section>
  );
}

function greetingWord(): string {
  const hour = Number(new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", hourCycle: "h23" }).format(new Date()));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

type Counts = { orders: number; ready: number; waiting: number; latePos: number };

const loadCounts = cache(async (store: OpsStore): Promise<Counts> => {
  const [queue, waiting, pos] = await Promise.all([
    loadQueue(store),
    store.listOrders({ stage: "awaiting_stock", limit: 1 }),
    store.listPurchaseOrders({ status: "open" }),
  ]);
  const today = isoDateInIst(new Date());
  return {
    orders: queue.length,
    ready: queue.filter((q) => q.group === "ready").length,
    waiting: waiting.total,
    latePos: new Set(pos.filter((p) => p.eta && p.eta < today).map((p) => p.poNumber)).size,
  };
});

/** The one sentence: what is waiting, in plain words. */
async function Line({ store }: { store: OpsStore }) {
  const c = await loadCounts(store);
  const parts = [
    c.orders ? `${c.orders} new order${c.orders === 1 ? "" : "s"} to decide${c.ready ? `, ${c.ready} ready to allocate` : ""}` : "No new orders waiting",
    c.latePos ? `${c.latePos} PO${c.latePos === 1 ? " is" : "s are"} late` : "",
  ].filter(Boolean);
  return <p className="hh-line">{parts.join(" · ")}.</p>;
}

async function PlacesWithCounts({ store }: { store: OpsStore }) {
  return <Places counts={await loadCounts(store)} />;
}

function Places({ counts }: { counts: Counts | null }) {
  const badge = (n: number | undefined, tone?: "hot" | "bad") => (n ? <span className={`hh-badge ${tone ? `is-${tone}` : ""}`}>{n}</span> : null);
  return (
    <nav className="hh-places" aria-label="Inventory">
      <Link href="/inventory/orders" className="hh-place">
        <ListChecks size={18} />
        <span>New orders</span>
        {badge(counts?.orders, "hot")}
      </Link>
      <Link href="/inventory/incoming" className="hh-place">
        <PackagePlus size={18} />
        <span>Incoming</span>
        {badge(counts?.waiting)}
      </Link>
      <Link href="/procurement" className="hh-place">
        <ShoppingCart size={18} />
        <span>Purchase orders</span>
        {badge(counts?.latePos, "bad")}
      </Link>
      <Link href="/inventory/activity" className="hh-place">
        <Activity size={18} />
        <span>Today&apos;s activity</span>
      </Link>
      <Link href="/inventory/view" className="hh-place">
        <LayoutGrid size={18} />
        <span>Inventory view</span>
      </Link>
    </nav>
  );
}

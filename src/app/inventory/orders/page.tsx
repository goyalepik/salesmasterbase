import { Suspense } from "react";
import Link from "next/link";
import { after } from "next/server";
import { BlockedState } from "@/components/blocked-state";
import { FoldPanel } from "@/components/ops/bits";
import { AllocateReadyButton, QueueOrderCard, type QueueOrderView } from "@/components/ops/inventory-queue";
import { InventoryTabs } from "@/components/ops/inventory-tabs";
import { MapSkuOnly } from "@/components/ops/order-actions";
import { SectionSkeleton } from "@/components/ops/overview";
import { PageHeader } from "@/components/ui";
import type { OpsStore } from "@/lib/ops/store";
import type { OrderSummary } from "@/lib/ops/types";
import { age, ageHours, inr, requestNow } from "@/lib/ops-ui/format";
import { orderCity, orderSource, type QueueGroup } from "@/lib/ops-ui/inventory-queue";
import { loadQueue, payChip } from "@/lib/ops-ui/queue-load";
import { loadOps } from "@/lib/ops-ui/load";
import { firstParam } from "@/lib/query";
import { syncShopify } from "@/lib/shopify/run";
import { pullTeamSheet } from "@/lib/sheets/run";

const SHOW = ["all", "ready", "call", "sku"] as const;
type Show = (typeof SHOW)[number];
const SHOW_LABELS: Record<Show, string> = { all: "All", ready: "Ready to allocate", call: "Needs a call", sku: "No SKU" };

/** Old sheet orders often carry the channel ("Shopify Direct") in the POC field: show it as the source, not a person. */
function whoAndWhere(order: OrderSummary): { source: string; city: string | null; poc: string | null } {
  const channel = /shopify|website|online|direct|amazon|flipkart|sagepilot|walk-?in/i;
  let source = orderSource(order);
  let poc = order.poc && order.poc !== order.saleSource && order.createdBy !== "Shopify" ? order.poc : null;
  if (poc && channel.test(poc)) {
    if (source === "Old sheet") source = poc;
    poc = null;
  }
  return { source, city: orderCity(order), poc };
}

export default async function NewOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [ops, params] = await Promise.all([loadOps(), searchParams]);
  if (ops.kind !== "ready") return <BlockedState health={ops.workspace.health} />;
  // Website orders come in through RevOps; a visit here also checks Shopify (at most once every 5 minutes).
  after(() => syncShopify(ops.store));
  // New stock and dispatches typed in the team sheet (at most once every 5 minutes).
  after(() => pullTeamSheet(ops.store));
  const raw = firstParam(params.show);
  const show: Show = (SHOW as readonly string[]).includes(raw) ? (raw as Show) : "all";
  return (
    <section>
      <Suspense fallback={<PageHeader title="New orders" description="Orders RevOps has cleared, oldest first." />}>
        <Header store={ops.store} />
      </Suspense>
      <InventoryTabs store={ops.store} current="new" />
      <Suspense key={show} fallback={<SectionSkeleton height={520} />}>
        <Queue store={ops.store} show={show} />
      </Suspense>
    </section>
  );
}


async function Header({ store }: { store: OpsStore }) {
  const queue = await loadQueue(store);
  const ready = queue.filter((q) => q.group === "ready").length;
  return (
    <PageHeader
      title="New orders"
      description="Paid or cleared by RevOps, oldest first. For each product: Allocate, Backorder, Procure, Drop-ship or Reject."
      action={<AllocateReadyButton count={ready} />}
    />
  );
}


async function Queue({ store, show }: { store: OpsStore; show: Show }) {
  const [queue, early] = await Promise.all([loadQueue(store), store.listOrders({ stage: "awaiting_payment", limit: 200 })]);
  const now = requestNow();
  const counts = Object.fromEntries(SHOW.map((s) => [s, s === "all" ? queue.length : queue.filter((q) => q.group === s).length])) as Record<Show, number>;
  const shown = show === "all" ? queue : queue.filter((q) => q.group === (show as QueueGroup));
  const unmapped = early.items.flatMap((o) => o.lines.filter((l) => !l.sku && l.status === "pending").map((line) => ({ order: o, line })));
  const earlyValue = early.items.reduce((sum, o) => sum + o.offeredTotalMinor, 0);

  return (
    <>
      <nav className="inv-chips" aria-label="Filter new orders">
        {SHOW.map((s) => (
          <Link key={s} href={s === "all" ? "/inventory/orders" : `/inventory/orders?show=${s}`} aria-current={show === s ? "page" : undefined} scroll={false}>
            {SHOW_LABELS[s]} <span>{counts[s]}</span>
          </Link>
        ))}
      </nav>
      {!shown.length ? (
        <div className="inv-empty">{queue.length ? "Nothing in this filter." : "All clear. Orders land here as soon as RevOps verifies the payment."}</div>
      ) : (
        <div className="iq-list">
          {shown.map(({ order, lines, group, allocatable }) => {
            const days = ageHours(order.createdAt, now) / 24;
            const view: QueueOrderView = {
              id: order.id,
              customer: order.customerName,
              ...whoAndWhere(order),
              pay: payChip(order),
              age: age(order.createdAt, now),
              ageTone: days > 7 ? "is-old" : days > 2 ? "is-late" : "",
              group,
              allocatable,
              pendingCount: lines.filter((l) => l.line.status === "pending").length,
            };
            return <QueueOrderCard key={order.id} order={view} lines={lines} />;
          })}
        </div>
      )}
      <div className="mt-4">
        <FoldPanel
          title={`Coming from RevOps (${early.total})`}
          subtitle={`${early.total} order${early.total === 1 ? "" : "s"} in Payment review, ${inr(earlyValue)} offered.${unmapped.length ? ` ${unmapped.length} product${unmapped.length === 1 ? " has" : "s have"} no SKU: map now so the call is quick later.` : " They land here once verified."}`}
        >
          {unmapped.length ? (
            <div className="grid gap-2.5 lg:grid-cols-2">
              {unmapped.map(({ order, line }) => (
                <div key={line.id} className="min-w-0">
                  <p className="mb-1 px-1 text-[12px] text-muted">
                    <Link href={`/orders/${encodeURIComponent(order.id)}`} className="text-info">{order.id}</Link> · {order.customerName}
                  </p>
                  <MapSkuOnly line={line} />
                </div>
              ))}
            </div>
          ) : (
            <ul className="grid gap-1 text-[13px]">
              {early.items.slice(0, 12).map((o) => (
                <li key={o.id} className="flex min-w-0 gap-2">
                  <Link href={`/orders/${encodeURIComponent(o.id)}`} className="shrink-0 text-info">{o.id}</Link>
                  <span className="min-w-0 truncate text-muted">{o.customerName} · {o.lines.map((l) => l.productName).join(", ")}</span>
                </li>
              ))}
            </ul>
          )}
        </FoldPanel>
      </div>
    </>
  );
}

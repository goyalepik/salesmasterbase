import { Suspense } from "react";
import Link from "next/link";
import { BlockedState } from "@/components/blocked-state";
import { FoldPanel } from "@/components/ops/bits";
import { DecisionCard } from "@/components/ops/decision-card";
import { MapSkuOnly } from "@/components/ops/order-actions";
import { SectionSkeleton } from "@/components/ops/overview";
import { PageHeader } from "@/components/ui";
import type { OpsStore } from "@/lib/ops/store";
import type { PurchaseOrder, StockLevel } from "@/lib/ops/types";
import { age, ageHours, requestNow } from "@/lib/ops-ui/format";
import { loadOps } from "@/lib/ops-ui/load";
import { suggestFor, type Suggestion } from "@/lib/ops-ui/suggest";
import { firstParam } from "@/lib/query";

const SHOW = ["all", "reserve", "po", "procure", "sku"] as const;
type Show = (typeof SHOW)[number];
const SHOW_LABELS: Record<Show, string> = { all: "All", reserve: "Can reserve", po: "PO on the way", procure: "No stock", sku: "No SKU" };

export default async function DecisionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [ops, params] = await Promise.all([loadOps(), searchParams]);
  if (ops.kind !== "ready") return <BlockedState health={ops.workspace.health} />;
  const raw = firstParam(params.show);
  const show: Show = (SHOW as readonly string[]).includes(raw) ? (raw as Show) : "all";
  return (
    <section>
      <PageHeader title="Decisions" description="Every paid order waiting for stock, oldest first. Press the lit button, or More for other choices." />
      <Suspense key={show} fallback={<SectionSkeleton height={520} />}>
        <Decisions store={ops.store} show={show} />
      </Suspense>
    </section>
  );
}

async function Decisions({ store, show }: { store: OpsStore; show: Show }) {
  const [waiting, early] = await Promise.all([
    store.listOrders({ stage: "awaiting_inventory", limit: 100 }),
    store.listOrders({ stage: "awaiting_payment", limit: 200 }),
  ]);
  const orders = [...waiting.items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const lines = orders.flatMap((o) => o.lines.filter((l) => l.status === "pending" || l.status === "rejected").map((line) => ({ order: o, line })));
  const unmapped = early.items.flatMap((o) => o.lines.filter((l) => !l.sku && l.status === "pending").map((line) => ({ order: o, line })));
  const skus = [...new Set(lines.map((p) => p.line.sku).filter((s): s is string => !!s))];
  const [levels, poLists] = await Promise.all([
    Promise.all(skus.map((sku) => store.stockFor(sku))),
    Promise.all(skus.map((sku) => store.listPurchaseOrders({ status: "open", sku }))),
  ]);
  const stock: Record<string, StockLevel | null> = Object.fromEntries(skus.map((s, i) => [s, levels[i]]));
  const pos: Record<string, PurchaseOrder[]> = Object.fromEntries(skus.map((s, i) => [s, poLists[i]]));
  const now = requestNow();

  const cards = lines.map(({ order, line }) => {
    const level = line.sku ? stock[line.sku] ?? null : null;
    const open = line.sku ? pos[line.sku] ?? [] : [];
    return { order, line, level, open, suggestion: suggestFor(line, level, open) };
  });
  const counts = Object.fromEntries(SHOW.map((s) => [s, s === "all" ? cards.length : cards.filter((c) => c.suggestion === s).length])) as Record<Show, number>;
  const shown = show === "all" ? cards : cards.filter((c) => c.suggestion === (show as Suggestion));

  return (
    <>
      <nav className="inv-chips" aria-label="Filter decisions">
        {SHOW.map((s) => (
          <Link key={s} href={s === "all" ? "/inventory/decisions" : `/inventory/decisions?show=${s}`} aria-current={show === s ? "page" : undefined} scroll={false}>
            {SHOW_LABELS[s]} <span>{counts[s]}</span>
          </Link>
        ))}
      </nav>
      {!shown.length ? (
        <div className="inv-empty">{cards.length ? "Nothing in this filter." : "All clear. Orders land here after RevOps verifies the payment."}</div>
      ) : (
        <div className="dcard-grid">
          {shown.map(({ order, line, level, open }) => (
            <DecisionCard
              key={line.id}
              line={line}
              stock={level}
              pos={open}
              order={{ id: order.id, customer: order.customerName, hub: order.hub, age: age(order.createdAt, now), days: ageHours(order.createdAt, now) / 24 }}
            />
          ))}
        </div>
      )}
      {unmapped.length ? (
        <div className="mt-4">
          <FoldPanel title={`Map early (${unmapped.length})`} subtitle="Not paid yet, but typed as free text. Map the SKU now so the decision is quick later.">
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
          </FoldPanel>
        </div>
      ) : null}
    </>
  );
}

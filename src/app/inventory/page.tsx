import { Suspense } from "react";
import Link from "next/link";
import { BlockedState } from "@/components/blocked-state";
import { Kpi, Panel, TableWrap, inputClass } from "@/components/ops/bits";
import { LineDecisionBlock, MapSkuOnly } from "@/components/ops/order-actions";
import { SectionSkeleton } from "@/components/ops/overview";
import { EmptyState, PageHeader, Pager } from "@/components/ui";
import type { OpsStore, StockFilter } from "@/lib/ops/store";
import type { PurchaseOrder, StockLevel } from "@/lib/ops/types";
import { age, inr, inrCompact, requestNow, shortDate } from "@/lib/ops-ui/format";
import { metricsFor } from "@/lib/ops-ui/cached";
import { loadOps } from "@/lib/ops-ui/load";
import { firstParam, parsePage } from "@/lib/query";

const STOCK_PAGE = 50;
const ONLY = ["all", "available", "out", "reserved", "incoming"] as const;
const ONLY_LABELS: Record<(typeof ONLY)[number], string> = { all: "All", available: "In stock", out: "Out of stock", reserved: "Reserved", incoming: "Incoming" };

type StockQuery = { q: string; only: (typeof ONLY)[number]; page: number };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [ops, params] = await Promise.all([loadOps(), searchParams]);
  if (ops.kind !== "ready") return <BlockedState health={ops.workspace.health} />;
  const onlyRaw = firstParam(params.only);
  const query: StockQuery = {
    q: firstParam(params.q).replace(/\s+/g, " ").trim().slice(0, 60),
    only: (ONLY as readonly string[]).includes(onlyRaw) ? (onlyRaw as StockQuery["only"]) : "all",
    page: parsePage(firstParam(params.page)),
  };
  return (
    <section>
      <PageHeader title="Inventory" description="Decide stock for each product: reserve from stock, hold on an incoming PO, procure, brand direct, or reject." />
      <Suspense fallback={<SectionSkeleton height={300} />}>
        <Decisions store={ops.store} />
      </Suspense>
      <Suspense key={JSON.stringify(query)} fallback={<SectionSkeleton height={500} />}>
        <StockTable store={ops.store} query={query} />
      </Suspense>
    </section>
  );
}

async function Decisions({ store }: { store: OpsStore }) {
  const [waiting, early] = await Promise.all([
    store.listOrders({ stage: "awaiting_inventory", limit: 100 }),
    store.listOrders({ stage: "awaiting_payment", limit: 200 }),
  ]);
  const orders = [...waiting.items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const pending = orders.flatMap((o) => o.lines.filter((l) => l.status === "pending" || l.status === "rejected").map((line) => ({ order: o, line })));
  const unmapped = early.items.flatMap((o) => o.lines.filter((l) => !l.sku && l.status === "pending").map((line) => ({ order: o, line })));
  const skus = [...new Set(pending.map((p) => p.line.sku).filter((s): s is string => !!s))];
  const [levels, poLists] = await Promise.all([
    Promise.all(skus.map((sku) => store.stockFor(sku))),
    Promise.all(skus.map((sku) => store.listPurchaseOrders({ status: "open", sku }))),
  ]);
  const stock: Record<string, StockLevel | null> = Object.fromEntries(skus.map((s, i) => [s, levels[i]]));
  const pos: Record<string, PurchaseOrder[]> = Object.fromEntries(skus.map((s, i) => [s, poLists[i]]));
  const now = requestNow();

  return (
    <>
      <Panel className="mb-2.5" title={`Decisions needed (${pending.length})`} subtitle="Paid orders waiting for a stock decision. Oldest first.">
        {!pending.length ? (
          <p className="text-[13px] text-muted">Nothing waiting. Orders arrive here after RevOps verifies the payment.</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {pending.map(({ order, line }) => (
              <div key={line.id} className="min-w-0">
                <p className="mb-1 px-1 text-[12px] text-muted">
                  <Link href={`/orders/${encodeURIComponent(order.id)}`} className="text-info">{order.id}</Link> · {order.customerName} · {order.hub ?? "No hub"} · {age(order.createdAt, now)} old
                </p>
                <LineDecisionBlock line={line} stock={line.sku ? stock[line.sku] ?? null : null} pos={line.sku ? pos[line.sku] ?? [] : []} />
              </div>
            ))}
          </div>
        )}
      </Panel>
      {unmapped.length ? (
        <Panel className="mb-2.5" title={`No SKU yet (${unmapped.length})`} subtitle="Typed as free text by sales. Map them now so the decision is quick once paid.">
          <div className="grid gap-3 lg:grid-cols-2">
            {unmapped.map(({ order, line }) => (
              <div key={line.id} className="min-w-0">
                <p className="mb-1 px-1 text-[12px] text-muted">
                  <Link href={`/orders/${encodeURIComponent(order.id)}`} className="text-info">{order.id}</Link> · {order.customerName}
                </p>
                <MapSkuOnly line={line} />
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </>
  );
}

function stockHref(query: StockQuery, patch: Partial<StockQuery>): string {
  const next = { ...query, ...patch, page: patch.page ?? 1 };
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.only !== "all") params.set("only", next.only);
  if (next.page > 1) params.set("page", String(next.page));
  const text = params.toString();
  return `/inventory${text ? `?${text}` : ""}#stock`;
}

async function StockTable({ store, query }: { store: OpsStore; query: StockQuery }) {
  const filter: StockFilter = { q: query.q || undefined, only: query.only, limit: 5000 };
  const [rows, metrics] = await Promise.all([store.stockLevels(filter), metricsFor(store)]);
  const page = rows.slice((query.page - 1) * STOCK_PAGE, query.page * STOCK_PAGE);
  return (
    <Panel title="Stock" subtitle="Live: on hand minus reserved is free to sell." className="scroll-mt-4">
      <div id="stock" className="scroll-mt-4" />
      <dl className="ops-grid-4">
        <Kpi label="Units on hand" value={metrics.stock.units.toLocaleString("en-IN")} note={`${metrics.stock.skus} SKUs`} />
        <Kpi label="Value at cost" value={inrCompact(metrics.stock.valueMinor)} />
        <Kpi label="Reserved" value={metrics.stock.reserved} />
        <Kpi label="Incoming" value={metrics.stock.incoming} />
      </dl>
      <form action="/inventory#stock" className="mb-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_200px_auto]">
        <label className="sr-only" htmlFor="stock-q">Search stock</label>
        <input id="stock-q" name="q" defaultValue={query.q} placeholder="SKU, product or brand" className={inputClass} />
        <label className="sr-only" htmlFor="stock-only">Show</label>
        <select id="stock-only" name="only" defaultValue={query.only} className={inputClass}>
          {ONLY.map((o) => <option key={o} value={o}>{ONLY_LABELS[o]}</option>)}
        </select>
        <button type="submit" className="glow-button h-11 rounded-[14px] px-4 text-[14px] font-medium text-white">Search</button>
      </form>
      <nav className="stage-tabs" aria-label="Stock filter">
        {ONLY.map((o) => (
          <Link key={o} href={stockHref(query, { only: o })} aria-current={query.only === o ? "page" : undefined}>{ONLY_LABELS[o]}</Link>
        ))}
      </nav>
      {!rows.length ? (
        <EmptyState title="No stock rows match" detail="Try a shorter search or the All filter." />
      ) : (
        <>
          <TableWrap minWidth={940}>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product</th>
                <th>Brand</th>
                <th className="num">On hand</th>
                <th className="num">Reserved</th>
                <th className="num">Free</th>
                <th className="num">Incoming</th>
                <th>Next ETA</th>
                <th className="num">Unit cost</th>
                <th className="num">Value at cost</th>
              </tr>
            </thead>
            <tbody>
              {page.map((row) => (
                <tr key={row.sku}>
                  <td className="whitespace-nowrap text-[12px] text-muted">{row.sku}</td>
                  <td className="max-w-[280px]"><span className="block truncate">{row.name}</span></td>
                  <td className="whitespace-nowrap text-muted">{row.brand ?? "—"}</td>
                  <td className="num">{row.onHand}</td>
                  <td className="num">{row.reserved || <span className="text-faint">0</span>}</td>
                  <td className={`num font-medium ${row.available > 0 ? "text-good" : "text-bad"}`}>{row.available}</td>
                  <td className="num">{row.incoming || <span className="text-faint">0</span>}</td>
                  <td className="whitespace-nowrap">{row.nextEta ? shortDate(row.nextEta) : "—"}</td>
                  <td className="num">{inr(row.unitCostMinor)}</td>
                  <td className="num">{row.unitCostMinor != null ? inr(row.unitCostMinor * Math.max(0, row.onHand)) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <Pager path="/inventory" page={query.page} pageSize={STOCK_PAGE} total={rows.length} preserve={{ q: query.q, only: query.only === "all" ? "" : query.only }} />
        </>
      )}
    </Panel>
  );
}

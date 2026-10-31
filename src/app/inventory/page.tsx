import { Suspense } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { BlockedState } from "@/components/blocked-state";
import { DownloadButton, FoldPanel } from "@/components/ops/bits";
import { DecisionCard } from "@/components/ops/decision-card";
import { StockInDialog } from "@/components/ops/stock-forms";
import { MapSkuOnly } from "@/components/ops/order-actions";
import { SectionSkeleton } from "@/components/ops/overview";
import { PageHeader, Pager } from "@/components/ui";
import type { OpsStore, StockFilter } from "@/lib/ops/store";
import type { PurchaseOrder, StockLevel } from "@/lib/ops/types";
import { age, ageHours, inr, inrCompact, requestNow, shortDate } from "@/lib/ops-ui/format";
import { metricsFor } from "@/lib/ops-ui/cached";
import { loadOps } from "@/lib/ops-ui/load";
import { suggestFor, type Suggestion } from "@/lib/ops-ui/suggest";
import { firstParam, parsePage } from "@/lib/query";

const STOCK_PAGE = 40;
const ONLY = ["all", "available", "out", "reserved", "incoming"] as const;
const ONLY_LABELS: Record<(typeof ONLY)[number], string> = { all: "All", available: "In stock", out: "Out", reserved: "Reserved", incoming: "Incoming" };
const SHOW = ["all", "reserve", "po", "procure", "sku"] as const;
const SHOW_LABELS: Record<(typeof SHOW)[number], string> = { all: "All", reserve: "Can reserve", po: "PO on the way", procure: "No stock", sku: "No SKU" };

type Query = { q: string; only: (typeof ONLY)[number]; page: number; show: (typeof SHOW)[number] };

function pick<T extends string>(list: readonly T[], raw: string, fallback: T): T {
  return (list as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

function href(query: Query, patch: Partial<Query>): string {
  const next = { ...query, ...patch };
  if (!("page" in patch)) next.page = 1;
  const params = new URLSearchParams();
  if (next.show !== "all") params.set("show", next.show);
  if (next.q) params.set("q", next.q);
  if (next.only !== "all") params.set("only", next.only);
  if (next.page > 1) params.set("page", String(next.page));
  const text = params.toString();
  return `/inventory${text ? `?${text}` : ""}`;
}

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [ops, params] = await Promise.all([loadOps(), searchParams]);
  if (ops.kind !== "ready") return <BlockedState health={ops.workspace.health} />;
  const query: Query = {
    q: firstParam(params.q).replace(/\s+/g, " ").trim().slice(0, 60),
    only: pick(ONLY, firstParam(params.only), "all"),
    page: parsePage(firstParam(params.page)),
    show: pick(SHOW, firstParam(params.show), "all"),
  };
  return (
    <section>
      <PageHeader
        title="Inventory"
        description="Decide stock for every paid order. The stock list stays live beside you."
        action={
          <div className="flex shrink-0 gap-2">
            <StockInDialog />
            <DownloadButton kind="stock" label="Download" />
          </div>
        }
      />
      <Suspense fallback={<SectionSkeleton height={84} />}>
        <StockStrip store={ops.store} />
      </Suspense>
      <div className="inv-layout">
        <div className="min-w-0">
          <Suspense key={query.show} fallback={<SectionSkeleton height={520} />}>
            <Decisions store={ops.store} query={query} />
          </Suspense>
        </div>
        <aside className="inv-aside" aria-label="Stock">
          <Suspense key={`${query.q}|${query.only}|${query.page}`} fallback={<SectionSkeleton height={520} />}>
            <StockList store={ops.store} query={query} />
          </Suspense>
        </aside>
      </div>
    </section>
  );
}

async function StockStrip({ store }: { store: OpsStore }) {
  const { stock } = await metricsFor(store);
  const cells = [
    { label: "On hand", value: stock.units.toLocaleString("en-IN"), note: `${stock.skus} SKUs` },
    { label: "Free to sell", value: Math.max(0, stock.units - stock.reserved).toLocaleString("en-IN"), tone: "good" },
    { label: "Reserved", value: stock.reserved.toLocaleString("en-IN"), note: "Promised to orders" },
    { label: "Incoming", value: stock.incoming.toLocaleString("en-IN"), note: "On open POs", tone: "info" },
    { label: "Value at cost", value: inrCompact(stock.valueMinor) },
  ];
  return (
    <dl className="inv-strip">
      {cells.map((cell) => (
        <div key={cell.label}>
          <dt>{cell.label}</dt>
          <dd className={cell.tone ? `is-${cell.tone}` : undefined}>{cell.value}</dd>
          {cell.note ? <p>{cell.note}</p> : null}
        </div>
      ))}
    </dl>
  );
}

async function Decisions({ store, query }: { store: OpsStore; query: Query }) {
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
  const counts = Object.fromEntries(SHOW.map((s) => [s, s === "all" ? cards.length : cards.filter((c) => c.suggestion === s).length])) as Record<(typeof SHOW)[number], number>;
  const shown = query.show === "all" ? cards : cards.filter((c) => c.suggestion === (query.show as Suggestion));

  return (
    <>
      <div className="inv-head">
        <div>
          <h2>Decisions <span>{cards.length}</span></h2>
          <p>Paid orders waiting for stock. Oldest first. The lit button is the suggested move.</p>
        </div>
      </div>
      <nav className="inv-chips" aria-label="Filter decisions">
        {SHOW.map((s) => (
          <Link key={s} href={href(query, { show: s })} aria-current={query.show === s ? "page" : undefined} scroll={false}>
            {SHOW_LABELS[s]} <span>{counts[s]}</span>
          </Link>
        ))}
      </nav>
      {!shown.length ? (
        <div className="inv-empty">
          {cards.length ? "Nothing in this filter." : "All clear. Orders land here after RevOps verifies the payment."}
        </div>
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
        <div className="mt-3">
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

async function StockList({ store, query }: { store: OpsStore; query: Query }) {
  const filter: StockFilter = { q: query.q || undefined, only: query.only, limit: 5000 };
  const rows = await store.stockLevels(filter);
  const page = rows.slice((query.page - 1) * STOCK_PAGE, query.page * STOCK_PAGE);
  return (
    <div className="inv-stock">
      <div className="inv-stock-head">
        <h2>Stock <span className="live-dot" aria-hidden="true" /></h2>
        <p>{rows.length.toLocaleString("en-IN")} {rows.length === 1 ? "product" : "products"}</p>
      </div>
      <form action="/inventory" className="inv-search">
        {query.show !== "all" ? <input type="hidden" name="show" value={query.show} /> : null}
        {query.only !== "all" ? <input type="hidden" name="only" value={query.only} /> : null}
        <Search size={15} aria-hidden="true" />
        <label className="sr-only" htmlFor="stock-q">Search stock</label>
        <input id="stock-q" name="q" defaultValue={query.q} placeholder="Search SKU, product, brand" />
      </form>
      <nav className="inv-chips is-small" aria-label="Stock filter">
        {ONLY.map((o) => (
          <Link key={o} href={href(query, { only: o })} aria-current={query.only === o ? "page" : undefined} scroll={false}>{ONLY_LABELS[o]}</Link>
        ))}
      </nav>
      {!page.length ? (
        <p className="inv-empty">No products match.</p>
      ) : (
        <ul className="inv-rows">
          {page.map((row) => (
            <li key={row.sku} title={`${row.name}\n${row.sku}${row.unitCostMinor != null ? `\nCost ${inr(row.unitCostMinor)} each` : ""}`}>
              <span className="min-w-0 flex-1">
                <span className="inv-row-name">{row.name}</span>
                <span className="inv-row-sub">
                  {row.sku}
                  {row.reserved ? <em> · {row.reserved} reserved</em> : null}
                  {row.incoming ? <em className="is-info"> · +{row.incoming}{row.nextEta ? ` ${shortDate(row.nextEta)}` : ""}</em> : null}
                </span>
              </span>
              <span className={`inv-free ${row.available > 0 ? "is-good" : "is-bad"}`}>
                {row.available}
                <small>of {row.onHand}</small>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Pager path="/inventory" page={query.page} pageSize={STOCK_PAGE} total={rows.length} preserve={{ show: query.show === "all" ? "" : query.show, q: query.q, only: query.only === "all" ? "" : query.only }} />
    </div>
  );
}

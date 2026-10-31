import { Suspense } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardCheck, Info, PackageCheck, Search, ShoppingCart, Sparkles } from "lucide-react";
import { AssistantScreen } from "@/components/assistant-screen";
import { BlockedState } from "@/components/blocked-state";
import { DownloadButton, Panel } from "@/components/ops/bits";
import { StockInDialog } from "@/components/ops/stock-forms";
import { SectionSkeleton } from "@/components/ops/overview";
import { PageHeader, Pager } from "@/components/ui";
import { assistantStatus } from "@/lib/ai/runtime";
import { isoDateInIst } from "@/lib/format";
import type { OpsStore, StockFilter } from "@/lib/ops/store";
import { inr, inrCompact, shortDate } from "@/lib/ops-ui/format";
import { inventoryInsights, type Insight } from "@/lib/ops-ui/inventory-insights";
import { metricsFor } from "@/lib/ops-ui/cached";
import { loadOps } from "@/lib/ops-ui/load";
import { suggestFor } from "@/lib/ops-ui/suggest";
import { firstParam, parsePage } from "@/lib/query";

const STOCK_PAGE = 25;
const ONLY = ["all", "available", "out", "reserved", "incoming"] as const;
const ONLY_LABELS: Record<(typeof ONLY)[number], string> = { all: "All", available: "In stock", out: "Out of stock", reserved: "Reserved", incoming: "Incoming" };
const ASK = [
  "Which products are short for paid orders?",
  "What stock has not sold in 30 days?",
  "Which POs are late?",
  "How many Dreame robots are free?",
];

type Query = { q: string; only: (typeof ONLY)[number]; page: number };

function stockHref(query: Query, patch: Partial<Query>): string {
  const next = { ...query, ...patch };
  if (!("page" in patch)) next.page = 1;
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.only !== "all") params.set("only", next.only);
  if (next.page > 1) params.set("page", String(next.page));
  const text = params.toString();
  return `/inventory${text ? `?${text}` : ""}#stock`;
}

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [ops, params] = await Promise.all([loadOps(), searchParams]);
  if (ops.kind !== "ready") return <BlockedState health={ops.workspace.health} />;
  const onlyRaw = firstParam(params.only);
  const query: Query = {
    q: firstParam(params.q).replace(/\s+/g, " ").trim().slice(0, 60),
    only: (ONLY as readonly string[]).includes(onlyRaw) ? (onlyRaw as Query["only"]) : "all",
    page: parsePage(firstParam(params.page)),
  };
  return (
    <section>
      <PageHeader
        title="Inventory"
        description="Your stock at a glance, what needs doing today, and an assistant that knows the numbers."
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
      <div className="inv-dash">
        <Suspense fallback={<SectionSkeleton height={460} />}>
          <TodayAndInsights store={ops.store} />
        </Suspense>
        <Panel
          className="inv-ask"
          title={<span className="inline-flex items-center gap-2"><Sparkles size={16} className="text-[var(--space)]" /> Ask about stock</span>}
          subtitle="Answers come from live stock, orders and POs."
        >
          <div className="inv-chat">
            <AssistantScreen initialQuestion="" status={assistantStatus()} compact suggestions={ASK} intro="Ask in plain words. For example, which products to reorder this week." />
          </div>
        </Panel>
      </div>
      <Suspense key={JSON.stringify(query)} fallback={<SectionSkeleton height={600} />}>
        <StockTable store={ops.store} query={query} />
      </Suspense>
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

const INSIGHT_ICON = { bad: AlertTriangle, warn: AlertTriangle, info: Info, good: CheckCircle2 } as const;

async function TodayAndInsights({ store }: { store: OpsStore }) {
  const now = new Date();
  const todayIso = isoDateInIst(now);
  const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [stock, deciding, stocking, recent, pos, procurement] = await Promise.all([
    store.stockLevels({ limit: 5000 }),
    store.listOrders({ stage: "awaiting_inventory", limit: 200 }),
    store.listOrders({ stage: "awaiting_stock", limit: 200 }),
    store.listOrders({ stage: "all", from, limit: 1000 }),
    store.listPurchaseOrders({ status: "open" }),
    store.listProcurement({ status: "open" }),
  ]);
  const bySku = new Map(stock.map((row) => [row.sku, row]));
  const lines = deciding.items.flatMap((o) => o.lines.filter((l) => l.status === "pending" || l.status === "rejected"));
  const canReserve = lines.filter((l) => suggestFor(l, l.sku ? bySku.get(l.sku) ?? null : null, pos.filter((p) => p.sku === l.sku)) === "reserve").length;
  const lateProc = procurement.filter((p) => p.eta && p.eta < todayIso).length;
  const insights: Insight[] = inventoryInsights({ stock, waiting: [...deciding.items, ...stocking.items], recent: recent.items, pos, procurement, todayIso });

  const tiles = [
    { label: "Decisions waiting", value: lines.length, note: "Paid orders need a stock call", href: "/inventory/decisions", icon: ClipboardCheck, tone: lines.length ? "warn" : "good" },
    { label: "Ready to reserve", value: canReserve, note: "Stock is there. One tap each.", href: "/inventory/decisions?show=reserve", icon: PackageCheck, tone: canReserve ? "good" : "muted" },
    { label: "Being bought", value: procurement.length, note: lateProc ? `${lateProc} past the expected date` : "For customers, on Procurement", href: "/procurement", icon: ShoppingCart, tone: lateProc ? "bad" : "muted" },
  ];

  return (
    <div className="grid min-w-0 content-start gap-3">
      <div className="inv-tiles">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <Link key={tile.label} href={tile.href} className={`inv-tile is-${tile.tone}`}>
              <span className="inv-tile-icon"><Icon size={17} /></span>
              <span className="inv-tile-value">{tile.value}</span>
              <span className="inv-tile-label">{tile.label}</span>
              <span className="inv-tile-note">{tile.note}</span>
              <ArrowRight size={14} className="inv-tile-go" />
            </Link>
          );
        })}
      </div>
      <Panel title={<span className="inline-flex items-center gap-2"><Sparkles size={16} className="text-[var(--space)]" /> Stock analysis</span>} subtitle="Checked automatically on every visit. Worst first.">
        <ul className="insights">
          {insights.map((item) => {
            const Icon = INSIGHT_ICON[item.tone];
            const body = (
              <>
                <span className="insight-icon"><Icon size={15} /></span>
                <span className="min-w-0 flex-1">
                  <span className="insight-title">{item.title}</span>
                  <span className="insight-detail">{item.detail}</span>
                </span>
                {item.href ? <ArrowRight size={14} className="mt-1 shrink-0 text-faint" /> : null}
              </>
            );
            return (
              <li key={item.title} className={`is-${item.tone}`}>
                {item.href ? <Link href={item.href}>{body}</Link> : <div>{body}</div>}
              </li>
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}

async function StockTable({ store, query }: { store: OpsStore; query: Query }) {
  const filter: StockFilter = { q: query.q || undefined, only: query.only, limit: 5000 };
  const rows = await store.stockLevels(filter);
  const page = rows.slice((query.page - 1) * STOCK_PAGE, query.page * STOCK_PAGE);
  return (
    <Panel className="mt-3 scroll-mt-24" title="Stock" subtitle={`${rows.length.toLocaleString("en-IN")} ${rows.length === 1 ? "product" : "products"} · free = on hand minus reserved`}>
      <div id="stock" className="scroll-mt-24" />
      <div className="inv-table-tools">
        <form action="/inventory#stock" className="inv-search">
          {query.only !== "all" ? <input type="hidden" name="only" value={query.only} /> : null}
          <Search size={15} aria-hidden="true" />
          <label className="sr-only" htmlFor="stock-q">Search stock</label>
          <input id="stock-q" name="q" defaultValue={query.q} placeholder="Search SKU, product or brand" />
        </form>
        <nav className="inv-chips !m-0" aria-label="Stock filter">
          {ONLY.map((o) => (
            <Link key={o} href={stockHref(query, { only: o })} aria-current={query.only === o ? "page" : undefined} scroll={false}>{ONLY_LABELS[o]}</Link>
          ))}
        </nav>
      </div>
      {!page.length ? (
        <p className="inv-empty">No products match.</p>
      ) : (
        <div className="table-scroll">
          <table className="inv-table">
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">Free</th>
                <th className="num">On hand</th>
                <th className="num">Reserved</th>
                <th className="num">Incoming</th>
                <th className="num">Unit cost</th>
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {page.map((row) => {
                const share = row.onHand > 0 ? Math.max(0, Math.min(1, row.available / row.onHand)) : 0;
                return (
                  <tr key={row.sku}>
                    <td>
                      <span className="inv-cell-name" title={row.name}>{row.name}</span>
                      <span className="inv-cell-sub">{row.sku}{row.brand ? ` · ${row.brand}` : ""}</span>
                    </td>
                    <td className="num">
                      <span className={`inv-free-cell ${row.available > 0 ? "is-good" : "is-bad"}`}>{row.available}</span>
                      <span className="inv-bar" aria-hidden="true"><span style={{ width: `${share * 100}%` }} /></span>
                    </td>
                    <td className="num">{row.onHand}</td>
                    <td className="num">{row.reserved || <span className="text-faint">0</span>}</td>
                    <td className="num">
                      {row.incoming ? <span className="text-info">+{row.incoming}</span> : <span className="text-faint">0</span>}
                      {row.nextEta ? <span className="inv-cell-sub">{shortDate(row.nextEta)}</span> : null}
                    </td>
                    <td className="num text-muted">{inr(row.unitCostMinor)}</td>
                    <td className="num">{row.unitCostMinor != null ? inr(row.unitCostMinor * Math.max(0, row.onHand)) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager path="/inventory" page={query.page} pageSize={STOCK_PAGE} total={rows.length} preserve={{ q: query.q, only: query.only === "all" ? "" : query.only }} />
    </Panel>
  );
}

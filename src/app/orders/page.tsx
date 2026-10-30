import { Suspense } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { BlockedState } from "@/components/blocked-state";
import { DownloadButton, StageBadge, TableWrap, inputClass, ownerLabel } from "@/components/ops/bits";
import { SectionSkeleton } from "@/components/ops/overview";
import { EmptyState, PageHeader, Pager } from "@/components/ui";
import { dateInputToBounds } from "@/lib/format";
import type { OpsStore } from "@/lib/ops/store";
import { HUBS, ORDER_STAGES, STAGE_LABELS, type OrderFilter, type OrderStage } from "@/lib/ops/types";
import { inr, shortWhen } from "@/lib/ops-ui/format";
import { metricsFor } from "@/lib/ops-ui/cached";
import { loadOps } from "@/lib/ops-ui/load";
import { firstParam, parsePage } from "@/lib/query";

const PAGE_SIZE = 50;

type Query = { stage: OrderStage | "open" | "all"; q: string; hub: string; poc: string; from: string; page: number };

function readQuery(params: Record<string, string | string[] | undefined>): Query {
  const stageRaw = firstParam(params.stage);
  const stage = stageRaw === "all" || (ORDER_STAGES as readonly string[]).includes(stageRaw) ? (stageRaw as Query["stage"]) : "open";
  const hubRaw = firstParam(params.hub);
  const from = firstParam(params.from);
  return {
    stage,
    q: firstParam(params.q).replace(/\s+/g, " ").trim().slice(0, 80),
    hub: (HUBS as readonly string[]).includes(hubRaw) ? hubRaw : "",
    poc: firstParam(params.poc).replace(/\s+/g, " ").trim().slice(0, 60),
    from: /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : "",
    page: parsePage(firstParam(params.page)),
  };
}

function href(query: Query, patch: Partial<Query>): string {
  const next = { ...query, ...patch, page: patch.page ?? 1 };
  const params = new URLSearchParams();
  if (next.stage !== "open") params.set("stage", next.stage);
  if (next.q) params.set("q", next.q);
  if (next.hub) params.set("hub", next.hub);
  if (next.poc) params.set("poc", next.poc);
  if (next.from) params.set("from", next.from);
  if (next.page > 1) params.set("page", String(next.page));
  const text = params.toString();
  return text ? `/orders?${text}` : "/orders";
}

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [ops, params] = await Promise.all([loadOps(), searchParams]);
  if (ops.kind !== "ready") return <BlockedState health={ops.workspace.health} />;
  const query = readQuery(params);
  const key = JSON.stringify(query);
  return (
    <section>
      <PageHeader
        title="Orders"
        description="Every order from sale to delivery. Search by customer, phone, product, SKU, #PIK or EPK id."
        action={
          <span className="flex flex-wrap gap-2">
            <DownloadButton kind="orders" />
            <Link href="/orders/new" className="glow-button inline-flex h-10 items-center gap-1.5 rounded-[14px] px-3.5 text-[13px] font-medium text-white">
              <Plus size={15} /> New order
            </Link>
          </span>
        }
      />
      <Suspense key={`tabs|${query.q}|${query.hub}|${query.poc}|${query.from}`} fallback={<div className="mb-3 h-[34px]" />}>
        <StageTabs store={ops.store} query={query} />
      </Suspense>
      <form action="/orders" className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        {query.stage !== "open" ? <input type="hidden" name="stage" value={query.stage} /> : null}
        {query.from ? <input type="hidden" name="from" value={query.from} /> : null}
        <label className="sr-only" htmlFor="orders-q">Search</label>
        <input id="orders-q" name="q" defaultValue={query.q} placeholder="Customer, phone, product, SKU, #PIK, EPK id" className={inputClass} />
        <label className="sr-only" htmlFor="orders-hub">Hub</label>
        <select id="orders-hub" name="hub" defaultValue={query.hub} className={inputClass}>
          <option value="">All hubs</option>
          {HUBS.map((hub) => <option key={hub} value={hub}>{hub}</option>)}
        </select>
        <label className="sr-only" htmlFor="orders-poc">POC</label>
        <Suspense fallback={<input id="orders-poc" name="poc" defaultValue={query.poc} placeholder="Any POC" className={inputClass} />}>
          <PocInput store={ops.store} value={query.poc} />
        </Suspense>
        <div className="flex gap-2">
          <button type="submit" className="glow-button h-11 flex-1 rounded-[14px] px-4 text-[14px] font-medium text-white sm:flex-none">Search</button>
          {query.q || query.hub || query.poc || query.from ? <Link href={href(query, { q: "", hub: "", poc: "", from: "" })} className="btn-quiet inline-flex h-11 items-center rounded-[14px] px-3 text-[13px]">Clear</Link> : null}
        </div>
      </form>
      {query.from ? <p className="mb-2 text-[12px] text-muted">Created on or after {query.from}. <Link href={href(query, { from: "" })} className="text-info">Show all dates</Link></p> : null}
      <Suspense key={key} fallback={<SectionSkeleton height={520} />}>
        <OrdersTable store={ops.store} query={query} />
      </Suspense>
    </section>
  );
}

function baseFilter(query: Query): OrderFilter {
  return {
    q: query.q || undefined,
    hub: query.hub || undefined,
    poc: query.poc || undefined,
    from: query.from ? dateInputToBounds(query.from, "").start?.toISOString() : undefined,
  };
}

/** Exact counts per stage, with the same search, hub, POC and date as the table below. */
async function StageTabs({ store, query }: { store: OpsStore; query: Query }) {
  const stages: Array<Query["stage"]> = ["open", ...ORDER_STAGES, "all"];
  const counts = await Promise.all(stages.map((stage) => store.listOrders({ ...baseFilter(query), stage, limit: 1 }).then((r) => r.total)));
  const tabs = stages.map((stage, i) => ({ stage, label: stage === "open" ? "Open" : stage === "all" ? "All" : STAGE_LABELS[stage], count: counts[i] }));
  return (
    <nav className="stage-tabs" aria-label="Stage">
      {tabs.map((tab) => (
        <Link key={tab.stage} href={href(query, { stage: tab.stage })} aria-current={query.stage === tab.stage ? "page" : undefined}>
          {tab.label} <span>{tab.count}</span>
        </Link>
      ))}
    </nav>
  );
}

async function PocInput({ store, value }: { store: OpsStore; value: string }) {
  const metrics = await metricsFor(store);
  const names = metrics.byPoc.map((p) => p.poc).filter((p) => p !== "No POC").sort();
  return (
    <>
      <input id="orders-poc" name="poc" defaultValue={value} placeholder="Any POC" list="poc-names" className={inputClass} />
      <datalist id="poc-names">
        {names.map((name) => <option key={name} value={name} />)}
      </datalist>
    </>
  );
}

async function OrdersTable({ store, query }: { store: OpsStore; query: Query }) {
  const filter: OrderFilter = {
    ...baseFilter(query),
    stage: query.stage,
    limit: PAGE_SIZE,
    offset: (query.page - 1) * PAGE_SIZE,
  };
  const { items, total } = await store.listOrders(filter);
  if (!items.length) {
    return <EmptyState title="No orders match" detail={query.q ? "Try fewer letters, a phone number, or the All tab." : "Nothing at this stage right now."} />;
  }
  const preserve: Record<string, string> = { stage: query.stage === "open" ? "" : query.stage, q: query.q, hub: query.hub, poc: query.poc, from: query.from };
  return (
    <div className="panel-strong p-2">
      <TableWrap minWidth={1060}>
        <thead>
          <tr>
            <th>ID</th>
            <th>Created</th>
            <th>Customer</th>
            <th>Products</th>
            <th>Hub</th>
            <th>POC</th>
            <th className="num">Offered</th>
            <th className="num">Paid / balance</th>
            <th>Stage</th>
            <th>Next</th>
          </tr>
        </thead>
        <tbody>
          {items.map((order) => {
            const balance = Math.max(0, order.offeredTotalMinor - order.paidMinor);
            const live = order.lines.filter((l) => l.status !== "cancelled");
            const lines = live.length ? live : order.lines;
            return (
              <tr key={order.id}>
                <td className="whitespace-nowrap">
                  <Link href={`/orders/${encodeURIComponent(order.id)}`} className="font-medium text-info">{order.id}</Link>
                  {order.shopifyOrderId ? <span className="block text-[11px] text-faint">{order.shopifyOrderId}</span> : null}
                </td>
                <td className="whitespace-nowrap tabular-nums text-muted">{shortWhen(order.createdAt)}</td>
                <td className="max-w-[180px]">
                  <Link href={`/orders/${encodeURIComponent(order.id)}`} className="block truncate text-ink">{order.customerName}</Link>
                  {order.phone ? <span className="block text-[11px] tabular-nums text-faint">{order.phone}</span> : null}
                </td>
                <td className="max-w-[260px]">
                  <span className="block truncate">{lines[0]?.productName ?? "—"}</span>
                  <span className="block truncate text-[11px] text-faint">
                    {lines[0]?.sku ?? "No SKU"}
                    {lines.length > 1 ? ` · +${lines.length - 1} more` : ""}
                  </span>
                </td>
                <td className="whitespace-nowrap">{order.hub ?? "—"}</td>
                <td className="max-w-[120px] truncate">{order.poc ?? "—"}</td>
                <td className="num">{inr(order.offeredTotalMinor)}</td>
                <td className="num">
                  <span className="block">{inr(order.paidMinor)}</span>
                  <span className={`block text-[11px] ${balance && order.stage !== "cancelled" ? "text-warn" : "text-faint"}`}>{balance ? `${inr(balance)} due` : "Paid"}</span>
                </td>
                <td><StageBadge stage={order.stage} /></td>
                <td className="whitespace-nowrap text-muted">{ownerLabel(order.stage)}</td>
              </tr>
            );
          })}
        </tbody>
      </TableWrap>
      <div className="px-2 pb-1">
        <Pager path="/orders" page={query.page} pageSize={PAGE_SIZE} total={total} preserve={preserve} />
      </div>
    </div>
  );
}

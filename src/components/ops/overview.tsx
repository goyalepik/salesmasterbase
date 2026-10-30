import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { DailyBars } from "@/components/charts";
import { Kpi, Panel } from "@/components/ops/bits";
import { isoDateInIst } from "@/lib/format";
import type { OpsStore } from "@/lib/ops/store";
import { OPEN_STAGES, STAGE_LABELS, type OrderStage } from "@/lib/ops/types";
import { inr, inrCompact, plural, shortWhen } from "@/lib/ops-ui/format";

const PIPELINE: Array<{ stage: OrderStage; who: string }> = [
  { stage: "awaiting_payment", who: "RevOps" },
  { stage: "awaiting_inventory", who: "Inventory" },
  { stage: "awaiting_stock", who: "Procurement" },
  { stage: "ready_to_dispatch", who: "Logistics" },
  { stage: "out_for_delivery", who: "Logistics" },
  { stage: "on_hold", who: "Sales" },
];

export async function OverviewBody({ store, nowIso }: { store: OpsStore; nowIso: string }) {
  const now = new Date(nowIso);
  const today = isoDateInIst(now);
  const [metrics, installs] = await Promise.all([store.metrics(now), store.listInstallations({ status: "pending" })]);
  const installsDue = installs.filter((i) => i.dueDate <= today).length;
  const overdueTotal = metrics.overdue.stuckPayment + metrics.overdue.stuckInventory + metrics.overdue.lateProcurement + metrics.overdue.lateInstallations;
  const openCount = OPEN_STAGES.reduce((sum, stage) => sum + metrics.pipeline[stage], 0);

  const queues = [
    { label: "Payment checks", count: metrics.pipeline.awaiting_payment, href: "/revops", note: metrics.overdue.stuckPayment ? `${metrics.overdue.stuckPayment} waiting over 24h` : "Verify against the bank" },
    { label: "Inventory decisions", count: metrics.pipeline.awaiting_inventory, href: "/inventory", note: metrics.overdue.stuckInventory ? `${metrics.overdue.stuckInventory} waiting over 24h` : "Reserve, hold, procure" },
    { label: "Waiting for stock", count: metrics.pipeline.awaiting_stock, href: "/procurement", note: metrics.overdue.lateProcurement ? `${metrics.overdue.lateProcurement} past ETA` : "On a PO or being bought" },
    { label: "Ready to dispatch", count: metrics.pipeline.ready_to_dispatch, href: "/dispatch", note: "Assign a delivery person" },
    { label: "Out for delivery", count: metrics.pipeline.out_for_delivery, href: "/dispatch", note: metrics.codOutstandingMinor ? `${inr(metrics.codOutstandingMinor)} COD to collect` : "Confirm delivery" },
    { label: "Installations due", count: installsDue, href: "/installations", note: metrics.overdue.lateInstallations ? `${metrics.overdue.lateInstallations} overdue` : `${installs.length} pending in all` },
  ];

  const maxHub = Math.max(1, ...metrics.byHub.map((h) => h.offeredMinor));
  const pocs = [...metrics.byPoc].sort((a, b) => b.offeredMinor - a.offeredMinor).slice(0, 8);
  const maxPoc = Math.max(1, ...pocs.map((p) => p.offeredMinor));
  const products = [...metrics.topProducts].sort((a, b) => b.units - a.units || b.offeredMinor - a.offeredMinor).slice(0, 8);
  const daysWithData = metrics.daily.filter((d) => d.orders > 0).length;

  return (
    <>
      <section className="mb-2.5">
        <h2 className="mb-2 px-1 text-[13px] font-semibold text-ink">Today, IST</h2>
        <dl className="ops-grid-4 !mb-0">
          <Kpi label="New orders" value={metrics.today.orders} href={`/orders?stage=all&from=${today}`} />
          <Kpi label="Offered price" value={inr(metrics.today.offeredMinor)} note="Deal price. Not money received." />
          <Kpi label="Payments verified" value={inr(metrics.today.verifiedMinor)} note="Checked against the bank today." tone={metrics.today.verifiedMinor ? "good" : undefined} />
          <Kpi label="Delivered" value={metrics.today.delivered} href="/orders?stage=delivered" />
        </dl>
      </section>

      <Panel
        className="mb-2.5"
        title="Where every open order is"
        subtitle={`${plural(openCount, "open order")} worth ${inr(metrics.pipelineValueMinor)} offered. Tap a stage to see the orders.`}
        aside={<Link href="/orders" className="shrink-0 text-[12px] text-info">All orders</Link>}
      >
        <div className="pipeline-strip">
          {PIPELINE.map(({ stage, who }) => (
            <Link key={stage} href={`/orders?stage=${stage}`}>
              <span className="block text-[12px] text-muted">{STAGE_LABELS[stage]}</span>
              <span className={`mt-1 block text-[24px] leading-none font-semibold tabular-nums ${stage === "on_hold" && metrics.pipeline[stage] ? "text-bad" : "text-ink"}`}>{metrics.pipeline[stage]}</span>
              <span className="mt-1 block text-[11px] text-faint">{who}</span>
            </Link>
          ))}
        </div>
      </Panel>

      <div className="ops-grid-2">
        <Panel title="Work queues" subtitle="What each team should do next.">
          <div className="queue-list">
            {queues.map((q) => (
              <Link key={q.label} href={q.href}>
                <span className="min-w-0">
                  <span className="block text-ink">{q.label}</span>
                  <span className="block truncate text-[11px] text-faint">{q.note}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-[20px] font-semibold tabular-nums">{q.count}</span>
                  <ArrowRight size={14} className="text-faint" />
                </span>
              </Link>
            ))}
          </div>
          <div className={`mt-2 rounded-[14px] border px-3 py-2.5 text-[13px] ${overdueTotal ? "border-[rgba(255,105,120,0.45)] bg-[rgba(255,105,120,0.08)]" : "border-line"}`}>
            <p className={overdueTotal ? "font-medium text-bad" : "text-muted"}>{overdueTotal ? `${plural(overdueTotal, "item")} overdue` : "Nothing overdue."}</p>
            {overdueTotal ? (
              <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted">
                {metrics.overdue.stuckPayment ? <Link href="/revops">{metrics.overdue.stuckPayment} payment &gt; 24h</Link> : null}
                {metrics.overdue.stuckInventory ? <Link href="/inventory">{metrics.overdue.stuckInventory} inventory &gt; 24h</Link> : null}
                {metrics.overdue.lateProcurement ? <Link href="/procurement">{metrics.overdue.lateProcurement} procurement past ETA</Link> : null}
                {metrics.overdue.lateInstallations ? <Link href="/installations">{metrics.overdue.lateInstallations} installations late</Link> : null}
              </p>
            ) : null}
          </div>
        </Panel>

        <Panel title="Last 14 days" subtitle={daysWithData ? "Orders created per day, and their offered price." : "No orders in the last 14 days."}>
          <p className="mb-1 text-[12px] text-muted">Orders</p>
          <DailyBars data={metrics.daily} measure="orders" />
          <p className="mt-3 mb-1 text-[12px] text-muted">Offered price</p>
          <DailyBars data={metrics.daily} measure="offeredMinor" />
        </Panel>
      </div>

      <div className="ops-grid-3">
        <Panel title="By hub" subtitle="Last 14 days, offered price.">
          <BarList rows={metrics.byHub.sort((a, b) => b.offeredMinor - a.offeredMinor).map((h) => ({ key: h.hub, label: h.hub, value: h.offeredMinor, detail: plural(h.orders, "order"), href: h.hub === "No hub" ? undefined : `/orders?stage=all&hub=${encodeURIComponent(h.hub)}` }))} max={maxHub} />
        </Panel>
        <Panel title="By POC" subtitle="Top salespeople, last 14 days." aside={<Link href="/poc" className="text-[12px] text-info">All</Link>}>
          <BarList rows={pocs.map((p) => ({ key: p.poc, label: p.poc, value: p.offeredMinor, detail: plural(p.orders, "order"), href: p.poc === "No POC" ? undefined : `/orders?stage=all&poc=${encodeURIComponent(p.poc)}` }))} max={maxPoc} />
        </Panel>
        <Panel title="Top products" subtitle="Units sold, last 14 days.">
          {products.length ? (
            <ol className="space-y-1.5 text-[12px]">
              {products.map((p, index) => (
                <li key={`${p.sku ?? p.name}-${index}`} className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-baseline gap-2">
                  <span className="tabular-nums text-faint">{index + 1}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-ink">{p.name}</span>
                    <span className="block truncate text-[11px] text-faint">{p.sku ?? "No SKU"}</span>
                  </span>
                  <span className="text-right tabular-nums">
                    <span className="block">{p.units} unit{p.units === 1 ? "" : "s"}</span>
                    <span className="block text-[11px] text-faint">{inrCompact(p.offeredMinor)}</span>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[13px] text-muted">No sales in the last 14 days.</p>
          )}
        </Panel>
      </div>

      <Panel title="Stock" subtitle="Units in the warehouse right now." aside={<Link href="/inventory#stock" className="text-[12px] text-info">Stock table</Link>} className="mb-2.5">
        <dl className="ops-grid-4 !mb-0">
          <Kpi label="Units on hand" value={metrics.stock.units.toLocaleString("en-IN")} note={`${metrics.stock.skus} SKUs`} />
          <Kpi label="Value at cost" value={inrCompact(metrics.stock.valueMinor)} note={inr(metrics.stock.valueMinor)} />
          <Kpi label="Reserved for orders" value={metrics.stock.reserved} href="/inventory?only=reserved#stock" />
          <Kpi label="Incoming on POs" value={metrics.stock.incoming} href="/procurement" />
        </dl>
      </Panel>
    </>
  );
}

function BarList({ rows, max }: { rows: Array<{ key: string; label: string; value: number; detail: string; href?: string }>; max: number }) {
  if (!rows.length) return <p className="text-[13px] text-muted">No orders in the last 14 days.</p>;
  return (
    <ul className="space-y-2 text-[12px]">
      {rows.map((row) => {
        const label = <span className="block truncate text-ink">{row.label}</span>;
        return (
          <li key={row.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
            <span className="min-w-0">
              {row.href ? <Link href={row.href}>{label}</Link> : label}
              <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-white/8">
                <span className="block h-1.5 rounded-full bg-accent" style={{ width: `${Math.max(4, (row.value / max) * 100)}%` }} />
              </span>
            </span>
            <span className="text-right tabular-nums">
              <span className="block">{inrCompact(row.value)}</span>
              <span className="block text-[11px] text-faint">{row.detail}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export async function RecentActivity({ store }: { store: OpsStore }) {
  const events = await store.recentEvents(15);
  return (
    <Panel title="Recent activity" subtitle="Every button press is logged with who did it." aside={<Link href="/orders" className="text-[12px] text-info">Orders</Link>}>
      {events.length ? (
        <ul className="text-[12px]">
          {events.map((event) => (
            <li key={event.id} className="grid grid-cols-[92px_minmax(0,1fr)] gap-2 border-t border-line py-2 first:border-t-0 sm:grid-cols-[100px_110px_minmax(0,1fr)]">
              <span className="tabular-nums text-faint">{shortWhen(event.createdAt)}</span>
              <Link href={`/orders/${encodeURIComponent(event.orderId)}`} className="truncate text-info">{event.orderId}</Link>
              <span className="col-span-2 min-w-0 text-muted sm:col-span-1">
                <span className="text-ink">{event.actor}</span> · {event.summary}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted">Nothing yet.</p>
      )}
    </Panel>
  );
}

export function SectionSkeleton({ height = 220 }: { height?: number }) {
  return <div className="skeleton mb-2.5" style={{ height }} aria-busy="true" aria-label="Loading" />;
}

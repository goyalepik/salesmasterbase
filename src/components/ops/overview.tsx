import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BadgeIndianRupee,
  Banknote,
  Boxes,
  ChevronRight,
  ClipboardList,
  Database,
  Hash,
  IndianRupee,
  PauseCircle,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  TriangleAlert,
  Truck,
  Wrench,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
import { OrderActivityChart, StageDonut } from "@/components/charts";
import { Panel } from "@/components/ops/bits";
import type { AssistantStatus } from "@/lib/ai/runtime";
import { isoDateInIst } from "@/lib/format";
import type { HealthReport } from "@/lib/health";
import type { OpsStore } from "@/lib/ops/store";
import { OPEN_STAGES, STAGE_LABELS, type OrderStage } from "@/lib/ops/types";
import { inr, inrCompact, plural, shortWhen } from "@/lib/ops-ui/format";

export const STAGE_COLOURS: Partial<Record<OrderStage, string>> = {
  awaiting_payment: "#f4bd50",
  awaiting_inventory: "#3b82f6",
  awaiting_stock: "#a78bfa",
  ready_to_dispatch: "#47d7a0",
  out_for_delivery: "#4fd6e0",
  on_hold: "#ff6978",
};

const EVENT_TONES: Record<string, { label: string; tone: string }> = {
  created: { label: "New sale", tone: "tone-accent" },
  imported: { label: "Imported", tone: "tone-muted" },
  payment_verified: { label: "Payment", tone: "tone-good" },
  reserved: { label: "Reserved", tone: "tone-good" },
  held_on_po: { label: "On PO", tone: "tone-violet" },
  procurement_requested: { label: "Procure", tone: "tone-violet" },
  brand_direct: { label: "Brand direct", tone: "tone-info" },
  rejected: { label: "Rejected", tone: "tone-bad" },
  sku_mapped: { label: "SKU set", tone: "tone-info" },
  stage: { label: "Moved", tone: "tone-info" },
  cancelled: { label: "Cancelled", tone: "tone-bad" },
  delivered: { label: "Delivered", tone: "tone-good" },
  out_for_delivery: { label: "Dispatched", tone: "tone-teal" },
  note: { label: "Note", tone: "tone-muted" },
  shopify: { label: "Shopify", tone: "tone-accent" },
};

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Change against the 7 days before. Null when there is nothing to compare with. */
function change(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export async function OverviewBody({ store, nowIso, health, assistant }: { store: OpsStore; nowIso: string; health: HealthReport; assistant: AssistantStatus }) {
  const now = new Date(nowIso);
  const today = isoDateInIst(now);
  const [metrics, installs, events] = await Promise.all([store.metrics(now), store.listInstallations({ status: "pending" }), store.recentEvents(7)]);
  const installsDue = installs.filter((i) => i.dueDate <= today).length;
  const openCount = OPEN_STAGES.reduce((total, stage) => total + metrics.pipeline[stage], 0);
  const overdue = metrics.overdue;
  const overdueTotal = overdue.stuckPayment + overdue.stuckInventory + overdue.lateProcurement + overdue.lateInstallations;

  const last7 = metrics.daily.slice(-7);
  const prev7 = metrics.daily.slice(-14, -7);
  const orders7 = sum(last7.map((d) => d.orders));
  const offered7 = sum(last7.map((d) => d.offeredMinor));
  const delivered7 = sum(last7.map((d) => d.delivered));

  const stages = OPEN_STAGES.filter((stage) => STAGE_COLOURS[stage]).map((stage) => ({
    key: stage,
    label: STAGE_LABELS[stage],
    count: metrics.pipeline[stage],
    colour: STAGE_COLOURS[stage] as string,
    href: `/orders?stage=${stage}`,
  }));

  const attention = [
    { label: "Payment checks over 24h", note: "Verify against the bank", count: overdue.stuckPayment, href: "/revops", icon: BadgeIndianRupee, colour: "#f4bd50" },
    { label: "Inventory decisions over 24h", note: "Reserve, hold, procure or reject", count: overdue.stuckInventory, href: "/inventory/decisions", icon: Boxes, colour: "#3b82f6" },
    { label: "Procurement past ETA", note: "Chase the vendor", count: overdue.lateProcurement, href: "/procurement", icon: ShoppingCart, colour: "#a78bfa" },
    { label: "Installations late", note: `${installsDue} due today or earlier`, count: overdue.lateInstallations, href: "/installations", icon: Wrench, colour: "#ff6978" },
    { label: "On hold", note: "Sent back to the seller", count: metrics.pipeline.on_hold, href: "/orders?stage=on_hold", icon: PauseCircle, colour: "#ff8a5c" },
    { label: "COD to collect", note: `${plural(metrics.pipeline.out_for_delivery, "order")} out for delivery`, count: metrics.codOutstandingMinor ? inrCompact(metrics.codOutstandingMinor) : 0, href: "/dispatch", icon: Banknote, colour: "#47d7a0" },
  ];

  const pocs = [...metrics.byPoc].filter((p) => p.poc !== "No POC").sort((a, b) => b.orders - a.orders || b.offeredMinor - a.offeredMinor).slice(0, 8);
  const maxPocOrders = Math.max(1, ...pocs.map((p) => p.orders));

  const live = health.source === "live";
  const databaseUp = health.database === "reachable" || health.database === "configured";
  const systems = [
    {
      name: "Slack",
      icon: Hash,
      colour: "#e01e5a",
      ok: Boolean(health.slackBotToken && health.slackSigning !== "not_configured"),
      status: health.slackBotToken && health.slackSigning !== "not_configured" ? "Connected" : "Not set up",
      detail: health.slackChannelName ? `#${health.slackChannelName}` : "Sale cards and buttons",
    },
    {
      name: "Supabase",
      icon: Database,
      colour: "#3ecf8e",
      ok: !live || databaseUp,
      status: live ? (databaseUp ? "Connected" : "Unreachable") : "Demo data",
      detail: live ? "Orders, stock and history" : "In memory, resets on restart",
    },
    {
      name: assistant.provider === "anthropic" ? "Claude" : assistant.provider === "openai" ? "OpenAI" : "AI assistant",
      icon: Sparkles,
      colour: assistant.provider === "anthropic" ? "#d97757" : "#70b5ff",
      ok: assistant.provider !== "rules",
      status: assistant.provider === "rules" ? "No AI key" : "Ready",
      detail: assistant.provider === "rules" ? "Fixed reports only" : assistant.model,
    },
  ];

  return (
    <>
      <dl className="stat-grid">
        <StatCard
          label="Orders"
          value={orders7.toLocaleString("en-IN")}
          delta={change(orders7, sum(prev7.map((d) => d.orders)))}
          note={`Today: ${metrics.today.orders} · Last 7 days`}
          icon={<ShoppingBag size={20} />}
          colour="#47d7a0"
          bars={last7.map((d) => d.orders)}
          href="/orders?stage=all"
        />
        <StatCard
          label="Offered price"
          value={offered7 >= 1e7 ? inrCompact(offered7) : inr(offered7)}
          delta={change(offered7, sum(prev7.map((d) => d.offeredMinor)))}
          note={`Today: ${inrCompact(metrics.today.offeredMinor)} · Deal price, not paid`}
          icon={<IndianRupee size={20} />}
          colour="#a78bfa"
          bars={last7.map((d) => d.offeredMinor)}
        />
        <StatCard
          label="Delivered"
          value={delivered7.toLocaleString("en-IN")}
          delta={change(delivered7, sum(prev7.map((d) => d.delivered)))}
          note={`Today: ${metrics.today.delivered} · Last 7 days`}
          icon={<Truck size={20} />}
          colour="#3b82f6"
          bars={last7.map((d) => d.delivered)}
          href="/orders?stage=delivered"
        />
        <StatCard
          label="Open orders"
          value={openCount.toLocaleString("en-IN")}
          note={`${inrCompact(metrics.pipelineValueMinor)} offered, not yet delivered`}
          icon={<ClipboardList size={20} />}
          colour="#4fd6e0"
          bars={stages.map((s) => s.count)}
          href="/orders"
        />
        <StatCard
          label="Overdue"
          value={overdueTotal.toLocaleString("en-IN")}
          note={openCount ? `${Math.round((overdueTotal / openCount) * 100)}% of open orders` : "Nothing open"}
          icon={<TriangleAlert size={20} />}
          colour={overdueTotal ? "#ff6978" : "#f4bd50"}
          bars={[overdue.stuckPayment, overdue.stuckInventory, overdue.lateProcurement, overdue.lateInstallations]}
        />
      </dl>

      <div className="overview-row overview-row-charts">
        <Panel title="Order activity" subtitle="Orders created and delivered per day, IST." aside={<span className="range-pill">Last 14 days</span>}>
          <div className="chart-legend">
            <span><i style={{ background: "#3b82f6" }} />Created</span>
            <span><i style={{ background: "#f4bd50" }} />Delivered</span>
          </div>
          <OrderActivityChart data={metrics.daily} />
        </Panel>
        <Panel title="Open orders by stage" subtitle={`${plural(openCount, "order")} waiting on a team. Tap a stage.`} aside={<Link href="/orders" className="panel-link">View all <ArrowRight size={13} /></Link>}>
          <div className="donut-layout">
            <StageDonut slices={stages} total={openCount} />
            <ul className="donut-legend">
              {stages.map((s) => (
                <li key={s.key}>
                  <Link href={s.href}>
                    <span className="flex min-w-0 items-center gap-2.5">
                      <i style={{ background: s.colour }} />
                      <span className="truncate">{s.label}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-muted">
                      <b className="font-semibold text-ink">{s.count}</b> ({openCount ? ((s.count / openCount) * 100).toFixed(1) : "0.0"}%)
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </Panel>
        <Panel title="System health" aside={<Link href="/settings" className="panel-link">View details <ArrowRight size={13} /></Link>}>
          <ul className="health-list">
            {systems.map((system) => {
              const Icon = system.icon;
              return (
                <li key={system.name}>
                  <span className="health-icon" style={{ "--tint": system.colour } as CSSProperties}><Icon size={18} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold text-ink">{system.name}</span>
                    <span className="block truncate text-[11.5px] text-faint">{system.detail}</span>
                  </span>
                  <span className="text-right">
                    <span className={`flex items-center justify-end gap-1.5 text-[12.5px] font-medium ${system.ok ? "text-good" : "text-warn"}`}>
                      <span className={`size-2 rounded-full ${system.ok ? "bg-good" : "bg-warn"}`} />
                      {system.status}
                    </span>
                  </span>
                  <Signal level={system.ok ? 4 : 1} ok={system.ok} />
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>

      <div className="overview-row overview-row-lists">
        <Panel title="Recent activity" subtitle="Every button press, with who did it." aside={<Link href="/orders?stage=all" className="panel-link">View all <ArrowRight size={13} /></Link>}>
          {events.length ? (
            <div className="table-scroll">
              <table className="ops-table activity-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Who</th>
                    <th>What happened</th>
                    <th>Order</th>
                    <th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => {
                    const tone = EVENT_TONES[event.type] ?? { label: event.type.replace(/_/g, " "), tone: "tone-info" };
                    return (
                      <tr key={event.id}>
                        <td className="whitespace-nowrap tabular-nums text-muted">{shortWhen(event.createdAt).split(", ").pop()}</td>
                        <td>
                          <span className="flex items-center gap-2.5 whitespace-nowrap">
                            <Avatar name={event.actor} size={30} />
                            <span className="max-w-[120px] truncate text-ink">{event.actor}</span>
                          </span>
                        </td>
                        <td className="min-w-[200px] text-muted"><span className="line-clamp-2">{event.summary}</span></td>
                        <td className="whitespace-nowrap"><Link href={`/orders/${encodeURIComponent(event.orderId)}`} className="text-ink hover:text-info">{event.orderId}</Link></td>
                        <td><span className={`badge capitalize ${tone.tone}`}>{tone.label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[13px] text-muted">Nothing yet.</p>
          )}
        </Panel>

        <Panel title="Top salespeople" subtitle="Orders by POC, last 14 days." aside={<Link href="/poc" className="panel-link">View all <ArrowRight size={13} /></Link>}>
          {pocs.length ? (
            <ol className="rank-list">
              {pocs.map((p, index) => (
                <li key={p.poc}>
                  <Link href={`/orders?stage=all&poc=${encodeURIComponent(p.poc)}`} title={`${p.poc}: ${plural(p.orders, "order")}, ${inr(p.offeredMinor)} offered`}>
                    <span className="w-4 text-right tabular-nums text-faint">{index + 1}</span>
                    <Avatar name={p.poc} size={28} />
                    <span className="min-w-0 truncate text-ink">{p.poc}</span>
                    <span className="rank-bar"><span style={{ width: `${Math.max(6, (p.orders / maxPocOrders) * 100)}%` }} /></span>
                    <span className="w-7 text-right font-semibold tabular-nums">{p.orders}</span>
                  </Link>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[13px] text-muted">No sales in the last 14 days.</p>
          )}
        </Panel>

        <Panel title="Needs attention" subtitle="Late work across every team." aside={<Link href="/orders" className="panel-link">View all <ArrowRight size={13} /></Link>}>
          <ul className="attention-list">
            {attention.map((item) => {
              const Icon = item.icon;
              const quiet = item.count === 0;
              return (
                <li key={item.label} className={quiet ? "is-quiet" : undefined}>
                  <Link href={item.href}>
                    <span className="attention-icon" style={{ "--tint": item.colour } as CSSProperties}><Icon size={17} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-ink">{item.label}</span>
                      <span className="block truncate text-[11.5px] text-faint">{item.note}</span>
                    </span>
                    <span className="text-[17px] font-semibold tabular-nums">{item.count}</span>
                    <ChevronRight size={15} className="text-faint" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>

    </>
  );
}

function StatCard({ label, value, delta, note, icon, colour, bars, href }: { label: string; value: ReactNode; delta?: number | null; note: string; icon: ReactNode; colour: string; bars: number[]; href?: string }) {
  const max = Math.max(1, ...bars);
  const body = (
    <>
      <span className="stat-icon" aria-hidden="true">{icon}</span>
      <span className="min-w-0 flex-1">
        <dt className="stat-label">{label}</dt>
        <dd className="stat-value-row">
          <span className="stat-value">{value}</span>
          {delta != null ? (
            <span className={`stat-delta ${delta >= 0 ? "is-up" : "is-down"}`}>
              {delta >= 0 ? <ArrowUp size={11} strokeWidth={2.6} /> : <ArrowDown size={11} strokeWidth={2.6} />}
              {Math.abs(delta)}%
            </span>
          ) : null}
        </dd>
        <p className="stat-note">{note}</p>
      </span>
      <span className="stat-spark" aria-hidden="true">
        {bars.map((value, index) => (
          <i key={index} style={{ height: `${Math.max(14, (value / max) * 100)}%`, opacity: 0.45 + (0.55 * (index + 1)) / bars.length }} />
        ))}
      </span>
    </>
  );
  const style = { "--tint": colour } as CSSProperties;
  return href ? (
    <Link href={href} className="stat-card" style={style}>{body}</Link>
  ) : (
    <div className="stat-card" style={style}>{body}</div>
  );
}

function Signal({ level, ok }: { level: number; ok: boolean }) {
  return (
    <span className={`signal ${ok ? "is-ok" : "is-warn"}`} aria-hidden="true">
      {[1, 2, 3, 4].map((bar) => <i key={bar} className={bar <= level ? "is-on" : undefined} style={{ height: `${bar * 25}%` }} />)}
    </span>
  );
}

export function SectionSkeleton({ height = 220 }: { height?: number }) {
  return <div className="skeleton mb-3" style={{ height }} aria-busy="true" aria-label="Loading" />;
}

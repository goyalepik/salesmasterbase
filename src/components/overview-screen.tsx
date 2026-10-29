import Link from "next/link";
import { ArrowUp, Sparkles } from "lucide-react";
import { RefreshOnChange } from "@/components/live-provider";
import { DemoNotice, EmptyState } from "@/components/ui";
import { formatInrFromMinor } from "@/lib/format";
import type { IncentivePerson } from "@/lib/incentive";
import type { HealthReport } from "@/lib/health";
import { readCompleteOrder } from "@/lib/orders";
import type { InboxRow, OverviewData } from "@/lib/types";

const PROMPTS = [
  ["Who sold in the last 5 days?", "Who should get incentive for the last 5 days?"],
  ["Orders needing a look", "Show messages that need review."],
] as const;

function greeting(iso: string): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hourCycle: "h23" }).format(new Date(iso)));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function shortWhen(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

function initials(label: string): string {
  const parts = label.split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? "?"}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

export function OverviewScreen({
  overview,
  health,
  nowIso,
  todayOrders,
  incentive,
}: {
  overview: OverviewData;
  health: HealthReport;
  nowIso: string;
  todayOrders: InboxRow[];
  incentive: IncentivePerson[];
}) {
  const leaders = incentive.filter((person) => person.orders > 0).slice(0, 6);
  const maxOffered = Math.max(1, ...leaders.map((person) => person.offeredMinor ?? 0));

  return (
    <div className="overview-page">
      <RefreshOnChange />
      <section className="ai-hero">
        <p>{greeting(nowIso)}</p>
        <h1>Ask anything about EPIK</h1>
        <form action="/assistant" className="ai-prompt">
          <Sparkles size={15} className="shrink-0 text-info" />
          <label className="sr-only" htmlFor="overview-ask">Ask anything about EPIK</label>
          <input id="overview-ask" name="q" placeholder="Ask about sales, payment updates, or what needs attention…" />
          <button type="submit" aria-label="Ask"><ArrowUp size={15} /></button>
        </form>
      </section>
      <div className="suggested-questions">
        {PROMPTS.map(([label, question]) => (
          <Link key={label} href={`/assistant?q=${encodeURIComponent(question)}`}>{label}</Link>
        ))}
      </div>
      {health.modeLabel === "Demo" ? <DemoNotice /> : null}

      <section className="dashboard-panel mb-4">
        <div className="dashboard-panel-header">
          <div>
            <h2 className="dashboard-panel-title">Today, IST</h2>
            <p className="dashboard-panel-subtitle">Complete orders only. A row needs a customer, a product, and an offered price.</p>
          </div>
          <Link href="/orders/new" className="text-[12px] text-info">New order</Link>
        </div>
        <dl className="grid gap-3 sm:grid-cols-3">
          <div className="glass-stat">
            <dt className="text-[12px] text-muted">Orders</dt>
            <dd className="text-[28px] leading-none tabular-nums">{overview.day.orderSheets}</dd>
          </div>
          <div className="glass-stat">
            <dt className="text-[12px] text-muted">Offered price</dt>
            <dd className="text-[28px] leading-none tabular-nums">{formatInrFromMinor(overview.day.offeredMinor)}</dd>
          </div>
          <div className="glass-stat">
            <dt className="text-[12px] text-muted">Advances in threads</dt>
            <dd className="text-[28px] leading-none tabular-nums">{overview.day.threadAdvances}</dd>
            <p className="mt-1 text-[12px] text-muted">Mentioned on the order. Not added to the price.</p>
          </div>
        </dl>
      </section>

      <div className="operations-grid">
        <section className="dashboard-panel">
          <div className="dashboard-panel-header">
            <h2 className="dashboard-panel-title">Today's orders</h2>
            <Link href="/inbox" className="text-[12px] text-info">All orders</Link>
          </div>
          {todayOrders.length === 0 ? <EmptyState title="No complete order today" detail="Use New order. A half-written Slack line stays out of this list." /> : (
            <div className="overflow-x-auto">
              <div className="grid min-w-[560px] grid-cols-[88px_120px_minmax(0,1fr)_minmax(0,1fr)_108px] gap-2 px-1 pb-1 text-[11px] text-faint">
                <span>Time</span><span>POC</span><span>Customer</span><span>Product</span><span>Offered price</span>
              </div>
              {todayOrders.map((row) => {
                const order = readCompleteOrder(row.text);
                const poc = order?.poc || (row.senderName && !/^U[A-Z0-9]+$/.test(row.senderName) ? row.senderName : "—");
                return (
                  <Link key={row.id} href={`/inbox/${row.id}`} className="grid min-w-[560px] grid-cols-[88px_120px_minmax(0,1fr)_minmax(0,1fr)_108px] items-center gap-2 border-t border-white/8 px-1 py-1.5 text-[12px] hover:bg-white/4">
                    <span className="tabular-nums text-muted">{shortWhen(row.eventReceivedAt)}</span>
                    <span className="truncate">{poc}</span>
                    <span className="truncate">{order?.customerName ?? "—"}</span>
                    <span className="truncate">{order?.product ?? "—"}</span>
                    <span className="tabular-nums">{order ? formatInrFromMinor(order.offeredPriceMinor) : "—"}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
        <section className="dashboard-panel">
          <div className="dashboard-panel-header">
            <div>
              <h2 className="dashboard-panel-title">Salespeople</h2>
              <p className="dashboard-panel-subtitle">Last 5 days. Complete orders and the offered price on them.</p>
            </div>
            <Link href="/contributors" className="text-[12px] text-info">All</Link>
          </div>
          {leaders.length === 0 ? <p className="text-[13px] text-muted">No complete order in the last 5 days.</p> : (
            <ol className="space-y-2">
              {leaders.map((person, index) => (
                <li key={person.key} className="grid grid-cols-[16px_28px_minmax(0,1fr)_auto] items-center gap-2 text-[12px]">
                  <span className="tabular-nums text-faint">{index + 1}</span>
                  <span className="flex size-7 items-center justify-center rounded-full bg-white/8 text-[10px]">{initials(person.name ?? "Name needed")}</span>
                  <span className="min-w-0">
                    <span className="block truncate">{person.name ?? "Name needed"}</span>
                    {person.slackId ? <span className="block truncate text-[11px] text-faint">{person.slackId}</span> : null}
                    <span className="mt-1 block h-1 overflow-hidden rounded-full bg-white/8">
                      <span className="block h-1 rounded-full bg-accent" style={{ width: `${Math.max(8, ((person.offeredMinor ?? 0) / maxOffered) * 100)}%` }} />
                    </span>
                  </span>
                  <span className="text-right tabular-nums text-muted">
                    <span className="block">{person.offeredMinor != null ? formatInrFromMinor(person.offeredMinor) : "—"}</span>
                    <span className="block text-[11px] text-faint">{person.orders} order{person.orders === 1 ? "" : "s"}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

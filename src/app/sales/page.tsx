import Link from "next/link";
import { ArrowRight, ClipboardPlus, MessageSquare } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { BlockedState } from "@/components/blocked-state";
import { Panel, StageBadge } from "@/components/ops/bits";
import { PageHeader } from "@/components/ui";
import { isoDateInIst, lastDaysBounds } from "@/lib/format";
import { inr, inrCompact, plural, shortWhen } from "@/lib/ops-ui/format";
import { loadOps } from "@/lib/ops-ui/load";

export default async function SalesLoungePage() {
  const ops = await loadOps();
  if (ops.kind !== "ready") return <BlockedState health={ops.workspace.health} />;
  const now = new Date();
  const five = lastDaysBounds(now, 5);
  const today = isoDateInIst(now);
  const [recent, window5, held] = await Promise.all([
    ops.store.listOrders({ stage: "all", limit: 8 }),
    ops.store.listOrders({ stage: "all", from: five.start.toISOString(), to: five.end.toISOString(), limit: 1000 }),
    ops.store.listOrders({ stage: "on_hold", limit: 20 }),
  ]);
  const sold = window5.items.filter((o) => o.stage !== "cancelled");
  const todays = sold.filter((o) => isoDateInIst(new Date(o.createdAt)) === today);
  const board = new Map<string, { poc: string; orders: number; offeredMinor: number }>();
  for (const order of sold) {
    if (!order.poc) continue;
    const row = board.get(order.poc) ?? { poc: order.poc, orders: 0, offeredMinor: 0 };
    row.orders += 1;
    row.offeredMinor += order.offeredTotalMinor;
    board.set(order.poc, row);
  }
  const leaders = [...board.values()].sort((a, b) => b.offeredMinor - a.offeredMinor).slice(0, 6);
  const top = Math.max(1, ...leaders.map((l) => l.offeredMinor));

  return (
    <section>
      <PageHeader title="Sales Lounge" description="Book the sale here or in Slack. Payments, stock and delivery are handled by the other teams, and you can follow every order below." />

      <div className="sales-hero">
        <Link href="/orders/new" className="sales-cta">
          <span className="sales-cta-icon"><ClipboardPlus size={22} /></span>
          <span className="min-w-0">
            <span className="block text-[18px] font-bold tracking-[-0.02em] text-white">Book a new sale</span>
            <span className="block text-[13px] text-[#d7fbe9]">Customer, phone, products, price. Two minutes.</span>
          </span>
          <ArrowRight size={20} className="ml-auto shrink-0 text-white" />
        </Link>
        <dl className="sales-stats">
          <div><dt>Sales today</dt><dd>{todays.length}</dd></div>
          <div><dt>Offered today</dt><dd>{inrCompact(todays.reduce((sum, o) => sum + o.offeredTotalMinor, 0))}</dd></div>
          <div><dt>Last 5 days</dt><dd>{sold.length}</dd></div>
          <div><dt>Sent back</dt><dd className={held.total ? "text-bad" : undefined}>{held.total}</dd></div>
        </dl>
      </div>
      <p className="mb-4 flex items-center gap-2 text-[12.5px] text-muted"><MessageSquare size={14} className="shrink-0 text-good" /><span>On the go? Tap <b className="text-ink">New sale</b> pinned in #epik_cd-payment-updates.</span></p>

      <div className="overview-row sales-row">
        <Panel title="Where your sales are" subtitle="Newest first. Tap one to see its journey." aside={<Link href="/orders?stage=all" className="panel-link">All orders <ArrowRight size={13} /></Link>}>
          {recent.items.length ? (
            <ul className="sale-list">
              {recent.items.map((order) => (
                <li key={order.id}>
                  <Link href={`/orders/${encodeURIComponent(order.id)}`}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-semibold text-ink">{order.customerName}</span>
                      <span className="block truncate text-[12px] text-faint">{order.lines.map((l) => l.productName).join(", ") || "No product"}</span>
                    </span>
                    <span className="hidden text-right sm:block">
                      <span className="block text-[13px] font-semibold tabular-nums">{inr(order.offeredTotalMinor)}</span>
                      <span className="block text-[11.5px] text-faint">{order.poc ?? "No POC"} · {shortWhen(order.createdAt)}</span>
                    </span>
                    <StageBadge stage={order.stage} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">No sales yet.</p>
          )}
        </Panel>

        <div className="grid content-start gap-3">
          <Panel title="Leaderboard" subtitle="Offered price, today and the 4 days before.">
            {leaders.length ? (
              <ol className="rank-list">
                {leaders.map((row, index) => (
                  <li key={row.poc}>
                    <Link href={`/orders?stage=all&poc=${encodeURIComponent(row.poc)}`} title={`${plural(row.orders, "order")}, ${inr(row.offeredMinor)}`} className="!grid-cols-[16px_28px_minmax(60px,1fr)_minmax(40px,0.8fr)_56px]">
                      <span className="w-4 text-right tabular-nums text-faint">{index + 1}</span>
                      <Avatar name={row.poc} size={28} />
                      <span className="min-w-0 truncate text-ink">{row.poc}</span>
                      <span className="rank-bar is-sales"><span style={{ width: `${Math.max(6, (row.offeredMinor / top) * 100)}%` }} /></span>
                      <span className="text-right font-semibold tabular-nums">{inrCompact(row.offeredMinor)}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[13px] text-muted">No sales with a POC in the last 5 days.</p>
            )}
          </Panel>
          <Panel title="Sent back to you" subtitle="Inventory could not fill these. Fix and resend, or cancel.">
            {held.items.length ? (
              <ul className="sale-list">
                {held.items.map((order) => (
                  <li key={order.id}>
                    <Link href={`/orders/${encodeURIComponent(order.id)}`}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-semibold text-ink">{order.customerName}</span>
                        <span className="block truncate text-[12px] text-bad">{order.holdReason ?? "No reason given"}</span>
                      </span>
                      <ArrowRight size={15} className="shrink-0 text-faint" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">Nothing sent back. Nice.</p>
            )}
          </Panel>
        </div>
      </div>
    </section>
  );
}

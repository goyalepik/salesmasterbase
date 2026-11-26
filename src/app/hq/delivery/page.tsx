import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { Segments } from "@/features/hq/ui/charts";
import { inr, int, pct } from "@/features/hq/ui/fmt";
import { Head, Kpi } from "@/features/hq/ui/kit";
import { loadPage, type SP } from "@/features/hq/ui/load";
import { SalesFeedMissing } from "@/features/hq/ui/setup";
import { HqShell } from "@/features/hq/ui/shell";
import "@/features/hq/hq.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Delivery · EPIK HQ" };
const TONE = { good: "#1f9d63", move: "#4a6cf7", wait: "#e0a020", bad: "#d64545", quiet: "#c9c5bb" } as const;

export default async function Delivery({ searchParams }: { searchParams: SP }) {
  const { data } = await loadPage(searchParams);
  if (!data) return <HqShell current="delivery"><SalesFeedMissing /></HqShell>;
  const { d } = data, del = d.delivery, n = d.now;
  const total = del.statuses.reduce((s, x) => s + x.orders, 0);
  return (
    <HqShell current="delivery" d={d} at={data.at} stale={data.stale}>
      <div className="hq-kpis" style={{ "--n": 5 } as CSSProperties}>
        <Kpi label="Delivered" value={pct(del.deliveredPct)} sub="Of orders not cancelled or unconfirmed" tone="coral" />
        <Kpi label="Days to deliver" value={del.avgDays == null ? "—" : `${del.avgDays}`} sub="Sale date to delivery date" />
        <Kpi label="Not delivered yet" value={int(del.pending)} sub="Orders still open" tone="dark" />
        <Kpi label="Cancelled" value={int(n.cancelledOrders)} sub={inr(n.cancelledValue)} />
        <Kpi label="Not confirmed" value={int(n.notConfirmedOrders)} sub="Left out of sales" />
      </div>
      <div className="hq-screen">
        <section className="hq-card c-12">
          <Head title="Where orders are" sub="By the SMB's Logistic Status, one per order" />
          <Segments parts={del.statuses.map((s) => ({ label: s.label, value: s.orders, colour: TONE[s.tone] }))} legend={0} />
          <div className="hq-status-grid">
            {del.statuses.map((s) => (
              <div key={s.label}>
                <i style={{ background: TONE[s.tone] }} />
                <strong>{s.label}</strong>
                <b>{int(s.orders)}</b>
                <span className="hq-label">{pct(total ? s.orders / total : null)} of orders</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </HqShell>
  );
}

import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { Segments } from "@/features/hq/ui/charts";
import { inr, int, pct } from "@/features/hq/ui/fmt";
import { Chip, Head, Kpi } from "@/features/hq/ui/kit";
import { loadPage, type SP } from "@/features/hq/ui/load";
import { SalesFeedMissing } from "@/features/hq/ui/setup";
import { HqShell } from "@/features/hq/ui/shell";
import { RowTable } from "@/features/hq/ui/table";
import "@/features/hq/hq.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Customers · EPIK HQ" };

export default async function Customers({ searchParams }: { searchParams: SP }) {
  const { data } = await loadPage(searchParams);
  if (!data) return <HqShell current="customers"><SalesFeedMissing /></HqShell>;
  const { d } = data, n = d.now, b = d.before;
  const cash = n.paid + n.balance;
  return (
    <HqShell current="customers" d={d} at={data.at} stale={data.stale}>
      <div className="hq-kpis" style={{ "--n": 6 } as CSSProperties}>
        <Kpi label="Customers" value={int(n.customers)} chip={<Chip now={n.customers} before={b.customers} />} sub={`${int(n.newCustomers)} new · ${int(n.repeatCustomers)} repeat`} />
        <Kpi label="Repeat customers" value={pct(n.repeatPct, 1)} sub="Of customers in the period" tone="dark" />
        <Kpi label="Order value" value={inr(n.aov)} sub="Average NMV per order" />
        <Kpi label="Collected" value={inr(n.paid)} sub={`${pct(cash ? n.paid / cash : null)} of order value`} tone="coral" />
        <Kpi label="To collect" value={inr(n.balance)} sub="Balance pending" />
        <Kpi label="Cancelled" value={int(n.cancelledOrders)} sub={`${inr(n.cancelledValue)} · ${int(n.notConfirmedOrders)} not confirmed`} />
      </div>
      <div className="hq-screen" style={{ "--rows": "minmax(0, 1fr) minmax(0, 1fr)" } as CSSProperties}>
        <section className="hq-card c-4">
          <Head title="New and repeat" sub="Unique by phone, from the SMB CX Type" />
          <div className="hq-grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
            <div><span className="hq-label">New</span><div className="hq-mid" style={{ fontSize: 28 }}>{int(n.newCustomers)}</div><span className="hq-label">{pct(n.customers ? n.newCustomers / n.customers : null)}</span></div>
            <div><span className="hq-label">Repeat</span><div className="hq-mid" style={{ fontSize: 28 }}>{int(n.repeatCustomers)}</div><span className="hq-label">{pct(n.repeatPct)}</span></div>
          </div>
          <Segments parts={[{ label: "New", value: n.newCustomers, colour: "#f2643a" }, { label: "Repeat", value: n.repeatCustomers, colour: "#16140f" }]} legend={0} />
        </section>
        <section className="hq-card c-8" style={{ gridRow: "span 2" }}><Head title="Where customers come from" sub="By sale source" /><div className="hq-fill"><RowTable rows={d.bySource} first="Source" /></div></section>
        <section className="hq-card c-4">
          <Head title="Payment status" sub="Orders that count as sales" />
          <div className="hq-list hq-fill">{d.payments.map((p) => <div key={p.label}><span><strong>{p.label}</strong><small>{int(p.orders)} orders</small></span><b>{inr(p.value)}</b></div>)}</div>
        </section>
      </div>
    </HqShell>
  );
}

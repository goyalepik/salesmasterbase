import type { Metadata } from "next";
import { Segments } from "@/features/hq/ui/charts";
import { inr, int, pct } from "@/features/hq/ui/fmt";
import { Head, Stat } from "@/features/hq/ui/kit";
import { loadPage, type SP } from "@/features/hq/ui/load";
import { SalesFeedMissing } from "@/features/hq/ui/setup";
import { HqShell, Period } from "@/features/hq/ui/shell";
import "@/features/hq/hq.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Customers · EPIK HQ" };

export default async function Customers({ searchParams }: { searchParams: SP }) {
  const { data } = await loadPage(searchParams);
  if (!data) return <HqShell current="customers"><SalesFeedMissing /></HqShell>;
  const { d } = data, n = d.now;
  return (
    <HqShell current="customers" range={d.range}>
      <Period range={d.range} ranges={d.ranges} path="/hq/customers" at={data.at} stale={data.stale} lastSale={d.lastSaleDay} lastAd={d.lastAdDay} />
      <div className="hq-grid" style={{ margin: "16px 0" }}>
        <div className="c-3"><Stat label="Customers" value={int(n.customers)} sub={`${int(n.newCustomers)} new · ${int(n.repeatCustomers)} repeat`} /></div>
        <div className="c-3"><Stat label="Repeat customers" value={pct(n.repeatPct, 1)} tone="dark" /></div>
        <div className="c-3"><Stat label="Collected" value={inr(n.paid)} sub="Amount paid, per the SMB" tone="coral" /></div>
        <div className="c-3"><Stat label="To collect" value={inr(n.balance)} sub={`${int(n.cancelledOrders)} cancelled or refunded (${inr(n.cancelledValue)})`} /></div>
        <section className="hq-card c-6"><Head title="New vs repeat" /><Segments parts={[{ label: "New", value: n.newCustomers, colour: "#f2643a" }, { label: "Repeat", value: n.repeatCustomers, colour: "#16140f" }]} /></section>
        <section className="hq-card c-6">
          <Head title="Payment status" sub="All orders in the period, incl. cancelled" />
          <div className="hq-list">{d.payments.map((p) => <div key={p.label}><span><strong>{p.label}</strong><small>{int(p.orders)} orders</small></span><b>{inr(p.value)}</b></div>)}</div>
        </section>
      </div>
    </HqShell>
  );
}

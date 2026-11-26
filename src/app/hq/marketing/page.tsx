import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { DayBars } from "@/features/hq/ui/charts";
import { day, inr, int, pct } from "@/features/hq/ui/fmt";
import { Chip, Head, Kpi } from "@/features/hq/ui/kit";
import { loadPage, type SP } from "@/features/hq/ui/load";
import { SalesFeedMissing } from "@/features/hq/ui/setup";
import { HqShell } from "@/features/hq/ui/shell";
import { RowTable } from "@/features/hq/ui/table";
import "@/features/hq/hq.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Marketing · EPIK HQ" };
const x1 = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}×`);

export default async function Marketing({ searchParams }: { searchParams: SP }) {
  const { data } = await loadPage(searchParams);
  if (!data) return <HqShell current="marketing"><SalesFeedMissing /></HqShell>;
  const { d } = data, n = d.now, b = d.before;
  return (
    <HqShell current="marketing" d={d} at={data.at} stale={data.stale}>
      <div className="hq-kpis" style={{ "--n": 6 } as CSSProperties}>
        <Kpi label="Meta spend" value={inr(n.spend)} chip={<Chip now={n.spend} before={b.spend} invert />} sub={`${pct(n.nmv ? n.spend / n.nmv : null, 1)} of NMV`} tone="dark" />
        <Kpi label="CAC" value={inr(n.cac)} chip={<Chip now={n.cac} before={b.cac} invert />} sub={`${int(n.newCustomers)} new customers`} tone="coral" />
        <Kpi label="ROAS" value={x1(n.roas)} chip={<Chip now={n.roas} before={b.roas} />} sub="NMV ÷ Meta spend" />
        <Kpi label="Demos booked" value={int(n.demos)} chip={<Chip now={n.demos} before={b.demos} />} sub={`${int(n.homeDemos)} home · ${int(n.videoDemos)} video`} />
        <Kpi label="Cost per demo" value={inr(n.costPerDemo)} chip={<Chip now={n.costPerDemo} before={b.costPerDemo} invert />} sub="Meta spend ÷ demos" />
        <Kpi label="Demo to sale" value={pct(n.demoConversion, 1)} sub={`${int(n.demoSales)} demo sales`} />
      </div>
      <div className="hq-screen" style={{ "--rows": "minmax(0, 1fr) minmax(0, 1fr)" } as CSSProperties}>
        <section className="hq-card c-6">
          <Head title="Meta spend per day" sub="Getepik Tracker · hover a day for demos" />
          <DayBars points={d.daily.map((x) => ({ day: x.day, v: x.spend }))} colour="#16140f" tip={(i) => { const x = d.daily[i]; return `${day(x.day)}\nMeta ${inr(x.spend)}\nNMV ${inr(x.nmv)} · ${x.orders} orders`; }} />
        </section>
        <section className="hq-card c-6"><Head title="By sale source" sub="Demo, virtual demo, direct, referral…" /><div className="hq-fill"><RowTable rows={d.bySource} first="Source" /></div></section>
        <section className="hq-card c-12">
          <Head title="By campaign" sub="Meta campaigns grouped by the SMB category they sell, so no sale is counted twice (AF and Kitchen both sell kitchen)" />
          <div className="hq-fill">
            <table className="hq-table">
              <thead><tr><th>Campaigns</th><th>Category</th><th className="n">Spend</th><th className="n">Demos</th><th className="n">Cost per demo</th><th className="n">New customers</th><th className="n">CAC</th><th className="n">NMV</th><th className="n">ROAS</th></tr></thead>
              <tbody>{d.campaigns.map((c) => <tr key={c.campaign}><td style={{ fontWeight: 600 }}>{c.campaign}</td><td>{c.category}</td><td className="n">{inr(c.spend)}</td><td className="n">{int(c.demos)}</td><td className="n">{inr(c.demos ? c.spend / c.demos : null)}</td><td className="n">{int(c.newCustomers)}</td><td className="n">{inr(c.cac)}</td><td className="n">{inr(c.nmv)}</td><td className="n">{x1(c.roas)}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      </div>
    </HqShell>
  );
}

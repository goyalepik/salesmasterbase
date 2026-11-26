import type { Metadata } from "next";
import { DayBars } from "@/features/hq/ui/charts";
import { inr, int, pct } from "@/features/hq/ui/fmt";
import { Chip, Head, Stat } from "@/features/hq/ui/kit";
import { loadPage, type SP } from "@/features/hq/ui/load";
import { SalesFeedMissing } from "@/features/hq/ui/setup";
import { HqShell, Period } from "@/features/hq/ui/shell";
import { RowTable } from "@/features/hq/ui/table";
import { CAMPAIGN_LABEL } from "@/features/hq/domain/meta";
import "@/features/hq/hq.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Marketing · EPIK HQ" };

export default async function Marketing({ searchParams }: { searchParams: SP }) {
  const { data } = await loadPage(searchParams);
  if (!data) return <HqShell current="marketing"><SalesFeedMissing /></HqShell>;
  const { d } = data, n = d.now, b = d.before;
  return (
    <HqShell current="marketing" range={d.range}>
      <Period range={d.range} ranges={d.ranges} path="/hq/marketing" at={data.at} stale={data.stale} lastSale={d.lastSaleDay} lastAd={d.lastAdDay} />
      <div className="hq-grid" style={{ margin: "16px 0" }}>
        <div className="c-3"><Stat label="Meta spend" value={inr(n.spend)} chip={<Chip now={n.spend} before={b.spend} invert />} sub={`${pct(n.nmv ? n.spend / n.nmv : null, 1)} of NMV`} tone="dark" /></div>
        <div className="c-3"><Stat label="CAC" value={inr(n.cac)} chip={<Chip now={n.cac} before={b.cac} invert />} sub={`${int(n.newCustomers)} new customers`} tone="coral" /></div>
        <div className="c-3"><Stat label="ROAS" value={n.roas == null ? "—" : `${n.roas.toFixed(1)}×`} chip={<Chip now={n.roas} before={b.roas} />} sub="NMV ÷ Meta spend" /></div>
        <div className="c-3"><Stat label="Cost per demo" value={inr(n.costPerDemo)} sub={`${int(n.demos)} demos · ${pct(n.demoConversion, 1)} became sales`} /></div>
        <section className="hq-card c-12"><Head title="Meta spend per day" /><DayBars points={d.daily.map((x) => ({ day: x.day, v: x.spend }))} colour="#16140f" /></section>
        <section className="hq-card c-12">
          <Head title="By campaign" sub="CAC and ROAS per campaign, against the SMB category it sells" />
          <div className="hq-table-wrap">
            <table className="hq-table">
              <thead><tr><th>Campaign</th><th>Category</th><th className="n">Spend</th><th className="n">Demos</th><th className="n">New customers</th><th className="n">CAC</th><th className="n">NMV</th><th className="n">ROAS</th></tr></thead>
              <tbody>{d.campaigns.map((c) => <tr key={c.campaign}><td style={{ fontWeight: 600 }}>{CAMPAIGN_LABEL[c.campaign] ?? c.campaign}</td><td>{c.category}</td><td className="n">{inr(c.spend)}</td><td className="n">{int(c.demos)}</td><td className="n">{int(c.newCustomers)}</td><td className="n">{inr(c.cac)}</td><td className="n">{inr(c.nmv)}</td><td className="n">{c.roas == null ? "—" : `${c.roas.toFixed(1)}×`}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="hq-note" style={{ marginTop: 10 }}>Campaign → category: Home = Robo Vaccum, Mobile = Phones, AP = Air Purifier, AF and Kitchen = Kitchen. Spend is Meta only (the Getepik Tracker).</p>
        </section>
        <section className="hq-card c-12"><Head title="By sale source" sub="Demo, virtual demo, direct, referral…" /><RowTable rows={d.bySource} first="Source" /></section>
      </div>
    </HqShell>
  );
}

import type { Metadata } from "next";
import { DayBars } from "@/features/hq/ui/charts";
import { inr, int, pct } from "@/features/hq/ui/fmt";
import { Chip, Head, Stat } from "@/features/hq/ui/kit";
import { loadPage, type SP } from "@/features/hq/ui/load";
import { SalesFeedMissing } from "@/features/hq/ui/setup";
import { HqShell, Period } from "@/features/hq/ui/shell";
import { RowTable } from "@/features/hq/ui/table";
import "@/features/hq/hq.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Unit economics · EPIK HQ" };

export default async function Economics({ searchParams }: { searchParams: SP }) {
  const { data } = await loadPage(searchParams);
  if (!data) return <HqShell current="economics"><SalesFeedMissing /></HqShell>;
  const { d } = data, n = d.now, b = d.before;
  return (
    <HqShell current="economics" range={d.range}>
      {!data.hasSales ? <SalesFeedMissing /> : null}
      <Period range={d.range} ranges={d.ranges} path="/hq/economics" at={data.at} stale={data.stale} lastSale={d.lastSaleDay} lastAd={d.lastAdDay} />
      <div className="hq-grid" style={{ margin: "16px 0" }}>
        <div className="c-3"><Stat label="GMV (list, incl. GST)" value={inr(n.gmv)} chip={<Chip now={n.gmv} before={b.gmv} />} sub={`Discount ${inr(n.discount)} (${pct(n.discountPct, 1)})`} /></div>
        <div className="c-3"><Stat label="NMV" value={inr(n.nmv)} chip={<Chip now={n.nmv} before={b.nmv} />} sub={`${inr(n.nmvExcl)} excl. GST`} tone="coral" /></div>
        <div className="c-3"><Stat label="COGS (excl. GST)" value={inr(n.cogs)} sub={n.awaitingCostOrders ? `${int(n.awaitingCostOrders)} orders (${inr(n.awaitingCostNmv)}) have no cost yet` : "Every order has a cost"} /></div>
        <div className="c-3"><Stat label="Net margin" value={inr(n.nm)} chip={<Chip now={n.nm} before={b.nm} />} sub={`NM ${pct(n.nmPct, 1)} · after ads ${data.hasSales ? inr(n.nmAfterAds) : "—"} (${pct(n.nmAfterAdsPct, 1)})`} tone="dark" /></div>
        <section className="hq-card c-12">
          <Head title="Net margin per day" sub="NMV excl. GST − COGS excl. GST, orders with a cost" />
          <DayBars points={d.daily.map((x) => ({ day: x.day, v: x.nm }))} colour="#1f9d63" />
        </section>
        <section className="hq-card c-12" id="categories"><Head title="By category" sub="Where the money and the margin come from" /><RowTable rows={d.byCategory} first="Category" /></section>
        <section className="hq-card c-6"><Head title="By brand" /><RowTable rows={d.byBrand.slice(0, 15)} first="Brand" /></section>
        <section className="hq-card c-6"><Head title="By hub" /><RowTable rows={d.byHub} first="Hub" /></section>
      </div>
    </HqShell>
  );
}

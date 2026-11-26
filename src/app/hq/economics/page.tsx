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
export const metadata: Metadata = { title: "Unit economics · EPIK HQ" };

export default async function Economics({ searchParams }: { searchParams: SP }) {
  const { data } = await loadPage(searchParams);
  if (!data) return <HqShell current="economics"><SalesFeedMissing /></HqShell>;
  const { d } = data, n = d.now, b = d.before;
  return (
    <HqShell current="economics" d={d} at={data.at} stale={data.stale}>
      {!data.hasSales ? <SalesFeedMissing /> : null}
      <div className="hq-kpis" style={{ "--n": 6 } as CSSProperties}>
        <Kpi label="GMV, list price" value={inr(n.gmv)} chip={<Chip now={n.gmv} before={b.gmv} />} sub="Before discount, incl. GST" />
        <Kpi label="Discount" value={pct(n.discountPct, 1)} chip={<Chip now={n.discountPct} before={b.discountPct} invert />} sub={`${inr(n.discount)} given away`} />
        <Kpi label="NMV" value={inr(n.nmv)} chip={<Chip now={n.nmv} before={b.nmv} />} sub={`${inr(n.nmvExcl)} ex GST · AOV ${inr(n.aov)}`} tone="coral" />
        <Kpi label="COGS, ex GST" value={inr(n.cogs)} sub={n.awaitingCostOrders ? `${int(n.awaitingCostOrders)} orders (${inr(n.awaitingCostNmv)}) not costed yet` : "Every order costed"} />
        <Kpi label="Net margin" value={pct(n.nmPct, 1)} chip={<Chip now={n.nmPct} before={b.nmPct} />} sub={`${inr(n.nm)} on costed orders`} />
        <Kpi label="NM after ads" value={data.hasSales ? inr(n.nmAfterAds) : "—"} sub={`${pct(n.nmAfterAdsPct, 1)} · Meta spend ${inr(n.spend)}`} tone="dark" />
      </div>
      <div className="hq-screen" style={{ "--rows": "minmax(0, 1fr) minmax(0, 1fr)" } as CSSProperties}>
        <section className="hq-card c-5">
          <Head title="Net margin per day" sub="NMV ex GST − COGS ex GST, costed orders" />
          <DayBars points={d.daily.map((x) => ({ day: x.day, v: x.nm }))} colour="#1f9d63" tip={(i) => { const x = d.daily[i]; return `${day(x.day)}\nNM ${inr(x.nm)}\nNMV ${inr(x.nmv)} · ${x.orders} orders`; }} />
        </section>
        <section className="hq-card c-7"><Head title="By category" sub="Where the money and the margin come from" /><div className="hq-fill"><RowTable rows={d.byCategory} first="Category" /></div></section>
        <section className="hq-card c-7"><Head title="By brand" /><div className="hq-fill"><RowTable rows={d.byBrand} first="Brand" /></div></section>
        <section className="hq-card c-5"><Head title="By hub" /><div className="hq-fill"><RowTable rows={d.byHub} first="Hub" compact /></div></section>
      </div>
    </HqShell>
  );
}

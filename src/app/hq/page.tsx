import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { DayBars, Segments, ShareBars, Spark } from "@/features/hq/ui/charts";
import { day, inr, int, pct } from "@/features/hq/ui/fmt";
import { Chip, Head, Kpi } from "@/features/hq/ui/kit";
import { loadPage, type SP } from "@/features/hq/ui/load";
import { SalesFeedMissing } from "@/features/hq/ui/setup";
import { HqShell } from "@/features/hq/ui/shell";
import "@/features/hq/hq.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "EPIK HQ" };

const TONE = { good: "#1f9d63", move: "#4a6cf7", wait: "#e0a020", bad: "#d64545", quiet: "#c9c5bb" } as const;
const x1 = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}×`);

export default async function HqOverview({ searchParams }: { searchParams: SP }) {
  const { data, r } = await loadPage(searchParams);
  if (!data) return <HqShell current="overview"><SalesFeedMissing detail="Neither sheet could be read" /></HqShell>;
  const { d } = data;
  const n = d.now, b = d.before, del = d.delivery;
  const q = r === "mtd" ? "" : `?r=${r}`;
  const sales = data.states.find((s) => s.id === "sales");
  const steps = [
    { label: "GMV (list)", v: n.gmv, c: "#16140f", total: true },
    { label: "− Discount", v: -n.discount, c: "#d9d5cc" },
    { label: "− GST", v: -(n.nmv - n.nmvExcl), c: "#d9d5cc" },
    { label: "NMV (ex GST)", v: n.nmvExcl, c: "#f2643a", total: true },
    ...(n.awaitingCostOrders ? [{ label: "− No cost yet", v: -n.awaitingCostNmvExcl, c: "#ebe8e1" }] : []),
    { label: "− COGS", v: -n.cogs, c: "#d9d5cc" },
    { label: "Net margin", v: n.nm, c: "#1f9d63", total: true },
    { label: "− Meta spend", v: -n.spend, c: "#d9d5cc" },
    { label: "NM after ads", v: n.nmAfterAds, c: n.nmAfterAds >= 0 ? "#1f9d63" : "#d64545", total: true },
  ];
  const maxStep = Math.max(1, ...steps.map((s) => Math.abs(s.v)));
  const cash = n.paid + n.balance;

  return (
    <HqShell current="overview" d={d} at={data.at} stale={data.stale}>
      {!data.hasSales ? <SalesFeedMissing detail={sales?.detail} /> : null}

      <div className="hq-kpis">
        <Kpi label="NMV, incl. GST" value={inr(n.nmv)} chip={<Chip now={n.nmv} before={b.nmv} />} sub={`${int(n.orders)} orders`} tone="coral" href={`/hq/economics${q}`}>
          <Spark values={d.daily.map((x) => x.nmv)} />
        </Kpi>
        <Kpi label="GMV, list price" value={inr(n.gmv)} chip={<Chip now={n.gmv} before={b.gmv} />} sub={`AOV ${inr(n.aov)} · disc. ${pct(n.discountPct, 1)}`} href={`/hq/economics${q}`} />
        <Kpi label="Net margin" value={pct(n.nmPct, 1)} chip={<Chip now={n.nmPct} before={b.nmPct} />} sub={`${inr(n.nm)} on NMV ex GST`} href={`/hq/economics${q}`} />
        <Kpi label="NM after ads" value={data.hasSales ? inr(n.nmAfterAds) : "—"} chip={data.hasSales ? <Chip now={n.nmAfterAds} before={b.nmAfterAds} /> : null} sub={`${pct(n.nmAfterAdsPct, 1)} of NMV ex GST`} tone="dark" href={`/hq/economics${q}`} />
        <Kpi label="Meta spend" value={inr(n.spend)} chip={<Chip now={n.spend} before={b.spend} invert />} sub={`${int(n.demos)} demos · ${pct(n.nmv ? n.spend / n.nmv : null, 1)} of NMV`} href={`/hq/marketing${q}`} />
        <Kpi label="CAC" value={inr(n.cac)} chip={<Chip now={n.cac} before={b.cac} invert />} sub={`${int(n.newCustomers)} new customers`} href={`/hq/marketing${q}`} />
        <Kpi label="ROAS" value={x1(n.roas)} chip={<Chip now={n.roas} before={b.roas} />} sub="NMV per ₹1 spent" href={`/hq/marketing${q}`} />
        <Kpi label="Delivered" value={pct(del.deliveredPct)} sub={`${del.avgDays ?? "—"} days · ${int(del.pending)} open`} href={`/hq/delivery${q}`} />
      </div>

      <div className="hq-screen" style={{ "--rows": "minmax(0, 1.05fr) minmax(0, 1fr)" } as CSSProperties}>
        <section className="hq-card c-8">
          <Head title="NMV per day" sub={`${d.range.label}, incl. GST · hover a day for orders, margin and spend`} href={`/hq/economics${q}`} />
          <DayBars points={d.daily.map((x) => ({ day: x.day, v: x.nmv }))} tip={(i) => { const x = d.daily[i]; return `${day(x.day)}\nNMV ${inr(x.nmv)} · ${x.orders} orders\nNM ${inr(x.nm)} · Meta ${inr(x.spend)}`; }} />
        </section>

        <section className="hq-card c-4">
          <Head title="From GMV to what we keep" sub={n.awaitingCostOrders ? `${int(n.awaitingCostOrders)} orders not costed by finance yet` : "Unit economics"} href={`/hq/economics${q}`} />
          <div className="hq-steps hq-fill">
            {steps.map((s) => (
              <div key={s.label} className={`hq-step${s.total ? " is-total" : ""}`}>
                <span>{s.label}</span>
                <span className="track"><i style={{ left: 0, width: `${(Math.abs(s.v) / maxStep) * 100}%`, background: s.c }} /></span>
                <b style={{ color: s.total ? undefined : "var(--muted)" }}>{inr(s.v)}</b>
              </div>
            ))}
          </div>
        </section>

        <section className="hq-card c-3">
          <Head title="By category" sub={`Top 4 of ${d.byCategory.length} · NMV, share, NM %`} href={`/hq/economics${q}`} />
          <div className="hq-fill"><ShareBars rows={d.byCategory.map((c) => ({ label: c.key, value: c.nmv, share: c.share, note: `${Math.round(c.share * 100)}% · NM ${pct(c.nmPct, 1)}` }))} max={4} /></div>
        </section>

        <section className="hq-card c-3">
          <Head title="Top CDEs" sub={`Top 4 of ${d.byCde.length} by NMV`} href={`/hq/team${q}`} />
          <div className="hq-list hq-fill">
            {d.byCde.slice(0, 4).map((c, i) => (
              <div key={c.key}><span style={{ minWidth: 0 }}><strong><span className="hq-rank">{i + 1}</span>{c.key}</strong><small style={{ paddingLeft: 28 }}>{c.orders} orders · NM {pct(c.nmPct, 1)}</small></span><b>{inr(c.nmv)}</b></div>
            ))}
          </div>
        </section>

        <section className="hq-card c-3">
          <Head title="Delivery and cash" sub={`${int(del.pending)} open · ${int(n.cancelledOrders)} cancelled`} href={`/hq/delivery${q}`} />
          <div className="hq-fill" style={{ display: "grid", gap: 10, alignContent: "start" }}>
            <Segments parts={del.statuses.map((s) => ({ label: s.label, value: s.orders, colour: TONE[s.tone] }))} legend={4} />
            <div className="hq-list">
              <div><span><strong>Collected</strong><small>{pct(cash ? n.paid / cash : null)} of order value</small></span><b>{inr(n.paid)}</b></div>
              <div><span><strong>To collect</strong><small>Balance pending</small></span><b>{inr(n.balance)}</b></div>
            </div>
          </div>
        </section>

        <section className="hq-card is-coral c-3">
          <Head title="Insights" sub="From today's numbers" />
          <ol className="hq-insights hq-fill">{d.insights.slice(0, 4).map((t, i) => <li key={i}>{t}</li>)}</ol>
        </section>
      </div>

      <p className="hq-foot">Since 1 Nov 2026 · cancelled, refunded and not confirmed orders left out · <Link href="/hq/admin">every total ties to the sheets</Link></p>
    </HqShell>
  );
}

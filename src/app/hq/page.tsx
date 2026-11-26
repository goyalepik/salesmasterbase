import type { Metadata } from "next";
import Link from "next/link";
import { DayBars, Ring, Segments, ShareBars } from "@/features/hq/ui/charts";
import { HqAsk } from "@/features/hq/ui/ask";
import { inr, int, pct } from "@/features/hq/ui/fmt";
import { Chip, Head } from "@/features/hq/ui/kit";
import { loadPage, type SP } from "@/features/hq/ui/load";
import { SalesFeedMissing } from "@/features/hq/ui/setup";
import { HqShell, Period } from "@/features/hq/ui/shell";
import "@/features/hq/hq.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "EPIK HQ" };

const TONE = { good: "#1f9d63", move: "#4a6cf7", wait: "#e0a020", bad: "#d64545", quiet: "#c9c5bb" } as const;

export default async function HqOverview({ searchParams }: { searchParams: SP }) {
  const { data, r } = await loadPage(searchParams);
  if (!data) return <HqShell current="overview"><SalesFeedMissing detail="Neither sheet could be read" /></HqShell>;
  const { d } = data;
  const n = d.now, b = d.before;
  const sales = data.states.find((s) => s.id === "sales");
  const steps = [
    { label: "GMV (list)", v: n.gmv, c: "#16140f" },
    { label: "− Discount", v: -n.discount, c: "#c9c5bb" },
    { label: "− GST", v: -(n.nmv - n.nmvExcl), c: "#c9c5bb" },
    { label: "NMV (ex GST)", v: n.nmvExcl, c: "#f2643a" },
    ...(n.awaitingCostOrders ? [{ label: "− No cost yet", v: -n.awaitingCostNmvExcl, c: "#e8e4da" }] : []),
    { label: "− COGS", v: -n.cogs, c: "#c9c5bb" },
    { label: "NM", v: n.nm, c: "#1f9d63" },
    { label: "− Meta spend", v: -n.spend, c: "#c9c5bb" },
    { label: "NM after ads", v: n.nmAfterAds, c: n.nmAfterAds >= 0 ? "#1f9d63" : "#d64545" },
  ];
  const maxStep = Math.max(1, ...steps.map((s) => Math.abs(s.v)));
  const q = r === "mtd" ? "" : `?r=${r}`;

  return (
    <HqShell current="overview" range={d.range}>
      {!data.hasSales ? <SalesFeedMissing detail={sales?.detail} /> : null}
      <div className="hq-hero">
        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <Period range={d.range} ranges={d.ranges} path="/hq" at={data.at} stale={data.stale} lastSale={d.lastSaleDay} lastAd={d.lastAdDay} />
          <div className="hq-card is-coral" style={{ display: "grid", gap: 8 }}>
            <Head title="NMV" sub="What customers paid, incl. GST" pill={<span className="hq-pill">{int(n.orders)} orders</span>} />
            <div className="hq-row"><span className="hq-big" style={{ fontSize: 52 }}>{inr(n.nmv)}</span><Chip now={n.nmv} before={b.nmv} /></div>
            <span className="hq-label">GMV {inr(n.gmv)} · discount {pct(n.discountPct, 1)} · AOV {inr(n.aov)}</span>
          </div>
        </div>
        <HqAsk range={r} />
      </div>

      <div className="hq-grid" style={{ marginBottom: 16 }}>
        <div className="hq-card c-3" style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Ring value={n.nmPct} label="NM %" />
          <div style={{ display: "grid", gap: 4 }}><span className="hq-label">Net margin</span><span className="hq-mid">{inr(n.nm)}</span><Chip now={n.nmPct} before={b.nmPct} /></div>
        </div>
        <div className="hq-card c-3" style={{ display: "grid", gap: 8 }}>
          <span className="hq-label">CAC (Meta)</span>
          <div className="hq-row"><span className="hq-big">{inr(n.cac)}</span><Chip now={n.cac} before={b.cac} invert /></div>
          <span className="hq-label">{inr(n.spend)} spend · {int(n.newCustomers)} new customers</span>
        </div>
        <div className="hq-card c-3" style={{ display: "grid", gap: 8 }}>
          <span className="hq-label">ROAS</span>
          <div className="hq-row"><span className="hq-big">{n.roas == null ? "—" : `${n.roas.toFixed(1)}×`}</span><Chip now={n.roas} before={b.roas} /></div>
          <span className="hq-label">NMV per ₹1 of Meta spend</span>
        </div>
        <div className="hq-card is-dark c-3" style={{ display: "grid", gap: 8 }}>
          <span className="hq-label">NM after ads</span>
          <div className="hq-row"><span className="hq-big">{data.hasSales ? inr(n.nmAfterAds) : "—"}</span>{data.hasSales ? <Chip now={n.nmAfterAds} before={b.nmAfterAds} /> : null}</div>
          <span className="hq-label">{pct(n.nmAfterAdsPct, 1)} of NMV (ex GST)</span>
        </div>

        <section className="hq-card c-8">
          <Head title="NMV per day" sub={`${d.range.label} · incl. GST`} href={`/hq/economics${q}`} />
          <DayBars points={d.daily.map((x) => ({ day: x.day, v: x.nmv }))} />
        </section>
        <section className="hq-card is-coral c-4">
          <Head title="Insights" sub="From today's numbers" />
          <ol className="hq-insights">{d.insights.slice(0, 6).map((t, i) => <li key={i}>{t}</li>)}</ol>
        </section>

        <section className="hq-card c-7">
          <Head title="From GMV to what we keep" sub={n.awaitingCostOrders ? `${int(n.awaitingCostOrders)} orders have no cost from finance yet, so no margin` : "Unit economics for the period"} href={`/hq/economics${q}`} />
          <div className="hq-steps">
            {steps.map((s) => (
              <div key={s.label} className="hq-step">
                <span>{s.label}</span>
                <span className="track"><i style={{ left: 0, width: `${(Math.abs(s.v) / maxStep) * 100}%`, background: s.c }} /></span>
                <b style={{ color: s.v < 0 ? "var(--muted)" : undefined }}>{inr(s.v)}</b>
              </div>
            ))}
          </div>
        </section>
        <section className="hq-card c-5">
          <Head title="By category" sub="NMV, share and NM %" href={`/hq/economics${q}#categories`} />
          <ShareBars rows={d.byCategory.map((c) => ({ label: c.key, value: c.nmv, share: c.share, note: `${Math.round(c.share * 100)}% · NM ${pct(c.nmPct, 1)}` }))} />
        </section>

        <section className="hq-card c-4">
          <Head title="Top CDEs" sub="By NMV" href={`/hq/team${q}`} />
          <div className="hq-list">{d.byCde.slice(0, 5).map((c) => <div key={c.key}><span style={{ minWidth: 0 }}><strong>{c.key}</strong><small>{c.orders} orders · NM {pct(c.nmPct, 1)}</small></span><b>{inr(c.nmv)}</b></div>)}</div>
        </section>
        <section className="hq-card c-4">
          <Head title="Delivery" sub={`${pct(d.delivery.deliveredPct)} delivered · ${d.delivery.avgDays ?? "—"} days on average`} href={`/hq/delivery${q}`} />
          <Segments parts={d.delivery.statuses.map((s) => ({ label: s.label, value: s.orders, colour: TONE[s.tone] }))} />
          <p className="hq-note" style={{ marginTop: 12 }}>{int(d.delivery.pending)} orders not delivered yet · {int(n.cancelledOrders)} cancelled · {int(n.notConfirmedOrders)} not confirmed</p>
        </section>
        <section className="hq-card c-4">
          <Head title="Customers" sub={`${pct(n.repeatPct)} repeat`} href={`/hq/customers${q}`} />
          <Segments parts={[{ label: "New", value: n.newCustomers, colour: "#f2643a" }, { label: "Repeat", value: n.repeatCustomers, colour: "#16140f" }]} />
          <div className="hq-list" style={{ marginTop: 10 }}>
            <div><span><strong>Collected</strong><small>Amount paid</small></span><b>{inr(n.paid)}</b></div>
            <div><span><strong>Pending</strong><small>Balance to collect</small></span><b>{inr(n.balance)}</b></div>
          </div>
        </section>
      </div>
      <p className="hq-foot">Live from the Sales Masterbase and the Meta ad tracker, since 1 Nov 2026. Cancelled, refunded and not confirmed orders are left out. <Link href="/hq/admin" className="underline">How each number is calculated</Link></p>
    </HqShell>
  );
}

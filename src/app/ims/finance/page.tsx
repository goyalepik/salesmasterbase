import type { Metadata } from "next";
import Link from "next/link";
import { CATEGORY_COLOURS } from "@/features/ims/domain/categories";
import { Bars, CategoryDonut, MonthBars } from "@/features/ims/ui/charts";
import { money, units } from "@/features/ims/ui/format";
import { CardHead, Kpi } from "@/features/ims/ui/kit";
import { loadPage, type SearchParams } from "@/features/ims/ui/load";
import { ImsShell } from "@/features/ims/ui/shell";
import { ImsUnavailable } from "@/features/ims/ui/unavailable";
import "@/features/ims/ims.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Finance · Inventory · EPIK" };

export default async function ImsFinance({ searchParams }: { searchParams: SearchParams }) {
  const { data, role } = await loadPage(searchParams);
  if (!data) return <ImsUnavailable role={role} current="finance" />;
  const s = data.snapshot;
  const f = s.finance;

  return (
    <ImsShell current="finance" role={role} readAt={data.readAt} stale={data.stale}>
      <div className="ims-head">
        <div>
          <h1>Inventory finance</h1>
          <p>The money in stock and how it moves, at cost incl. GST, from the Masterbase, the Inward Sheet and the Tracker. No sale prices or margins.</p>
        </div>
      </div>

      <div className="ims-grid" style={{ marginBottom: 14 }}>
        <div className="span-3"><Kpi label="Money in stock" value={money(f.stockValue)} chip={{ now: f.stockValue, before: s.kpis.valueAtStart }} sub={`${money(f.cncValue)} bought · ${money(f.sorValue)} SOR (vendor's until sold)`} /></div>
        <div className="span-3"><Kpi label="Days of stock" value={f.daysOfStock == null ? "—" : `${f.daysOfStock}`} sub={`At the last 30 days' pace · ${f.turns ?? "—"} turns a year`} /></div>
        <div className="span-3"><Kpi label="Older than 90 days" value={money(f.agedValue)} sub={f.stockValue ? `${Math.round((f.agedValue / f.stockValue) * 100)}% of stock value` : ""} href="/ims/stock?view=old" /></div>
        <div className="span-3"><Kpi label="Not moving" value={money(f.deadValue)} sub={`${f.deadSkus} products: in 90+ days, nothing sold in 90 days`} href="/ims/stock?view=dead" /></div>
      </div>

      <div className="ims-grid" style={{ marginBottom: 14 }}>
        <section className="ims-card span-8">
          <CardHead title="Money in vs out" sub="Received and dispatched at cost, by month" />
          <MonthBars months={f.months} />
          <div className="ims-table-wrap" style={{ marginTop: 12 }}>
            <table className="ims-table">
              <thead><tr><th>Month</th><th className="n">Received</th><th className="n">Dispatched</th><th className="n">Net change</th><th className="n">Units in / out</th><th className="n">Sold of that month&apos;s arrivals</th></tr></thead>
              <tbody>
                {f.months.map((m) => (
                  <tr key={m.month}>
                    <td>{m.label}</td>
                    <td className="n">{money(m.receivedCost)}</td>
                    <td className="n">{money(m.dispatchedCost)}</td>
                    <td className="n" style={{ color: m.net > 0 ? "var(--warn)" : "var(--good)" }}>{m.net > 0 ? "+" : ""}{money(m.net)}</td>
                    <td className="n">{units(m.receivedUnits)} / {units(m.dispatchedUnits)}</td>
                    <td className="n">{m.sellThrough == null ? "—" : `${m.sellThrough}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="ims-card span-4" id="categories">
          <CardHead title="By category" sub="Where the money sits" />
          <CategoryDonut rows={s.categories} total={f.stockValue} />
        </section>
      </div>

      <div className="ims-grid" style={{ marginBottom: 14 }}>
        <section className="ims-card span-6">
          <CardHead title="Category detail" sub="Value, share and how long it lasts" />
          <div className="ims-table-wrap">
            <table className="ims-table">
              <thead><tr><th>Category</th><th className="n">Value</th><th className="n">Share</th><th className="n">Units</th><th className="n">Sold 30d</th><th className="n">Lasts</th></tr></thead>
              <tbody>
                {s.categories.map((c) => (
                  <tr key={c.category}>
                    <td><Link href={`/ims/stock?cat=${encodeURIComponent(c.category)}`} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><i style={{ width: 9, height: 9, borderRadius: 3, background: CATEGORY_COLOURS[c.category] }} />{c.category}</Link></td>
                    <td className="n">{money(c.value)}</td>
                    <td className="n">{f.stockValue ? `${Math.round((c.value / f.stockValue) * 100)}%` : "—"}</td>
                    <td className="n">{units(c.units)}</td>
                    <td className="n">{units(c.out30)}</td>
                    <td className="n">{c.cover == null ? "—" : `${Math.min(c.cover, 365)}${c.cover > 365 ? "+" : ""} d`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="ims-card span-6">
          <CardHead title="Bought from" sub="Top vendors by value received, last 90 days" />
          <Bars rows={f.vendors.map((v) => ({ label: v.vendor, value: v.value, text: money(v.value) }))} />
          <div style={{ marginTop: 18 }}>
            <CardHead title="Billed to" sub="Received value by company, last 90 days" />
            <Bars rows={f.billedTo.map((b) => ({ label: b.entity, value: b.value, text: money(b.value) }))} colour="#22d3ee" />
          </div>
        </section>
      </div>

      <div className="ims-grid">
        <section className="ims-card span-4">
          <CardHead title="Where it sits" sub="Value by hub" />
          <Bars rows={f.byHub.map((h) => ({ label: h.hub, value: h.value, text: `${money(h.value)} · ${units(h.units)}` }))} colour="#34d399" />
        </section>
        <section className="ims-card span-4">
          <CardHead title="Most cash tied up" sub="Top 10 products by value" />
          <div className="ims-list">{f.topCash.map((p) => <Link key={p.sku} href={`/ims/stock/${encodeURIComponent(p.sku)}`}><span style={{ minWidth: 0 }}><strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</strong><small>{p.inStock} units · {p.out30} sold in 30 days</small></span><b>{money(p.value)}</b></Link>)}</div>
        </section>
        <section className="ims-card span-4">
          <CardHead title="Slow movers" sub="Most value with no sale in 30 days" />
          <div className="ims-list">{f.slowMovers.map((p) => <Link key={p.sku} href={`/ims/stock/${encodeURIComponent(p.sku)}`}><span style={{ minWidth: 0 }}><strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</strong><small>{p.inStock} units{p.avgAge != null ? ` · ${p.avgAge} days old` : " · opening stock"}</small></span><b>{money(p.value)}</b></Link>)}</div>
        </section>
      </div>
      <p className="ims-foot">Cost of goods dispatched in the last 30 days: {money(f.costOfDispatch30)}. The Tracker values its own count at {money(f.trackerValue)}.</p>
    </ImsShell>
  );
}

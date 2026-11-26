import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Boxes, IndianRupee, Sparkles } from "lucide-react";
import { cachedInsight } from "@/features/ims/chat";
import type { Snapshot } from "@/features/ims/domain/model";
import { AskHero } from "@/features/ims/ui/ask-panel";
import { ActivityHeat, CategoryDonut, Gauge, TrendArea } from "@/features/ims/ui/charts";
import { day, money, units } from "@/features/ims/ui/format";
import { CardHead, Kpi } from "@/features/ims/ui/kit";
import { loadPage, type SearchParams } from "@/features/ims/ui/load";
import { ImsShell } from "@/features/ims/ui/shell";
import { ImsUnavailable } from "@/features/ims/ui/unavailable";
import "@/features/ims/ims.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Inventory · EPIK" };

async function Insight({ s }: { s: Snapshot }) {
  const text = await cachedInsight(s);
  return <p>{text ?? `${units(s.kpis.unitsInStock)} units worth ${money(s.kpis.stockValue)} are in stock; ${s.attention[0]?.title.toLowerCase() ?? "nothing needs attention"}.`}</p>;
}

export default async function ImsOverview({ searchParams }: { searchParams: SearchParams }) {
  const { data, role, r } = await loadPage(searchParams);
  if (!data) return <ImsUnavailable role={role} current="overview" />;
  const s = data.snapshot;
  const k = s.kpis;
  const recent = new Map<string, { on: string | null; vendor: string; units: number; value: number }>();
  for (const w of s.inwards.slice(0, 400)) {
    const key = `${w.on}|${w.invoice ?? w.vendor}`;
    const e = recent.get(key) ?? { on: w.on, vendor: w.vendor ?? "Vendor not filled", units: 0, value: 0 };
    e.units += w.qty;
    e.value += w.qty * w.cost;
    recent.set(key, e);
  }

  return (
    <ImsShell current="overview" role={role} readAt={data.readAt} stale={data.stale} range={r}>
      <div className="ims-head">
        <div>
          <h1>Inventory overview</h1>
          <p>{s.range.label} · {day(s.range.from)} to {day(s.range.to)} · live from the team sheets</p>
        </div>
      </div>

      <AskHero />

      <div className="ims-grid">
        <div className="span-3"><Kpi label="Stock value" icon={<IndianRupee size={15} />} value={money(k.stockValue)} chip={{ now: k.stockValue, before: k.valueAtStart }} sub={`At cost · ${money(s.finance.cncValue)} bought, ${money(s.finance.sorValue)} SOR`} href="/ims/finance" /></div>
        <div className="span-3"><Kpi label="Units in stock" icon={<Boxes size={15} />} value={units(k.unitsInStock)} sub={`${units(k.skusInStock)} products · ${s.categories.length} categories`} href="/ims/stock" /></div>
        <div className="span-3"><Kpi label="Received" icon={<ArrowDownToLine size={15} />} value={units(k.inUnits)} chip={{ now: k.inUnits, before: k.inUnitsPrev }} sub={`${money(k.inValue)} at cost · vs ${units(k.inUnitsPrev)} before`} href="/ims/stock-in" /></div>
        <div className="span-3"><Kpi label="Dispatched" icon={<ArrowUpFromLine size={15} />} value={units(k.outUnits)} chip={{ now: k.outUnits, before: k.outUnitsPrev }} sub={`${money(k.outValue)} at cost · vs ${units(k.outUnitsPrev)} before`} href="/ims/dispatch" /></div>

        <section className="ims-card span-8">
          <CardHead title="Stock value" sub="Last 90 days, rebuilt from every serial's in and out dates" href="/ims/finance" />
          <TrendArea points={s.history} />
        </section>
        <section className="ims-card span-4">
          <CardHead title="By category" sub="Value at cost" href="/ims/stock" />
          <CategoryDonut rows={s.categories} total={k.stockValue} />
        </section>

        <section className="ims-card ims-insight span-4">
          <span className="ims-insight-tag"><Sparkles size={13} /> Today&apos;s insight</span>
          <Suspense fallback={<p style={{ opacity: 0.6 }}>Reading today&apos;s numbers…</p>}>
            <Insight s={s} />
          </Suspense>
          <small>Written by AI from the live numbers. Ask for more with ⌘K.</small>
        </section>
        <section className="ims-card span-4">
          <CardHead title="Activity" sub="Units in and out per day, last 12 weeks" />
          <ActivityHeat days={s.activity} />
        </section>
        <section className="ims-card span-4">
          <CardHead title="Stock health" sub="Share of stock value that sold in the last 30 days and is under 90 days old" href="/ims/stock?view=dead" />
          <Gauge value={s.healthScore} label="healthy stock" />
          <p className="ims-note" style={{ textAlign: "center" }}>{money(s.finance.deadValue)} sits in {s.finance.deadSkus} products not moving</p>
        </section>

        <section className="ims-card span-6">
          <CardHead title="Needs attention" sub="Tap one for the list" />
          {s.attention.length ? (
            <div className="ims-list">
              {s.attention.map((a) => (
                <Link key={a.kind} href={a.href}>
                  <span style={{ minWidth: 0 }}><strong>{a.title}</strong><small>{a.detail}</small></span>
                  <span className={`ims-tag ${a.tone === "bad" ? "is-bad" : "is-warn"}`}>{a.tone === "bad" ? "Act now" : "Look"}</span>
                </Link>
              ))}
            </div>
          ) : <p className="ims-empty">All clear.</p>}
        </section>
        <section className="ims-card span-6">
          <CardHead title="Latest stock in" sub="From the Inward Sheet and bills added here" href="/ims/stock-in" />
          <div className="ims-list">
            {[...recent.values()].slice(0, 5).map((e, i) => (
              <div key={i}>
                <span style={{ minWidth: 0 }}><strong>{e.vendor}</strong><small>{day(e.on)} · {units(e.units)} unit{e.units === 1 ? "" : "s"}</small></span>
                <b style={{ fontVariantNumeric: "tabular-nums" }}>{money(e.value)}</b>
              </div>
            ))}
          </div>
        </section>
      </div>
      <p className="ims-foot">Money is inventory at cost incl. GST. {Math.round(k.costCoverage * 100)}% of units in stock have a cost ({units(k.costFilled)} filled from the Tracker&apos;s cost per unit or the product&apos;s other serials).</p>
    </ImsShell>
  );
}

import type { Metadata } from "next";
import { Segments } from "@/features/hq/ui/charts";
import { int, pct } from "@/features/hq/ui/fmt";
import { Head, Stat } from "@/features/hq/ui/kit";
import { loadPage, type SP } from "@/features/hq/ui/load";
import { SalesFeedMissing } from "@/features/hq/ui/setup";
import { HqShell, Period } from "@/features/hq/ui/shell";
import "@/features/hq/hq.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Delivery · EPIK HQ" };
const TONE = { good: "#1f9d63", move: "#4a6cf7", wait: "#e0a020", bad: "#d64545", quiet: "#c9c5bb" } as const;

export default async function Delivery({ searchParams }: { searchParams: SP }) {
  const { data } = await loadPage(searchParams);
  if (!data) return <HqShell current="delivery"><SalesFeedMissing /></HqShell>;
  const { d } = data, del = d.delivery;
  return (
    <HqShell current="delivery" range={d.range}>
      <Period range={d.range} ranges={d.ranges} path="/hq/delivery" at={data.at} stale={data.stale} lastSale={d.lastSaleDay} lastAd={d.lastAdDay} />
      <div className="hq-grid" style={{ margin: "16px 0" }}>
        <div className="c-4"><Stat label="Delivered" value={pct(del.deliveredPct)} sub="Of orders not cancelled" tone="coral" /></div>
        <div className="c-4"><Stat label="Days to deliver" value={del.avgDays == null ? "—" : `${del.avgDays}`} sub="Sale date to delivery date, average" /></div>
        <div className="c-4"><Stat label="Not delivered yet" value={int(del.pending)} sub="Orders still open" tone="dark" /></div>
        <section className="hq-card c-12">
          <Head title="Where orders are" sub="By the SMB's Logistic Status, one per order" />
          <Segments parts={del.statuses.map((s) => ({ label: s.label, value: s.orders, colour: TONE[s.tone] }))} />
          <div className="hq-list" style={{ marginTop: 14 }}>{del.statuses.map((s) => <div key={s.label}><span><strong>{s.label}</strong></span><span className={`hq-tag ${s.tone}`}>{int(s.orders)} orders</span></div>)}</div>
        </section>
      </div>
    </HqShell>
  );
}

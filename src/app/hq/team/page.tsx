import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { inr, int, pct } from "@/features/hq/ui/fmt";
import { Head, Kpi } from "@/features/hq/ui/kit";
import { loadPage, type SP } from "@/features/hq/ui/load";
import { SalesFeedMissing } from "@/features/hq/ui/setup";
import { HqShell } from "@/features/hq/ui/shell";
import { RowTable } from "@/features/hq/ui/table";
import "@/features/hq/hq.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Team · EPIK HQ" };

export default async function Team({ searchParams }: { searchParams: SP }) {
  const { data } = await loadPage(searchParams);
  if (!data) return <HqShell current="team"><SalesFeedMissing /></HqShell>;
  const { d } = data, n = d.now;
  const cdeNmv = d.byCde.reduce((s, c) => s + c.nmv, 0);
  const top = d.byCde[0];
  return (
    <HqShell current="team" d={d} at={data.at} stale={data.stale}>
      <div className="hq-kpis" style={{ "--n": 5 } as CSSProperties}>
        <Kpi label="CDEs selling" value={int(d.byCde.length)} sub={`${int(d.byHub.length)} hubs`} />
        <Kpi label="NMV from CDEs" value={inr(cdeNmv)} sub={`${pct(n.nmv ? cdeNmv / n.nmv : null)} of all NMV, rest is website`} tone="coral" />
        <Kpi label="NMV per CDE" value={inr(d.byCde.length ? cdeNmv / d.byCde.length : null)} sub="Average in the period" />
        <Kpi label="Top CDE" value={top?.key ?? "—"} sub={top ? `${inr(top.nmv)} · ${top.orders} orders` : ""} tone="dark" />
        <Kpi label="Best NM % (5+ orders)" value={(() => { const b = d.byCde.filter((c) => c.orders >= 5).sort((a, c) => (c.nmPct ?? -1) - (a.nmPct ?? -1))[0]; return b ? `${pct(b.nmPct, 1)}` : "—"; })()} sub={d.byCde.filter((c) => c.orders >= 5).sort((a, c) => (c.nmPct ?? -1) - (a.nmPct ?? -1))[0]?.key ?? ""} />
      </div>
      <div className="hq-screen">
        <section className="hq-card c-8"><Head title="CDEs" sub="Website orders (Shopify direct) are left out of this list" /><div className="hq-fill"><RowTable rows={d.byCde} first="CDE" /></div></section>
        <section className="hq-card c-4"><Head title="Hubs" /><div className="hq-fill"><RowTable rows={d.byHub} first="Hub" compact /></div></section>
      </div>
    </HqShell>
  );
}

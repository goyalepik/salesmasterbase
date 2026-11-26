import type { Metadata } from "next";
import { Head } from "@/features/hq/ui/kit";
import { loadPage, type SP } from "@/features/hq/ui/load";
import { SalesFeedMissing } from "@/features/hq/ui/setup";
import { HqShell, Period } from "@/features/hq/ui/shell";
import { RowTable } from "@/features/hq/ui/table";
import "@/features/hq/hq.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Team · EPIK HQ" };

export default async function Team({ searchParams }: { searchParams: SP }) {
  const { data } = await loadPage(searchParams);
  if (!data) return <HqShell current="team"><SalesFeedMissing /></HqShell>;
  const { d } = data;
  return (
    <HqShell current="team" range={d.range}>
      <Period range={d.range} ranges={d.ranges} path="/hq/team" at={data.at} stale={data.stale} lastSale={d.lastSaleDay} lastAd={d.lastAdDay} />
      <div className="hq-grid" style={{ margin: "16px 0" }}>
        <section className="hq-card c-12"><Head title="CDEs" sub="Website orders (Shopify direct) are left out of this list" /><RowTable rows={d.byCde} first="CDE" /></section>
        <section className="hq-card c-12"><Head title="Hubs" /><RowTable rows={d.byHub} first="Hub" /></section>
      </div>
    </HqShell>
  );
}

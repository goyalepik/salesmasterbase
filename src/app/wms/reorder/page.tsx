import Link from "next/link";
import { Kpi, Panel, TableWrap } from "@/components/ops/bits";
import { PageHeader } from "@/components/ui";
import { replenishment } from "@/features/wms/insights";
import { REORDER, REORDER_LABELS, type ReorderStatus } from "@/features/wms/domain/replenish";
import { loadWmsPage } from "@/features/wms/ui/load";
import { WmsNav, WmsOff } from "@/features/wms/ui/wms-nav";
import { firstParam } from "@/lib/query";
import { inr } from "@/lib/ops-ui/format";
import "@/features/wms/wms.css";

const TONE: Record<ReorderStatus, string> = { out_of_stock: "is-bad", reorder_now: "is-bad", approaching: "is-warn", healthy: "is-good", overstock: "is-warn", non_moving: "is-quiet", dead: "is-quiet" };

export default async function ReorderPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const page = await loadWmsPage();
  if (!page) return <WmsOff />;
  const want = firstParam((await searchParams).status) as ReorderStatus | "";
  const rows = await replenishment(page.ctx);
  const counts = new Map<ReorderStatus, number>();
  for (const r of rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  const shown = (want && REORDER_LABELS[want] ? rows.filter((r) => r.status === want) : rows).slice(0, 400);
  const reorderValue = rows.filter((r) => r.status === "reorder_now" || r.status === "out_of_stock").reduce((s, r) => s + (r.reorderValueMinor ?? 0), 0);

  return (
    <section>
      <PageHeader
        title="Reorder"
        description={`Days of stock from sales (customer dispatches, not replacements). Reorder now under ${REORDER.reorderNow} days of cover, soon under ${REORDER.approaching}, overstock over ${REORDER.overstock}. Suggested brings cover to ${REORDER.targetCover} days.`}
      />
      <WmsNav current="reorder" />
      <dl className="ops-grid-3 mb-3">
        <Kpi label="Out of stock" value={counts.get("out_of_stock") ?? 0} tone="bad" href="/wms/reorder?status=out_of_stock" />
        <Kpi label="Reorder now" value={counts.get("reorder_now") ?? 0} tone="bad" href="/wms/reorder?status=reorder_now" />
        <Kpi label="Reorder soon" value={counts.get("approaching") ?? 0} tone="warn" href="/wms/reorder?status=approaching" />
        <Kpi label="Overstock" value={counts.get("overstock") ?? 0} href="/wms/reorder?status=overstock" />
        <Kpi label="Dead stock" value={counts.get("dead") ?? 0} note={`No sale in ${REORDER.deadDays} days`} href="/wms/reorder?status=dead" />
        {page.showCost ? <Kpi label="To reorder now (cost)" value={inr(reorderValue)} /> : <Kpi label="Healthy" value={counts.get("healthy") ?? 0} />}
      </dl>
      <nav className="s-chips" aria-label="Filter">
        <Link href="/wms/reorder" aria-current={!want ? "page" : undefined}>All <span>{rows.length}</span></Link>
        {(Object.keys(REORDER_LABELS) as ReorderStatus[]).map((s) => (
          <Link key={s} href={`/wms/reorder?status=${s}`} aria-current={want === s ? "page" : undefined}>{REORDER_LABELS[s]} <span>{counts.get(s) ?? 0}</span></Link>
        ))}
      </nav>
      <Panel title={`${shown.length} products`} subtitle="Raise a PO from the Purchase orders tab with the suggested quantity.">
        <TableWrap minWidth={980}>
          <thead>
            <tr>
              <th>Product</th>
              <th className="num">In stock</th>
              <th className="num">On the way</th>
              <th className="num">Sold 7d</th>
              <th className="num">Sold 30d</th>
              <th className="num">Days of stock</th>
              <th className="num">Cover days</th>
              <th>Status</th>
              <th className="num">Suggested</th>
              {page.showCost ? <th className="num">Value</th> : null}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.sku}>
                <td><span className="wms-clamp-2 font-medium" title={r.name}>{r.name}</span><div className="wms-muted">{r.sku}{r.brand ? ` · ${r.brand}` : ""}{r.movement === "fast" ? " · fast mover" : ""}</div></td>
                <td className="num">{r.warehouse}</td>
                <td className="num">{r.inTransit}</td>
                <td className="num">{r.sold7}</td>
                <td className="num">{r.sold30}</td>
                <td className="num">{r.doh30 ?? "—"}</td>
                <td className="num">{r.cover ?? "—"}</td>
                <td><span className={`wms-badge ${TONE[r.status]}`}>{REORDER_LABELS[r.status]}</span></td>
                <td className="num font-semibold">{r.suggested || "—"}</td>
                {page.showCost ? <td className="num">{r.reorderValueMinor ? inr(r.reorderValueMinor) : "—"}</td> : null}
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Panel>
    </section>
  );
}

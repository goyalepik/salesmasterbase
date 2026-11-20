import Link from "next/link";
import { ClipboardPlus, PackageCheck } from "lucide-react";
import { Kpi, Panel } from "@/components/ops/bits";
import { PageHeader } from "@/components/ui";
import { listPos, stockOnHand } from "@/features/wms/service";
import { stockTotals } from "@/features/wms/domain/stock";
import { loadWmsPage } from "@/features/wms/ui/load";
import { WmsNav, WmsOff } from "@/features/wms/ui/wms-nav";
import { inr, shortWhen } from "@/lib/ops-ui/format";
import "@/features/wms/wms.css";

export default async function WarehouseHome() {
  const page = await loadWmsPage();
  if (!page) return <WmsOff />;
  const { ctx, actor, showCost, canRaisePo, canReceive } = page;
  const [stock, pos, grns] = await Promise.all([stockOnHand(ctx, actor), listPos(ctx), ctx.wms.listGrns({ limit: 8 })]);
  const t = stockTotals(stock.rows);
  const open = pos.filter((p) => p.open);
  const expected = open.reduce((s, p) => s + Math.max(0, p.ordered - p.received), 0);

  return (
    <section>
      <PageHeader title="Warehouse" description="Receive goods by scanning, find any unit by its serial, and see stock unit by unit." />
      <WmsNav current="home" />
      <div className="wms-actions">
        {canReceive ? (
          <Link href="/wms/receive" className="wms-big is-primary">
            <PackageCheck size={26} aria-hidden="true" />
            <span>Receive goods<small>Scan serials against a PO</small></span>
          </Link>
        ) : null}
        {canRaisePo ? (
          <Link href="/wms/po#new" className="wms-big">
            <ClipboardPlus size={26} aria-hidden="true" />
            <span>Raise a PO<small>Vendor, hub, products and prices</small></span>
          </Link>
        ) : null}
      </div>
      <dl className={`ops-grid-3 mb-3 ${showCost ? "" : ""}`}>
        <Kpi label="Units in the warehouse" value={t.onHand} href="/wms/stock" note="Received in these screens" />
        <Kpi label="Ready to sell" value={t.available} href="/wms/stock" />
        <Kpi label="On hold" value={t.onHold} tone={t.onHold ? "warn" : undefined} note="Damaged or defective on arrival" href="/wms/units?status=hold" />
        {showCost ? <Kpi label="Stock value (cost incl. GST)" value={inr(t.valueMinor)} note={t.noCost ? `${t.noCost} units have no cost yet` : undefined} href="/wms/stock" /> : null}
        <Kpi label="Open POs" value={open.length} href="/wms/po" />
        <Kpi label="Units expected" value={expected} href="/wms/receive" />
      </dl>
      <Panel title="Latest goods receipts" subtitle="Newest first.">
        {grns.length ? (
          <div className="wms-card-list">
            {grns.map((g) => (
              <Link key={g.number} href={`/wms/po/${encodeURIComponent(g.poNumber)}#${g.number}`} className="wms-card">
                <div className="wms-card-top">
                  <strong>{g.number}</strong>
                  <span className="wms-muted">{shortWhen(g.createdAt)}</span>
                </div>
                <span className="text-[13.5px]">
                  {g.lines.reduce((s, l) => s + l.received, 0)} units on {g.poNumber}
                  {g.vendor ? ` from ${g.vendor}` : ""}
                  {g.lines.some((l) => l.onHold) ? <> · <span className="text-warn">{g.lines.reduce((s, l) => s + l.onHold, 0)} on hold</span></> : null}
                </span>
                <span className="wms-muted">By {g.receivedBy}{g.invoiceNo ? ` · invoice ${g.invoiceNo}` : " · invoice not here yet"}</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-[14px] text-muted">Nothing received in these screens yet. Tap Receive goods to start.</p>
        )}
      </Panel>
    </section>
  );
}

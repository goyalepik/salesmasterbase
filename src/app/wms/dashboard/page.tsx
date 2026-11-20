import Link from "next/link";
import { Kpi, Panel, TableWrap } from "@/components/ops/bits";
import { PageHeader } from "@/components/ui";
import { dashboard } from "@/features/wms/insights";
import { loadWmsPage } from "@/features/wms/ui/load";
import { WmsNav, WmsOff } from "@/features/wms/ui/wms-nav";
import { inr } from "@/lib/ops-ui/format";
import "@/features/wms/wms.css";

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");

export default async function WmsDashboard() {
  const page = await loadWmsPage();
  if (!page) return <WmsOff />;
  const d = await dashboard(page.ctx, page.actor);
  const money = d.showCost;

  return (
    <section>
      <PageHeader title="Warehouse dashboard" description="Stock, today, health, age, buying, delivery, returns and data quality. Every number opens its list." />
      <p className="mb-3 flex flex-wrap gap-2 text-[13px]">
        Download (Excel):
        {["units", "shipments", "returns", "reorder"].map((k) => <a key={k} href={`/api/wms/export/${k}`} className="text-accent" download>{k}</a>)}
      </p>
      <WmsNav current="dashboard" />

      {d.attention.length ? (
        <Panel title="Needs attention" className="mb-3">
          <div className="wms-card-list">
            {d.attention.map((a) => (
              <Link key={a.text} href={a.href} className="wms-card">
                <span className={a.tone === "bad" ? "text-bad font-semibold" : "text-warn font-semibold"}>{a.text}</span>
              </Link>
            ))}
          </div>
        </Panel>
      ) : null}

      <h2 className="dashboard-panel-title mb-2">Stock</h2>
      <dl className="ops-grid-3 mb-3">
        <Kpi label="Units with serials here" value={d.units.onHand} href="/wms/stock" note={`${d.units.available} ready to sell · ${d.units.onHold} on hold`} />
        <Kpi label="All stock (ledger)" value={d.ledger.onHand} href="/inventory/stock" note={`${d.ledger.reserved} booked to orders · ${d.ledger.incoming} on the way`} />
        {money ? <Kpi label="Stock value (cost incl. GST)" value={inr(d.ledger.valueMinor)} note={`Units here: ${inr(d.units.valueMinor)}`} href="/wms/stock" /> : null}
      </dl>

      <h2 className="dashboard-panel-title mb-2">Today</h2>
      <dl className="ops-grid-3 mb-3">
        <Kpi label="Came in" value={d.today.inward} href="/wms/movements" />
        <Kpi label="Went out" value={d.today.dispatch} href="/wms/movements" />
        <Kpi label="Came back" value={d.today.returns} href="/wms/movements" />
      </dl>

      <h2 className="dashboard-panel-title mb-2">Stock health</h2>
      <dl className="ops-grid-3 mb-3">
        <Kpi label="Out of stock" value={d.health.out_of_stock} tone={d.health.out_of_stock ? "bad" : undefined} href="/wms/reorder?status=out_of_stock" />
        <Kpi label="Reorder now" value={d.health.reorder_now} tone={d.health.reorder_now ? "bad" : undefined} href="/wms/reorder?status=reorder_now" note={money ? `${inr(d.health.reorderValueMinor)} to order` : undefined} />
        <Kpi label="Reorder soon" value={d.health.approaching} href="/wms/reorder?status=approaching" />
        <Kpi label="Healthy" value={d.health.healthy} href="/wms/reorder?status=healthy" />
        <Kpi label="Overstock" value={d.health.overstock} href="/wms/reorder?status=overstock" />
        <Kpi label="Dead or not moving" value={d.health.dead + d.health.non_moving} href="/wms/reorder?status=dead" note={`${d.health.fast} fast movers`} />
      </dl>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Stock age" subtitle="Units with serials here, by days since they came in.">
          <TableWrap minWidth={320}>
            <thead><tr><th>Age</th><th className="num">Units</th>{money ? <th className="num">Value</th> : null}</tr></thead>
            <tbody>
              {d.ageing.map((a) => (
                <tr key={a.label}><td>{a.label}</td><td className="num">{a.units}</td>{money ? <td className="num">{inr(a.valueMinor)}</td> : null}</tr>
              ))}
            </tbody>
          </TableWrap>
        </Panel>
        <Panel title="Buying, delivery, returns">
          <dl className="wms-facts">
            <div><dt>Open POs</dt><dd><Link href="/wms/po" className="text-accent">{d.procurement.openPos}</Link> ({d.procurement.overdue} past ETA)</dd></div>
            <div><dt>Units expected</dt><dd>{d.procurement.expected}</dd></div>
            <div><dt>Fill rate (closed POs)</dt><dd>{d.procurement.fillRate == null ? "—" : `${d.procurement.fillRate}%`}</dd></div>
            <div><dt>Shipped (30 days)</dt><dd>{d.fulfilment.shipped30}</dd></div>
            <div><dt>Delivered (30 days)</dt><dd>{d.fulfilment.delivered30}</dd></div>
            <div><dt>On the road now</dt><dd><Link href="/wms/dispatch#road" className="text-accent">{d.fulfilment.onRoad}</Link></dd></div>
            <div><dt>Days to deliver (avg)</dt><dd>{d.fulfilment.avgDays ?? "—"}</dd></div>
            <div><dt>Failed / came back (30 days)</dt><dd>{d.fulfilment.failed30}</dd></div>
            <div><dt>Open returns</dt><dd><Link href="/wms/returns" className="text-accent">{d.returns.open}</Link>{d.returns.avgAgeDays != null ? `, ${d.returns.avgAgeDays} days old on average` : ""}</dd></div>
            {money ? <div><dt>Net cost of returns</dt><dd>{inr(d.returns.netCostMinor)}</dd></div> : null}
            {money ? <div><dt>Waiting to go back to vendors</dt><dd>{inr(d.returns.rtvValueMinor)}</dd></div> : null}
          </dl>
        </Panel>
        <Panel title="Data quality" subtitle="How serials were captured. Scanned is best; typed and labels need a look.">
          <dl className="wms-facts">
            <div><dt>Scanned</dt><dd>{d.quality.scanned} ({pct(d.quality.scanned, d.quality.total - d.quality.opening)})</dd></div>
            <div><dt>Typed by hand</dt><dd>{d.quality.typed} ({pct(d.quality.typed, d.quality.total - d.quality.opening)})</dd></div>
            <div><dt>No barcode (EPIK label)</dt><dd>{d.quality.noBarcode}</dd></div>
            <div><dt>Opening stock (from the sheet)</dt><dd>{d.quality.opening}</dd></div>
            <div><dt>Units on hand with no cost</dt><dd>{d.quality.noCost}</dd></div>
          </dl>
        </Panel>
        <Panel title="By person (30 days)" subtitle="Units received and dispatched.">
          {d.people.length ? (
            <TableWrap minWidth={320}>
              <thead><tr><th>Name</th><th className="num">Received</th><th className="num">Dispatched</th></tr></thead>
              <tbody>{d.people.map((p) => <tr key={p.name}><td>{p.name}</td><td className="num">{p.received}</td><td className="num">{p.dispatched}</td></tr>)}</tbody>
            </TableWrap>
          ) : (
            <p className="text-[14px] text-muted">Nothing yet.</p>
          )}
        </Panel>
      </div>
    </section>
  );
}

import Link from "next/link";
import { inputClass, Kpi, Panel, TableWrap } from "@/components/ops/bits";
import { PageHeader } from "@/components/ui";
import { stockOnHand } from "@/features/wms/service";
import { stockTotals } from "@/features/wms/domain/stock";
import { loadWmsPage } from "@/features/wms/ui/load";
import { WmsNav, WmsOff } from "@/features/wms/ui/wms-nav";
import { firstParam } from "@/lib/query";
import { inr, shortDate } from "@/lib/ops-ui/format";
import "@/features/wms/wms.css";

export default async function WmsStock({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const page = await loadWmsPage();
  if (!page) return <WmsOff />;
  const q = firstParam((await searchParams).q).replace(/\s+/g, " ").trim().slice(0, 60);
  const { rows, showCost } = await stockOnHand(page.ctx, page.actor, q);
  const t = stockTotals(rows);

  return (
    <section>
      <PageHeader title="Stock on hand" description="Units in the warehouse, counted from their serials. Value is the cost including GST." />
      <WmsNav current="stock" />
      <dl className="ops-grid-3 mb-3">
        <Kpi label="Units" value={t.onHand} />
        <Kpi label="Ready to sell" value={t.available} />
        {showCost ? <Kpi label="Value (incl. GST)" value={inr(t.valueMinor)} note={t.noCost ? `${t.noCost} units have no cost yet` : undefined} /> : <Kpi label="On hold" value={t.onHold} />}
      </dl>
      <Panel
        title={`${rows.length} product${rows.length === 1 ? "" : "s"}`}
        subtitle="“All stock” also counts units that came in through the team sheet and have no serial record here yet. Before the switch-over the two can differ."
      >
        <form action="/wms/stock" className="mb-2">
          <label className="sr-only" htmlFor="stock-q">Search products</label>
          <input id="stock-q" name="q" defaultValue={q} placeholder="Product, brand or SKU" className={inputClass} />
        </form>
        <TableWrap minWidth={780}>
          <thead>
            <tr>
              <th>Product</th>
              <th className="num">Units</th>
              <th className="num">Ready to sell</th>
              <th className="num">On hold</th>
              {showCost ? <th className="num">Avg cost</th> : null}
              {showCost ? <th className="num">Value</th> : null}
              <th>Oldest since</th>
              <th className="num">All stock</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sku}>
                <td>
                  <Link href={`/wms/units?sku=${encodeURIComponent(r.sku)}`} className="wms-clamp-2 font-medium text-accent" title={r.name}>{r.name}</Link>
                  <div className="wms-muted">{r.sku}{r.brand ? ` · ${r.brand}` : ""}</div>
                </td>
                <td className="num">{r.onHand}</td>
                <td className="num">{r.available}</td>
                <td className={`num ${r.onHold ? "text-warn" : ""}`}>{r.onHold}</td>
                {showCost ? <td className="num">{r.onHand - r.noCost ? inr(Math.round(r.valueMinor / (r.onHand - r.noCost))) : "—"}</td> : null}
                {showCost ? <td className="num">{inr(r.valueMinor)}</td> : null}
                <td className="wms-muted">{shortDate(r.oldestReceivedAt)}</td>
                <td className="num wms-muted">{r.ledgerOnHand ?? "—"}</td>
              </tr>
            ))}
            {rows.length ? (
              <tr className="font-semibold">
                <td>Total</td>
                <td className="num">{t.onHand}</td>
                <td className="num">{t.available}</td>
                <td className="num">{t.onHold}</td>
                {showCost ? <td /> : null}
                {showCost ? <td className="num">{inr(t.valueMinor)}</td> : null}
                <td />
                <td />
              </tr>
            ) : null}
          </tbody>
        </TableWrap>
        {!rows.length ? <p className="mt-2 text-[14px] text-muted">{q ? "No product matches." : "No units received in these screens yet."}</p> : null}
      </Panel>
    </section>
  );
}

import Link from "next/link";
import { FilePlus2 } from "lucide-react";
import { FoldPanel, Panel, TableWrap } from "@/components/ops/bits";
import { PageHeader } from "@/components/ui";
import { activeNames, listPos } from "@/features/wms/service";
import { loadWmsPage } from "@/features/wms/ui/load";
import { NewWmsPoForm } from "@/features/wms/ui/new-po-form";
import { WmsNav, WmsOff } from "@/features/wms/ui/wms-nav";
import { isoDateInIst } from "@/lib/format";
import { inr, shortDate } from "@/lib/ops-ui/format";
import "@/features/wms/wms.css";

export default async function WmsPurchaseOrders() {
  const page = await loadWmsPage();
  if (!page) return <WmsOff />;
  const { ctx, showCost, canRaisePo } = page;
  const [pos, vendors, hubs, billing, terms] = await Promise.all([listPos(ctx), activeNames(ctx, "vendor"), activeNames(ctx, "hub"), activeNames(ctx, "billing_entity"), activeNames(ctx, "payment_term")]);
  const today = isoDateInIst(new Date());

  return (
    <section>
      <PageHeader title="Purchase orders" description="Every PO with what has come in. Tap one to see each received unit." />
      <WmsNav current="po" />
      {canRaisePo ? (
        <FoldPanel id="new" title="Raise a PO" subtitle="The next PO number is given for you. Prices include GST." icon={<FilePlus2 size={18} />}>
          <NewWmsPoForm lists={{ vendors, hubs, billing, terms }} />
        </FoldPanel>
      ) : null}
      <Panel title={`POs (${pos.length})`} subtitle="Open first, soonest ETA first. Past the ETA shows in red.">
        <TableWrap minWidth={760}>
          <thead>
            <tr>
              <th>PO</th>
              <th>Vendor</th>
              <th className="num">Received</th>
              <th>ETA</th>
              {showCost ? <th className="num">Value</th> : null}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {pos.map((p) => (
              <tr key={p.poNumber}>
                <td>
                  <Link href={`/wms/po/${encodeURIComponent(p.poNumber)}`} className="font-medium text-accent">{p.poNumber}</Link>
                  <div className="wms-muted">{p.products} product{p.products === 1 ? "" : "s"}{p.hub ? ` · ${p.hub}` : ""}</div>
                </td>
                <td>{p.vendor ?? "—"}</td>
                <td className="num">{p.received} / {p.ordered}</td>
                <td className={p.open && p.eta && p.eta < today ? "text-bad font-medium" : ""}>{shortDate(p.eta)}</td>
                {showCost ? <td className="num">{p.valueMinor == null ? "—" : inr(p.valueMinor)}</td> : null}
                <td>{p.open ? <span className="wms-badge is-warn">{p.received ? "Part received" : "Open"}</span> : <span className="wms-badge is-good">Closed</span>}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Panel>
    </section>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { Kpi, Panel, TableWrap } from "@/components/ops/bits";
import { PageHeader } from "@/components/ui";
import { poView } from "@/features/wms/service";
import { CONDITION_LABELS, UNIT_STATUS_LABELS, sellableCondition } from "@/features/wms/domain/unit";
import { loadWmsPage } from "@/features/wms/ui/load";
import { WmsNav, WmsOff } from "@/features/wms/ui/wms-nav";
import { inr, shortDate, shortWhen } from "@/lib/ops-ui/format";
import "@/features/wms/wms.css";

export default async function WmsPoDetail({ params }: { params: Promise<{ po: string }> }) {
  const page = await loadWmsPage();
  if (!page) return <WmsOff />;
  const poNumber = decodeURIComponent((await params).po);
  const view = await poView(page.ctx, poNumber);
  if (!view) notFound();
  const { header, lines, units, grns } = view;
  const { showCost } = page;
  const ordered = lines.reduce((s, l) => s + l.qtyOrdered, 0);
  const received = lines.reduce((s, l) => s + l.qtyReceived, 0);
  const pending = lines.reduce((s, l) => s + l.pending, 0);
  const onHold = units.filter((u) => !sellableCondition(u.condition)).length;
  const value = showCost && lines.every((l) => l.terms?.unitCostMinor != null) ? lines.reduce((s, l) => s + (l.terms?.unitCostMinor ?? 0) * l.qtyOrdered, 0) : null;

  return (
    <section>
      <PageHeader
        title={poNumber}
        description={[header?.vendor ?? lines[0].vendor ?? "Vendor not set", header?.hub ? `to ${header.hub}` : null, header?.billedTo ? `billed to ${header.billedTo}` : null, header?.paymentTerms, header?.eta ? `ETA ${shortDate(header.eta)}` : null].filter(Boolean).join(" · ")}
        action={pending && page.canReceive ? <Link href={`/wms/receive/${encodeURIComponent(poNumber)}`} className="glow-button inline-flex h-10 items-center rounded-[12px] px-4 text-[13px] font-medium text-white">Receive goods</Link> : undefined}
      />
      <WmsNav current="po" />
      <dl className="ops-grid-3 mb-3">
        <Kpi label="Received" value={`${received} / ${ordered}`} tone={pending ? undefined : "good"} />
        <Kpi label="Still to come" value={pending} />
        <Kpi label="On hold on arrival" value={onHold} tone={onHold ? "warn" : undefined} />
        {value != null ? <Kpi label="PO value (incl. GST)" value={inr(value)} /> : null}
      </dl>
      {header?.notes ? <p className="dashboard-panel mb-3 text-[14px]">{header.notes}</p> : null}

      <Panel title="Products on this PO">
        <TableWrap minWidth={640}>
          <thead>
            <tr>
              <th>Product</th>
              <th className="num">Ordered</th>
              <th className="num">Received</th>
              <th className="num">To come</th>
              {showCost ? <th className="num">Price (incl. GST)</th> : null}
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td>
                  <Link href={`/wms/units?sku=${encodeURIComponent(l.sku)}&po=${encodeURIComponent(poNumber)}`} className="wms-clamp-2 font-medium text-accent">{l.product?.name ?? l.productName ?? l.sku}</Link>
                  <div className="wms-muted">{l.sku}</div>
                </td>
                <td className="num">{l.qtyOrdered}</td>
                <td className="num">{l.qtyReceived}</td>
                <td className="num">{l.pending}</td>
                {showCost ? <td className="num">{inr(l.terms?.unitCostMinor ?? null)}</td> : null}
                <td>{l.terms?.ownership ?? l.product?.channel ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Panel>

      <Panel title={`Units received (${units.length})`} subtitle="Each unit scanned on this PO. Tap a serial for its full history." className="mt-3">
        {units.length ? (
          <TableWrap minWidth={720}>
            <thead>
              <tr>
                <th>Serial</th>
                <th>Product</th>
                <th>Condition</th>
                <th>Status</th>
                {showCost ? <th className="num">Cost</th> : null}
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {units.map((u) => (
                <tr key={u.id}>
                  <td><Link href={`/wms/units/${u.id}`} className="font-medium text-accent">{u.serial}</Link>{u.remark ? <div className="wms-muted">{u.remark}</div> : null}</td>
                  <td className="wms-muted">{u.sku}</td>
                  <td><span className={`wms-badge ${sellableCondition(u.condition) ? "is-quiet" : "is-bad"}`}>{CONDITION_LABELS[u.condition]}</span>{u.photos.length ? <span className="wms-muted"> · photo</span> : null}</td>
                  <td>{UNIT_STATUS_LABELS[u.status]}</td>
                  {showCost ? <td className="num">{inr(u.unitCostMinor)}</td> : null}
                  <td className="wms-muted">{u.grnNumber} · {shortWhen(u.receivedAt)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : (
          <p className="text-[14px] text-muted">No units scanned on this PO yet.{lines.some((l) => l.qtyReceived) ? " (Units received on the older Purchase orders page have no serial records.)" : ""}</p>
        )}
      </Panel>

      {grns.length ? (
        <Panel title="Goods receipts" className="mt-3">
          <div className="wms-card-list">
            {grns.map((g) => (
              <div key={g.number} id={g.number} className="wms-card">
                <div className="wms-card-top">
                  <strong>{g.number}</strong>
                  <span className="wms-muted">{shortWhen(g.createdAt)} · {g.receivedBy}</span>
                </div>
                <span className="text-[13.5px]">{g.lines.map((l) => `${l.received} × ${l.productName}${l.onHold ? ` (${l.onHold} on hold)` : ""}`).join(", ")}</span>
                <span className="wms-muted">{g.invoiceNo ? `Invoice ${g.invoiceNo}` : "Invoice not here yet"}</span>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </section>
  );
}

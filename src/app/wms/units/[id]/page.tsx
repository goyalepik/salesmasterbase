import Link from "next/link";
import { notFound } from "next/navigation";
import { Panel } from "@/components/ops/bits";
import { PageHeader } from "@/components/ui";
import { activeNames, unitDetail } from "@/features/wms/service";
import { choicesFor } from "@/features/wms/flows";
import { setUnitStatusAction } from "@/app/actions/wms";
import { ActionForm, SubmitButton } from "@/components/ops/action-form";
import { inputClass } from "@/components/ops/bits";
import { RMA_STATUS_LABELS } from "@/features/wms/domain/types";
import { CONDITION_LABELS, UNIT_STATUS_LABELS, sellableCondition } from "@/features/wms/domain/unit";
import { loadWmsPage } from "@/features/wms/ui/load";
import { WmsNav, WmsOff } from "@/features/wms/ui/wms-nav";
import { inr, shortWhen } from "@/lib/ops-ui/format";
import "@/features/wms/wms.css";

const SOURCE = { scan: "Scanned", manual: "Typed by hand", internal: "No barcode: EPIK label", opening: "Opening stock (from the team sheet)" } as const;

export default async function UnitPage({ params }: { params: Promise<{ id: string }> }) {
  const page = await loadWmsPage();
  if (!page) return <WmsOff />;
  const detail = await unitDetail(page.ctx, (await params).id, page.actor);
  if (!detail) notFound();
  const { unit, events, product, photoUrls, showCost } = detail;
  const [links, rmas, hubs] = await Promise.all([page.ctx.wms.listRecords("link", { unitId: unit.id }), page.ctx.wms.listRecords("rma", { unitId: unit.id }), activeNames(page.ctx, "hub")]);
  const choices = choicesFor(unit);

  return (
    <section>
      <PageHeader title={unit.serial} description={product?.name ?? unit.sku} />
      <WmsNav current={null} />
      <Panel>
        <div className="mb-3 flex flex-wrap gap-2">
          <span className={`wms-badge ${unit.status === "available" ? "is-good" : unit.status === "quarantine" ? "is-bad" : "is-quiet"}`}>{UNIT_STATUS_LABELS[unit.status]}</span>
          <span className={`wms-badge ${sellableCondition(unit.condition) ? "is-quiet" : "is-bad"}`}>{CONDITION_LABELS[unit.condition]}</span>
          {unit.ownership ? <span className="wms-badge is-quiet">{unit.ownership}</span> : null}
        </div>
        <dl className="wms-facts">
          <div><dt>SKU</dt><dd><Link href={`/wms/units?sku=${encodeURIComponent(unit.sku)}`} className="text-accent">{unit.sku}</Link></dd></div>
          <div><dt>Brand</dt><dd>{product?.brand ?? "—"}</dd></div>
          <div><dt>Where</dt><dd>{unit.hub ?? "—"}</dd></div>
          <div><dt>Serial</dt><dd>{SOURCE[unit.serialSource]}</dd></div>
          {unit.altIds.length ? <div><dt>Other IDs</dt><dd>{unit.altIds.join(", ")}</dd></div> : null}
          <div><dt>PO</dt><dd>{unit.poNumber ? <Link href={`/wms/po/${encodeURIComponent(unit.poNumber)}`} className="text-accent">{unit.poNumber}</Link> : "—"}</dd></div>
          <div><dt>Goods receipt</dt><dd>{unit.grnNumber && unit.poNumber ? <Link href={`/wms/po/${encodeURIComponent(unit.poNumber)}#${unit.grnNumber}`} className="text-accent">{unit.grnNumber}</Link> : "—"}</dd></div>
          <div><dt>Vendor</dt><dd>{unit.vendor ?? "—"}</dd></div>
          <div><dt>Invoice</dt><dd>{unit.invoiceNo ?? "Not here yet"}</dd></div>
          <div><dt>Billed to</dt><dd>{unit.billedTo ?? "—"}</dd></div>
          {showCost ? (
            <>
              <div><dt>Cost (incl. GST)</dt><dd>{inr(unit.unitCostMinor)}</dd></div>
              <div><dt>GST rate</dt><dd>{unit.gstRate != null ? `${unit.gstRate}%` : "—"}</dd></div>
              <div><dt>Cost before GST</dt><dd>{unit.unitCostMinor != null && unit.gstRate != null ? inr(Math.round(unit.unitCostMinor / (1 + unit.gstRate / 100))) : "—"}</dd></div>
            </>
          ) : null}
          <div><dt>Received</dt><dd>{shortWhen(unit.receivedAt)} by {unit.receivedBy}</dd></div>
          {unit.remark ? <div><dt>Remark</dt><dd>{unit.remark}</dd></div> : null}
        </dl>
      </Panel>

      {photoUrls.length ? (
        <Panel title="Photos" className="mt-3">
          <div className="wms-photos">
            {photoUrls.map((src) => (
              <a key={src.slice(0, 80)} href={src} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`Photo of ${unit.serial}`} />
              </a>
            ))}
          </div>
        </Panel>
      ) : null}

      {links.length || rmas.length ? (
        <Panel title="Orders and returns" className="mt-3">
          <div className="grid gap-1.5 text-[14px]">
            {links.map((l) => (
              <div key={l.id}>
                {l.linkType === "replacement" ? "Sent as a replacement on " : "Sold on "}
                <Link href={`/orders/${l.orderId}`} className="text-accent">{l.orderId}</Link>
                {l.shipmentNumber ? ` · ${l.shipmentNumber}` : ""}
                {l.active ? "" : " · came back"}
              </div>
            ))}
            {rmas.map((r) => (
              <div key={r.number}>
                Return <Link href={`/wms/returns/${r.number}`} className="text-accent">{r.number}</Link> · {RMA_STATUS_LABELS[r.status]}
                {r.replacementUnitId === unit.id ? " (this unit is the replacement)" : ""}
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      {choices.length && page.canReceive ? (
        <Panel title="Change this unit" subtitle="Quality check, demo, move to another hub, damage or write-off. Writing off needs procurement or admin." className="mt-3">
          <ActionForm action={setUnitStatusAction} className="grid gap-2 sm:grid-cols-[220px_200px_minmax(0,1fr)_auto] sm:items-end">
            <input type="hidden" name="unitId" value={unit.id} />
            <label className="block text-[12px] text-muted">
              New status
              <select name="to" className={`${inputClass} mt-1`}>{choices.map((c) => <option key={c} value={c}>{unit.status === "transfer_in_transit" && c === "available" ? "Arrived at the hub" : UNIT_STATUS_LABELS[c]}</option>)}</select>
            </label>
            <label className="block text-[12px] text-muted">
              Hub (for a move)
              <select name="hub" defaultValue="" className={`${inputClass} mt-1`}><option value="">Not moving</option>{hubs.map((h) => <option key={h} value={h}>{h}</option>)}</select>
            </label>
            <label className="block text-[12px] text-muted">
              Note (where, why)
              <input name="note" maxLength={200} className={`${inputClass} mt-1`} />
            </label>
            <SubmitButton>Save</SubmitButton>
          </ActionForm>
        </Panel>
      ) : null}

      <Panel title="History" subtitle="Every change to this unit, oldest first." className="mt-3">
        <ol className="wms-timeline">
          {events.map((e) => (
            <li key={e.id}>
              <div className="text-[14px]">{e.text}</div>
              <div className="wms-muted">{shortWhen(e.at)} · {e.by}</div>
            </li>
          ))}
        </ol>
      </Panel>
    </section>
  );
}

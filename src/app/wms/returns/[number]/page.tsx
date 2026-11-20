import Link from "next/link";
import { notFound } from "next/navigation";
import { rmaStepAction } from "@/app/actions/wms";
import { ActionForm, SubmitButton } from "@/components/ops/action-form";
import { Field, inputClass, Kpi, Panel } from "@/components/ops/bits";
import { PageHeader } from "@/components/ui";
import { DISPOSITIONS, rmaNetCost } from "@/features/wms/flows";
import { activeNames } from "@/features/wms/service";
import { RMA_STATUS_LABELS, RMA_TYPE_LABELS } from "@/features/wms/domain/types";
import { CONDITION_LABELS, RECEIVE_CONDITIONS, UNIT_STATUS_LABELS } from "@/features/wms/domain/unit";
import { loadWmsPage } from "@/features/wms/ui/load";
import { WmsNav, WmsOff } from "@/features/wms/ui/wms-nav";
import { inr, shortWhen } from "@/lib/ops-ui/format";
import "@/features/wms/wms.css";

function Step({ number, step, children, button, tone }: { number: string; step: string; children?: React.ReactNode; button: string; tone?: "primary" | "good" | "danger" | "quiet" }) {
  return (
    <ActionForm action={rmaStepAction} className="grid gap-2">
      <input type="hidden" name="number" value={number} />
      <input type="hidden" name="step" value={step} />
      {children}
      <div><SubmitButton tone={tone}>{button}</SubmitButton></div>
    </ActionForm>
  );
}

export default async function RmaPage({ params }: { params: Promise<{ number: string }> }) {
  const page = await loadWmsPage();
  if (!page) return <WmsOff />;
  const { ctx, showCost } = page;
  const number = decodeURIComponent((await params).number);
  const rma = await ctx.wms.getRecord("rma", number);
  if (!rma) notFound();
  const [unit, replacement, partners, net] = await Promise.all([ctx.wms.getUnit(rma.unitId), rma.replacementUnitId ? ctx.wms.getUnit(rma.replacementUnitId) : null, activeNames(ctx, "logistics_partner"), rmaNetCost(ctx, rma)]);
  const live = rma.status !== "closed" && rma.status !== "rejected";

  return (
    <section>
      <PageHeader title={`${rma.number} · ${RMA_TYPE_LABELS[rma.type]}`} description={`${rma.serial} · ${rma.sku} · ${rma.reason}${rma.customer ? ` · ${rma.customer}` : ""}`} />
      <WmsNav current="returns" />
      <dl className="ops-grid-3 mb-3">
        <Kpi label="Status" value={RMA_STATUS_LABELS[rma.status]} />
        <Kpi label="Unit now" value={unit ? UNIT_STATUS_LABELS[unit.status] : "—"} href={unit ? `/wms/units/${unit.id}` : undefined} />
        {showCost ? <Kpi label="Net cost to us" value={inr(net)} note="Refund + shipping + repair + replacement − recovered" tone={net > 0 ? "warn" : "good"} /> : <Kpi label="Order" value={rma.orderId ?? "—"} href={rma.orderId ? `/orders/${rma.orderId}` : undefined} />}
      </dl>

      {live ? (
        <Panel title="Next step">
          <div className="grid gap-4">
            {rma.status === "open" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Step number={number} step="approve" button="Approve" tone="good"><input name="note" maxLength={300} className={inputClass} placeholder="Note (optional)" aria-label="Note" /></Step>
                <Step number={number} step="reject" button="Reject" tone="danger"><input name="note" maxLength={300} className={inputClass} placeholder="Why it's rejected" aria-label="Why rejected" /></Step>
              </div>
            ) : null}
            {(rma.status === "approved" || rma.status === "open") && !rma.receivedAt ? (
              <Step number={number} step="pickup" button="Book pickup">
                <div className="grid gap-2 sm:grid-cols-3">
                  <Field label="3PL partner"><select name="partner" className={inputClass}>{partners.map((p) => <option key={p} value={p}>{p}</option>)}</select></Field>
                  <Field label="Reverse AWB"><input name="awb" maxLength={60} className={inputClass} /></Field>
                  <Field label="Tracking link (if the partner has none set)"><input name="trackingUrl" maxLength={300} className={inputClass} placeholder="https://…" /></Field>
                </div>
              </Step>
            ) : null}
            {!rma.receivedAt && rma.status !== "open" ? (
              <Step number={number} step="receive" button="Received back">
                <div className="grid gap-2 sm:grid-cols-3">
                  <Field label="Scan the serial that came back"><input name="serial" required maxLength={120} className={inputClass} autoComplete="off" /></Field>
                  <Field label="Condition"><select name="condition" className={inputClass} defaultValue="defective">{RECEIVE_CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABELS[c]}</option>)}</select></Field>
                  <Field label="Note"><input name="note" maxLength={300} className={inputClass} /></Field>
                </div>
                {showCost ? <label className="flex items-center gap-2 text-[13px] text-muted"><input type="checkbox" name="override" value="yes" className="h-5 w-5" /> Accept a different serial (write why in the note)</label> : null}
              </Step>
            ) : null}
            {rma.receivedAt && !rma.disposition ? (
              <Step number={number} step="dispose" button="Save">
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="What happens to the returned unit"><select name="to" className={inputClass}>{DISPOSITIONS.map((d) => <option key={d.to} value={d.to}>{d.label}</option>)}</select></Field>
                  <Field label="Note (needed for scrap or demo)"><input name="note" maxLength={300} className={inputClass} /></Field>
                </div>
              </Step>
            ) : null}
            {!rma.replacementUnitId && rma.status !== "open" && (rma.type === "replacement" || rma.type === "doa" || rma.type === "wrong_item" || rma.type === "transit_damage") ? (
              <Step number={number} step="replace" button="Send replacement">
                <div className="grid gap-2 sm:grid-cols-3">
                  <Field label="Scan the replacement unit"><input name="serial" required maxLength={120} className={inputClass} autoComplete="off" /></Field>
                  <Field label="Sent with"><select name="carrier" className={inputClass} defaultValue={partners.length ? "3pl" : "own"}><option value="3pl">3PL</option><option value="own">Our person</option></select></Field>
                  <Field label="3PL partner"><select name="partner" className={inputClass}><option value="">None</option>{partners.map((p) => <option key={p} value={p}>{p}</option>)}</select></Field>
                  <Field label="AWB"><input name="awb" maxLength={60} className={inputClass} /></Field>
                  <Field label="Our person (if no 3PL)"><input name="driver" maxLength={60} className={inputClass} /></Field>
                  <Field label="Expected delivery"><input type="date" name="expectedDate" className={inputClass} /></Field>
                </div>
              </Step>
            ) : null}
            <Step number={number} step="close" button="Close the case" tone="quiet"><input name="note" maxLength={300} className={inputClass} placeholder="Closing note (optional)" aria-label="Closing note" /></Step>
          </div>
        </Panel>
      ) : null}

      {showCost ? (
        <Panel title="Money on this case" subtitle="In rupees. Recovered is what the brand gave back (credit note or repair paid)." className="mt-3">
          <Step number={number} step="money" button="Save amounts" tone="quiet">
            <div className="grid gap-2 sm:grid-cols-4">
              <Field label="Refund to customer"><input name="refund" inputMode="decimal" defaultValue={rma.refundMinor ? rma.refundMinor / 100 : ""} className={inputClass} /></Field>
              <Field label="Shipping (both ways)"><input name="shipping" inputMode="decimal" defaultValue={rma.shippingCostMinor ? rma.shippingCostMinor / 100 : ""} className={inputClass} /></Field>
              <Field label="Repair"><input name="repair" inputMode="decimal" defaultValue={rma.repairCostMinor ? rma.repairCostMinor / 100 : ""} className={inputClass} /></Field>
              <Field label="Recovered from brand"><input name="recovered" inputMode="decimal" defaultValue={rma.recoveredMinor ? rma.recoveredMinor / 100 : ""} className={inputClass} /></Field>
            </div>
          </Step>
          {replacement ? <p className="mt-2 text-[13px] text-muted">Replacement unit {replacement.serial} cost {inr(replacement.unitCostMinor)}.</p> : null}
        </Panel>
      ) : null}

      <Panel title="History" className="mt-3">
        <ol className="wms-timeline">
          {rma.history.map((h, i) => (
            <li key={i}><div className="text-[14px]">{h.text}</div><div className="wms-muted">{shortWhen(h.at)} · {h.by}</div></li>
          ))}
        </ol>
        <p className="mt-2 text-[13px]">
          {unit ? <Link href={`/wms/units/${unit.id}`} className="text-accent">Returned unit {unit.serial}</Link> : null}
          {replacement ? <> · <Link href={`/wms/units/${replacement.id}`} className="text-accent">Replacement {replacement.serial}</Link></> : null}
          {rma.orderId ? <> · <Link href={`/orders/${rma.orderId}`} className="text-accent">Order {rma.orderId}</Link></> : null}
          {rma.pickup?.trackingUrl ? <> · <a href={rma.pickup.trackingUrl} target="_blank" rel="noreferrer" className="text-accent">Track pickup</a></> : null}
        </p>
      </Panel>
    </section>
  );
}

import Link from "next/link";
import { openRmaAction, sendToVendorAction } from "@/app/actions/wms";
import { ActionForm, SubmitButton } from "@/components/ops/action-form";
import { Field, FoldPanel, inputClass, Panel } from "@/components/ops/bits";
import { PageHeader } from "@/components/ui";
import { rmaNetCost } from "@/features/wms/flows";
import { activeNames } from "@/features/wms/service";
import { RMA_REASONS, RMA_STATUS_LABELS, RMA_TYPE_LABELS, RMA_TYPES } from "@/features/wms/domain/types";
import { UNIT_STATUS_LABELS } from "@/features/wms/domain/unit";
import { loadWmsPage } from "@/features/wms/ui/load";
import { WmsNav, WmsOff } from "@/features/wms/ui/wms-nav";
import { GoForm } from "@/features/wms/ui/go-form";
import { inr, shortWhen } from "@/lib/ops-ui/format";
import { RotateCcw, Truck } from "lucide-react";
import "@/features/wms/wms.css";

export default async function ReturnsPage() {
  const page = await loadWmsPage();
  if (!page) return <WmsOff />;
  const { ctx, showCost } = page;
  const [rmas, toVendor, vendors, partners] = await Promise.all([
    ctx.wms.listRecords("rma", { limit: 500 }),
    ctx.wms.listUnits({ statuses: ["rtv_pending", "defective", "damaged"], limit: 500 }),
    activeNames(ctx, "vendor"),
    activeNames(ctx, "logistics_partner"),
  ]);
  const open = rmas.filter((r) => r.status !== "closed" && r.status !== "rejected");
  const nets = new Map<string, number>();
  if (showCost) for (const r of rmas) nets.set(r.number, await rmaNetCost(ctx, r));

  return (
    <section>
      <PageHeader title="Returns and replacements" description="One case per complaint: what came back, what went out, how long it took, what it cost and what the brand gave back." />
      <WmsNav current="returns" />
      <FoldPanel title="Open a return" subtitle="Start from the serial the customer has." icon={<RotateCcw size={18} />} open={!rmas.length}>
        <GoForm action={openRmaAction} className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Serial of the unit sold"><input name="serial" required maxLength={120} className={inputClass} placeholder="Scan or type" autoComplete="off" /></Field>
            <Field label="What kind">
              <select name="type" className={inputClass} defaultValue="replacement">{RMA_TYPES.map((t) => <option key={t} value={t}>{RMA_TYPE_LABELS[t]}</option>)}</select>
            </Field>
            <Field label="Reason">
              <select name="reason" className={inputClass} defaultValue="Defective">{RMA_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}</select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
            <Field label="What the customer says"><input name="description" maxLength={500} className={inputClass} /></Field>
            <Field label="Brand ticket number (optional)"><input name="brandTicket" maxLength={60} className={inputClass} /></Field>
          </div>
          <div><SubmitButton>Open return</SubmitButton></div>
        </GoForm>
      </FoldPanel>

      <Panel title={`Returns (${open.length} open)`} subtitle="Open first. Tap one to work on it.">
        {rmas.length ? (
          <div className="wms-card-list">
            {[...open, ...rmas.filter((r) => !open.includes(r))].map((r) => (
              <Link key={r.number} href={`/wms/returns/${r.number}`} className="wms-card">
                <div className="wms-card-top">
                  <strong>{r.number}</strong>
                  <span className={`wms-badge ${r.status === "closed" ? "is-good" : r.status === "rejected" ? "is-quiet" : "is-warn"}`}>{RMA_STATUS_LABELS[r.status]}</span>
                </div>
                <span className="text-[13.5px]">{RMA_TYPE_LABELS[r.type]} · {r.serial} · {r.reason}</span>
                <span className="wms-muted">{r.customer ?? "Customer not linked"}{r.orderId ? ` · ${r.orderId}` : ""} · opened {shortWhen(r.createdAt)}{showCost ? ` · net cost ${inr(nets.get(r.number) ?? 0)}` : ""}</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-[14px] text-muted">No returns yet.</p>
        )}
      </Panel>

      {showCost ? (
        <FoldPanel title={`Send back to vendor (${toVendor.length} waiting)`} subtitle="Defective, damaged or set-aside units go back on one shipment. The credit note is shared over their returns." icon={<Truck size={18} />}>
          {toVendor.length ? (
            <ActionForm action={sendToVendorAction} className="grid gap-3">
              <div className="grid gap-1.5">
                {toVendor.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-[14px]">
                    <input type="checkbox" name="serial" value={u.serial} className="h-5 w-5" />
                    <span className="font-medium">{u.serial}</span>
                    <span className="wms-muted">{u.sku} · {UNIT_STATUS_LABELS[u.status]} · {u.vendor ?? "vendor unknown"} · {inr(u.unitCostMinor)}</span>
                  </label>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Vendor"><select name="vendor" className={inputClass}>{vendors.map((v) => <option key={v} value={v}>{v}</option>)}</select></Field>
                <Field label="Credit note from vendor (₹)"><input name="creditNote" inputMode="decimal" className={inputClass} placeholder="If known now" /></Field>
                <Field label="Sent with">
                  <select name="carrier" className={inputClass} defaultValue={partners.length ? "3pl" : "own"}><option value="3pl">3PL</option><option value="own">Our person</option></select>
                </Field>
                <Field label="3PL partner"><select name="partner" className={inputClass}><option value="">None</option>{partners.map((p) => <option key={p} value={p}>{p}</option>)}</select></Field>
                <Field label="AWB"><input name="awb" maxLength={60} className={inputClass} /></Field>
                <Field label="Our person (if no 3PL)"><input name="driver" maxLength={60} className={inputClass} /></Field>
              </div>
              <div><SubmitButton>Send back</SubmitButton></div>
            </ActionForm>
          ) : (
            <p className="text-[14px] text-muted">Nothing waiting to go back.</p>
          )}
        </FoldPanel>
      ) : null}
    </section>
  );
}

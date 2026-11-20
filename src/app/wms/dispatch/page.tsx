import Link from "next/link";
import { shipmentAction } from "@/app/actions/wms";
import { ActionForm, SubmitButton } from "@/components/ops/action-form";
import { inputClass, Panel } from "@/components/ops/bits";
import { PageHeader } from "@/components/ui";
import { dispatchQueue, followDeliveredOrders } from "@/features/wms/flows";
import { loadWmsPage } from "@/features/wms/ui/load";
import { WmsNav, WmsOff } from "@/features/wms/ui/wms-nav";
import { shortDate, shortWhen } from "@/lib/ops-ui/format";
import "@/features/wms/wms.css";

export default async function DispatchPage() {
  const page = await loadWmsPage();
  if (!page) return <WmsOff />;
  const { ctx, actor } = page;
  await followDeliveredOrders(ctx, actor);
  const [queue, shipments] = await Promise.all([dispatchQueue(ctx), ctx.wms.listRecords("shipment", { limit: 300 })]);
  const road = shipments.filter((s) => s.status === "dispatched");
  const failed = shipments.filter((s) => s.status === "failed");
  const recent = shipments.filter((s) => s.status !== "dispatched" && s.status !== "failed").slice(0, 20);

  return (
    <section>
      <PageHeader title="Dispatch" description="Scan each unit against its order, add the 3PL and AWB (or our delivery person), send. The order card shows the serial and tracking link." />
      <WmsNav current="dispatch" />

      <Panel title={`Orders to send (${queue.length})`} subtitle="Payment approved and not sent yet. Oldest first. “In stock” counts units with serials here.">
        {queue.length ? (
          <div className="wms-card-list">
            {queue.map((o) => (
              <Link key={o.orderId} href={`/wms/dispatch/${o.orderId}`} className="wms-card">
                <div className="wms-card-top">
                  <strong>{o.label}</strong>
                  <span className="wms-muted">{shortDate(o.createdAt)}</span>
                </div>
                <span className="text-[13.5px]">{o.customer}{o.hub ? ` · ${o.hub}` : ""}</span>
                {o.lines.map((l) => (
                  <span key={l.lineId} className="wms-muted wms-clamp-1">
                    {l.qty - l.sent} × {l.name} · <span className={l.inStock ? "text-good" : "text-bad"}>{l.inStock ? `${l.inStock} in stock` : "none in stock"}</span>
                  </span>
                ))}
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-[14px] text-muted">Nothing waiting to go out.</p>
        )}
      </Panel>

      <div id="road" />
      <Panel title={`On the road (${road.length})`} subtitle="Mark delivered (with cash collected, if any) or failed." className="mt-3">
        {road.length ? (
          <div className="wms-card-list">
            {road.map((s) => (
              <div key={s.number} className="wms-card">
                <div className="wms-card-top">
                  <strong>{s.number}</strong>
                  <span className="wms-muted">{shortWhen(s.dispatchedAt)}</span>
                </div>
                <span className="text-[13.5px]">
                  {s.kind === "replacement" ? "Replacement · " : ""}
                  {s.orderId ? <Link href={`/orders/${s.orderId}`} className="text-accent">{s.orderId}</Link> : null} · {s.serials.join(", ")}
                </span>
                <span className="wms-muted">
                  {s.carrier === "3pl" ? `${s.partner} · AWB ${s.awb}` : `With ${s.driver}`}
                  {s.trackingUrl ? <> · <a href={s.trackingUrl} target="_blank" rel="noreferrer" className="text-accent">Track</a></> : null}
                  {s.expectedDate ? ` · expected ${shortDate(s.expectedDate)}` : ""}
                </span>
                <div className="mt-1 flex flex-wrap gap-2">
                  <ActionForm action={shipmentAction} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="number" value={s.number} />
                    <input type="hidden" name="step" value="delivered" />
                    <input name="collected" inputMode="decimal" placeholder="Cash collected ₹ (if any)" className={`${inputClass} w-48`} aria-label="Cash collected" />
                    <SubmitButton small tone="good">Delivered</SubmitButton>
                  </ActionForm>
                  <ActionForm action={shipmentAction} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="number" value={s.number} />
                    <input type="hidden" name="step" value="failed" />
                    <input name="reason" required placeholder="Why it failed" className={`${inputClass} w-48`} aria-label="Why the delivery failed" />
                    <SubmitButton small tone="danger">Failed</SubmitButton>
                  </ActionForm>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[14px] text-muted">Nothing on the road.</p>
        )}
      </Panel>

      {failed.length ? (
        <Panel title={`Coming back (${failed.length})`} subtitle="Failed deliveries. Press when the units are back in the warehouse." className="mt-3">
          <div className="wms-card-list">
            {failed.map((s) => (
              <div key={s.number} className="wms-card">
                <div className="wms-card-top"><strong>{s.number}</strong><span className="wms-muted">{s.note}</span></div>
                <span className="text-[13.5px]">{s.serials.join(", ")}</span>
                <ActionForm action={shipmentAction}>
                  <input type="hidden" name="number" value={s.number} />
                  <input type="hidden" name="step" value="back" />
                  <SubmitButton small>Back in the warehouse</SubmitButton>
                </ActionForm>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      {recent.length ? (
        <Panel title="Recently closed" className="mt-3">
          <div className="wms-card-list">
            {recent.map((s) => (
              <div key={s.number} className="wms-card">
                <div className="wms-card-top"><strong>{s.number}</strong><span className="wms-muted">{s.status === "delivered" ? `Delivered ${shortWhen(s.deliveredAt)}` : s.status === "returned" ? "Came back" : s.status}</span></div>
                <span className="wms-muted">{s.kind === "rtv" ? `Back to ${s.vendor}` : s.orderId ?? ""} · {s.serials.join(", ")}</span>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </section>
  );
}

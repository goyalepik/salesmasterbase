import { deliveryStatusAction } from "@/app/actions/ops";
import { ActionForm, SubmitButton } from "@/components/ops/action-form";
import { inputClass } from "@/components/ops/bits";
import { DELIVERY_LABELS, DELIVERY_STATUSES, deliveryStatusOf, usesAppStock } from "@/lib/ops/delivery-status";
import type { OrderSummary } from "@/lib/ops/types";

/** One row's status form on Logistics, Order status: pick a status, optional date, driver and note, Save. */
export function DeliveryStatusForm({ order }: { order: OrderSummary }) {
  const current = deliveryStatusOf(order.stage);
  if (current === "cancelled") return <p className="text-[12px] text-muted">Cancelled{order.cancelReason ? `: ${order.cancelReason}` : ""}. A cancelled order stays cancelled.</p>;
  if (usesAppStock(order.lines)) return <p className="text-[12px] text-muted">Stock for this order is booked in the app. Use the buttons on the order page.</p>;
  return (
    // The key remounts the form after a save, so it shows the new status.
    <ActionForm key={`${order.stage}:${order.updatedAt}`} action={deliveryStatusAction} resetOnSuccess={false} className="grid gap-2">
      <input type="hidden" name="orderId" value={order.id} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <label className="col-span-2 block text-[12px] text-muted sm:col-span-1">
          Status
          <select name="status" defaultValue={current} className={`${inputClass} mt-1`} aria-label={`Status of ${order.shopifyOrderId ?? order.id}`}>
            {DELIVERY_STATUSES.map((s) => (
              <option key={s} value={s}>{DELIVERY_LABELS[s]}</option>
            ))}
          </select>
        </label>
        <label className="block text-[12px] text-muted">
          Expected delivery
          <input name="expected" type="date" defaultValue={order.expectedDeliveryDate ?? ""} className={`${inputClass} mt-1`} />
        </label>
        <label className="block text-[12px] text-muted">
          Driver
          <input name="driver" maxLength={60} defaultValue={order.driver ?? ""} placeholder="Optional" className={`${inputClass} mt-1`} />
        </label>
      </div>
      <div className="flex gap-2">
        <input name="note" maxLength={300} placeholder="Note (needed for On hold and Cancelled)" className={`${inputClass} min-w-0 flex-1`} aria-label="Note" />
        <SubmitButton small className="h-11 shrink-0 px-5">Save</SubmitButton>
      </div>
    </ActionForm>
  );
}

import Link from "next/link";
import { getWms } from "@/features/wms";
import { orderUnits } from "@/features/wms/flows";
import { UNIT_STATUS_LABELS } from "@/features/wms/domain/unit";
import { shortDate } from "@/lib/ops-ui/format";

/**
 * On the order card: each unit the warehouse sent for this order, its serial, AWB and tracking link, and a replacement
 * when there was one. Shows nothing while the warehouse screens are off or nothing was scanned out.
 */
export async function OrderWarehouseUnits({ orderId, withLinks = true }: { orderId: string; withLinks?: boolean }) {
  const ctx = await getWms();
  if (!ctx) return null;
  const rows = await orderUnits(ctx, orderId);
  if (!rows.length) return null;
  return (
    <section className="dashboard-panel mt-3">
      <h2 className="dashboard-panel-title mb-2">Units sent</h2>
      <div className="grid gap-2 text-[14px]">
        {rows.map(({ link, unit, shipment }) => (
          <div key={link.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            {withLinks && unit ? <Link href={`/wms/units/${unit.id}`} className="font-semibold text-accent">{link.serial}</Link> : <strong>{link.serial}</strong>}
            <span className="text-muted text-[13px]">
              {link.linkType === "replacement" ? "Replacement · " : ""}
              {!link.active ? "came back · " : unit ? `${UNIT_STATUS_LABELS[unit.status]} · ` : ""}
              {shipment ? (shipment.carrier === "3pl" ? `${shipment.partner}, AWB ${shipment.awb}` : `with ${shipment.driver}`) : ""}
              {shipment?.expectedDate ? ` · expected ${shortDate(shipment.expectedDate)}` : ""}
            </span>
            {shipment?.trackingUrl ? <a href={shipment.trackingUrl} target="_blank" rel="noreferrer" className="text-accent text-[13px]">Track</a> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

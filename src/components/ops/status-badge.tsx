import { DELIVERY_CODES, DELIVERY_LABELS, deliveryStatusOf } from "@/lib/ops/delivery-status";
import type { OrderStage } from "@/lib/ops/types";
import { DELIVERY_TONE } from "@/lib/ops-ui/delivery-board";

/** The order's status as the team's sheet code (NEW, CONFIRMED, EPIK_OFD…), plain words on hover. */
export function StatusBadge({ stage, plain = false }: { stage: OrderStage; plain?: boolean }) {
  const status = deliveryStatusOf(stage);
  return (
    <span className={`badge ${DELIVERY_TONE[status]} status-badge`} title={DELIVERY_LABELS[status]}>
      {plain ? DELIVERY_LABELS[status] : DELIVERY_CODES[status]}
    </span>
  );
}

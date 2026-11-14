import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { BlockedState } from "@/components/blocked-state";
import { OrderCardView } from "@/components/ops/order-card-view";
import { StatusPicker } from "@/components/ops/status-picker";
import { APP_ROLE_HOME } from "@/lib/app-roles";
import { deliveryStatusOf, usesAppStock } from "@/lib/ops/delivery-status";
import { currentSession } from "@/lib/ops-ui/actor";
import { loadOps } from "@/lib/ops-ui/load";

export const metadata = { title: "Order · EPIK" };

/** One simple card: who, what, how much, where it is. Inventory and Admin can change the status here. */
export default async function OrderCardPage({ params }: { params: Promise<{ id: string }> }) {
  const [ops, { id }, session] = await Promise.all([loadOps(), params, currentSession()]);
  if (ops.kind !== "ready") return <BlockedState health={ops.workspace.health} />;
  const order = await ops.store.getOrder(decodeURIComponent(id));
  if (!order) notFound();

  const status = deliveryStatusOf(order.stage);
  const label = order.shopifyOrderId ?? order.id;
  const canSet = (session.role === "inventory" || session.role === "admin") && status !== "cancelled" && !usesAppStock(order.lines);

  return (
    <section className="mx-auto max-w-[860px]">
      <Link href={APP_ROLE_HOME[session.role]} className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink"><ArrowLeft size={14} /> Back</Link>

      <OrderCardView
        order={order}
        statusControl={canSet ? <StatusPicker key={`${order.stage}:${order.updatedAt}`} orderId={order.id} status={status} expectedDate={order.expectedDeliveryDate} driver={order.driver} label={label} /> : undefined}
      />

      {session.role === "admin" ? (
        <Link href={`/orders/${encodeURIComponent(order.id)}/full`} className="mt-3 inline-flex items-center gap-1 text-[13px] text-info">
          Detailed view (payments, stock, Shopify) <ArrowUpRight size={14} />
        </Link>
      ) : null}
    </section>
  );
}

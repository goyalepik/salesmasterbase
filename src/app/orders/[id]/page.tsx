import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { BlockedState } from "@/components/blocked-state";
import { StatusBadge } from "@/components/ops/status-badge";
import { StatusPicker } from "@/components/ops/status-picker";
import { APP_ROLE_HOME } from "@/lib/app-roles";
import { DELIVERY_MEANING, deliveryStatusOf, usesAppStock } from "@/lib/ops/delivery-status";
import { isTestName } from "@/lib/ops/test-mode";
import { currentSession } from "@/lib/ops-ui/actor";
import { inr, shortDate, shortWhen } from "@/lib/ops-ui/format";
import { loadOps } from "@/lib/ops-ui/load";

export const metadata = { title: "Order · EPIK" };

const SOURCE = { slack: "Slack", desk: "Dashboard", import: "Imported sheet" } as const;

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="order-item">
      <dt>{label}</dt>
      <dd>{children || <span className="text-faint">—</span>}</dd>
    </div>
  );
}

/** One simple card: who, what, how much, where it is. Inventory and Admin can change the status here. */
export default async function OrderCardPage({ params }: { params: Promise<{ id: string }> }) {
  const [ops, { id }, session] = await Promise.all([loadOps(), params, currentSession()]);
  if (ops.kind !== "ready") return <BlockedState health={ops.workspace.health} />;
  const order = await ops.store.getOrder(decodeURIComponent(id));
  if (!order) notFound();

  const status = deliveryStatusOf(order.stage);
  const label = order.shopifyOrderId ?? order.id;
  const canSet = (session.role === "inventory" || session.role === "admin") && status !== "cancelled" && !usesAppStock(order.lines);
  const lines = order.lines.filter((l) => l.status !== "rejected");
  const events = [...order.events].reverse().slice(0, 12);
  const reason = status === "on_hold" ? order.holdReason : status === "cancelled" ? order.cancelReason : null;

  return (
    <section className="mx-auto max-w-[860px]">
      <Link href={APP_ROLE_HOME[session.role]} className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink"><ArrowLeft size={14} /> Back</Link>

      <div className="s-card order-card">
        <header className="order-head">
          <div className="min-w-0">
            <p className="text-[12.5px] text-faint">{label}{order.shopifyOrderId ? ` · ${order.id}` : ""} · {SOURCE[order.source]} · {shortWhen(order.createdAt)}</p>
            <h1>{order.customerName}</h1>
            <p className="mt-1 text-[14px] text-muted">{DELIVERY_MEANING[status]}{reason ? ` ${reason}` : ""}</p>
          </div>
          <div className="text-right">
            <StatusBadge stage={order.stage} />
            <p className="mt-2 text-[22px] font-bold tabular-nums tracking-[-0.02em]">{inr(order.offeredTotalMinor)}</p>
            <p className="text-[12px] text-faint">{order.declaredPaymentStatus ?? "Payment not stated"}</p>
          </div>
        </header>

        {isTestName(order.customerName) ? <p className="order-note">Test order: not sent to Shopify, the SMB sheet or the salespeople&apos;s page.</p> : null}

        {canSet ? (
          <div className="order-section">
            <h2>Status</h2>
            <StatusPicker key={`${order.stage}:${order.updatedAt}`} orderId={order.id} status={status} expectedDate={order.expectedDeliveryDate} driver={order.driver} label={label} />
          </div>
        ) : null}

        <div className="order-section">
          <h2>Products</h2>
          <ul className="order-lines">
            {lines.map((line) => (
              <li key={line.id}>
                <span className="min-w-0">
                  <span className="block font-medium text-ink">{line.productName}{line.qty > 1 ? ` ×${line.qty}` : ""}</span>
                  <span className="block text-[12px] text-faint">
                    {[line.sku, line.extendedWarranty && line.extendedWarranty !== "None" ? `Warranty ${line.extendedWarranty}` : null, line.installation === "Added" ? "Installation" : null, line.accessories].filter(Boolean).join(" · ") || "No SKU"}
                  </span>
                </span>
                <span className="text-right tabular-nums">
                  <span className="block font-semibold">{inr(line.offeredPriceMinor)}</span>
                  {line.listPriceMinor && line.listPriceMinor * line.qty > line.offeredPriceMinor ? <span className="block text-[12px] text-faint line-through">{inr(line.listPriceMinor * line.qty)}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <dl className="order-section order-grid">
          <Item label="Phone">{order.phone}</Item>
          <Item label="Email">{order.email}</Item>
          <Item label="Delivery address">{[order.shippingAddress, order.pincode].filter(Boolean).join(", ")}</Item>
          <Item label="Expected delivery">{order.expectedDeliveryDate ? shortDate(order.expectedDeliveryDate) : null}</Item>
          <Item label="Payment">{[order.declaredPaymentStatus, order.declaredPaymentMode].filter(Boolean).join(" · ")}</Item>
          <Item label="Driver">{order.driver}</Item>
          <Item label="Sold by">{[order.poc, order.hub].filter(Boolean).join(", ")}</Item>
          <Item label="Sale">{[order.saleSource, order.saleType, order.cxType].filter(Boolean).join(" · ")}</Item>
          {order.gst ? <Item label="GST">{order.gst}</Item> : null}
          {order.billingAddress ? <Item label="Billing address">{order.billingAddress}</Item> : null}
          {order.notes ? <Item label="Notes">{order.notes}</Item> : null}
        </dl>

        <div className="order-section">
          <h2>Timeline</h2>
          {events.length ? (
            <ol className="order-timeline">
              {events.map((e) => (
                <li key={e.id}>
                  <span className="text-faint tabular-nums">{shortWhen(e.createdAt)}</span>
                  <span className="min-w-0">{e.summary} <span className="text-faint">· {e.actor}</span></span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[13px] text-faint">Nothing yet.</p>
          )}
        </div>
      </div>

      {session.role === "admin" ? (
        <Link href={`/orders/${encodeURIComponent(order.id)}/full`} className="mt-3 inline-flex items-center gap-1 text-[13px] text-info">
          Detailed view (payments, stock, Shopify) <ArrowUpRight size={14} />
        </Link>
      ) : null}
    </section>
  );
}

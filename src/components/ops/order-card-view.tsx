import type { ReactNode } from "react";
import { Phone } from "lucide-react";
import { StatusBadge } from "@/components/ops/status-badge";
import { DELIVERY_MEANING, deliveryStatusOf } from "@/lib/ops/delivery-status";
import { isTestName } from "@/lib/ops/test-mode";
import type { OrderDetail } from "@/lib/ops/types";
import { inr, shortDate, shortWhen } from "@/lib/ops-ui/format";

const SOURCE = { slack: "Slack", desk: "Dashboard", import: "Imported sheet" } as const;

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="order-item">
      <dt>{label}</dt>
      <dd>{children || <span className="text-faint">—</span>}</dd>
    </div>
  );
}

/**
 * The order card: who, what, how much, where it is, what happened. The dashboard passes the status picker in
 * `statusControl`; the salespeople's page shows it read only, with plain status words and a tap-to-call phone.
 */
export function OrderCardView({ order, statusControl, forSalespeople = false }: { order: OrderDetail; statusControl?: ReactNode; forSalespeople?: boolean }) {
  const status = deliveryStatusOf(order.stage);
  const label = order.shopifyOrderId ?? order.id;
  const lines = order.lines.filter((l) => l.status !== "rejected");
  const events = [...order.events].reverse().slice(0, 12);
  const reason = status === "on_hold" ? order.holdReason : status === "cancelled" ? order.cancelReason : null;

  return (
    <div className="s-card order-card">
      <header className="order-head">
        <div className="min-w-0">
          <p className="text-[12.5px] text-faint">{label}{order.shopifyOrderId ? ` · ${order.id}` : ""} · {SOURCE[order.source]} · {shortWhen(order.createdAt)}</p>
          <h1>{order.customerName}</h1>
          <p className="mt-1 text-[14px] text-muted">{DELIVERY_MEANING[status]}{reason ? ` ${reason}` : ""}</p>
          {forSalespeople && order.expectedDeliveryDate && status !== "delivered" && status !== "cancelled" ? (
            <p className="mt-1 text-[14px] font-semibold text-info">Expected {shortDate(order.expectedDeliveryDate)}</p>
          ) : null}
        </div>
        <div className="order-head-side">
          <StatusBadge stage={order.stage} plain={forSalespeople} />
          <p className="mt-2 text-[22px] font-bold tabular-nums tracking-[-0.02em]">{inr(order.offeredTotalMinor)}</p>
          <p className="text-[12px] text-faint">{order.declaredPaymentStatus ?? "Payment not stated"}</p>
        </div>
      </header>

      {!forSalespeople && isTestName(order.customerName) ? <p className="order-note">Test order: not sent to Shopify, the SMB sheet or the salespeople&apos;s page.</p> : null}

      {statusControl ? (
        <div className="order-section">
          <h2>Status</h2>
          {statusControl}
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
                  {[forSalespeople ? null : line.sku, line.extendedWarranty && line.extendedWarranty !== "None" ? `Warranty ${line.extendedWarranty}` : null, line.installation === "Added" ? "Installation" : null, line.accessories && line.accessories !== "None" ? line.accessories : null].filter(Boolean).join(" · ") || (forSalespeople ? "" : "No SKU")}
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
        <Item label="Phone">
          {order.phone && forSalespeople ? (
            <a href={`tel:${order.phone}`} className="inline-flex items-center gap-1.5 font-medium text-info">
              <Phone size={14} aria-hidden="true" /> {order.phone}
            </a>
          ) : (
            order.phone
          )}
        </Item>
        <Item label="Email">{order.email}</Item>
        <Item label="Delivery address">{[order.shippingAddress, order.pincode].filter(Boolean).join(", ")}</Item>
        <Item label="Expected delivery">{order.expectedDeliveryDate ? shortDate(order.expectedDeliveryDate) : null}</Item>
        <Item label="Payment">{[order.declaredPaymentStatus, order.declaredPaymentMode].filter(Boolean).join(" · ")}</Item>
        <Item label="Driver">{order.driver}</Item>
        <Item label="Sold by">{[order.poc, order.hub].filter(Boolean).join(", ")}</Item>
        <Item label="Sale">{[order.saleSource, order.saleType, order.cxType].filter(Boolean).join(" · ")}</Item>
        {status === "delivered" && order.deliveredAt ? <Item label="Delivered">{shortWhen(order.deliveredAt)}</Item> : null}
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
  );
}

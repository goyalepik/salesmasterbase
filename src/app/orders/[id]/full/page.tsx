import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { BlockedState } from "@/components/blocked-state";
import { FoldPanel, LineBadge, Panel, StageBadge, TableWrap, ownerLabel } from "@/components/ops/bits";
import { KIND_LABELS, OrderActionPanel } from "@/components/ops/order-actions";
import { ShopifyPanel } from "@/components/ops/shopify-panel";
import { shopifyStatus } from "@/lib/shopify/run";
import { nextStep } from "@/lib/ops/service";
import { discountFlag, isTestName } from "@/lib/ops/test-mode";
import { PAYMENT_STATE_LABELS, paymentState, type PaymentState } from "@/lib/ops/payment-status";

const PAYMENT_TONE: Record<PaymentState, string> = { pending: "tone-warn", partially_paid: "tone-info", paid: "tone-good" };
import { utrAlsoOn } from "@/lib/slack/ops-actions";
import type { PurchaseOrder, StockLevel } from "@/lib/ops/types";
import { inr, shortDate, shortWhen } from "@/lib/ops-ui/format";
import { loadOps } from "@/lib/ops-ui/load";
import { channelLabel } from "@/lib/ops-ui/channel";

const SOURCE_LABELS = { slack: "Slack", desk: "Dashboard", import: "Imported sheet" } as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2 border-t border-line py-1.5 text-[13px] first:border-t-0">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children || <span className="text-faint">—</span>}</dd>
    </div>
  );
}

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [ops, { id }] = await Promise.all([loadOps(), params]);
  if (ops.kind !== "ready") return <BlockedState health={ops.workspace.health} />;
  const store = ops.store;
  const order = await store.getOrder(decodeURIComponent(id));
  if (!order) notFound();

  const skus = [...new Set(order.lines.map((l) => l.sku).filter((s): s is string => !!s))];
  const [levels, poLists] = await Promise.all([
    Promise.all(skus.map((sku) => store.stockFor(sku))),
    Promise.all(skus.map((sku) => store.listPurchaseOrders({ status: "open", sku }))),
  ]);
  const stock: Record<string, StockLevel | null> = Object.fromEntries(skus.map((sku, i) => [sku, levels[i]]));
  const pos: Record<string, PurchaseOrder[]> = Object.fromEntries(skus.map((sku, i) => [sku, poLists[i]]));
  const allPos = poLists.flat();
  const balance = Math.max(0, order.offeredTotalMinor - order.paidMinor);
  const events = [...order.events].reverse();
  const discount = discountFlag(order.lines);
  const sameUtr = await utrAlsoOn(store, order);
  const flags = [
    isTestName(order.customerName) ? "Test order: no Shopify order, not counted in any numbers. Settings → Clear test orders removes it." : null,
    discount ? `Offered ${Math.round(discount.share * 100)}% below the list price (list ${inr(discount.listMinor)}, offered ${inr(discount.offeredMinor)}).` : null,
    sameUtr.length ? `The same UTR is also on ${sameUtr.slice(0, 3).join(", ")}. Check it is not the same payment counted twice.` : null,
  ].filter((f): f is string => Boolean(f));

  return (
    <section>
      <Link href={`/orders/${encodeURIComponent(order.id)}`} className="mb-2 inline-flex items-center gap-1 text-[12px] text-muted"><ArrowLeft size={13} /> Simple view</Link>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">{order.id}</h1>
            <StageBadge stage={order.stage} />
            {order.shopifyOrderId ? <span className="badge tone-muted">{order.shopifyOrderId}</span> : null}
            <span className={`badge ${PAYMENT_TONE[paymentState(order)]}`}>Payment: {PAYMENT_STATE_LABELS[paymentState(order)]}</span>
            {isTestName(order.customerName) ? <span className="badge tone-warn">TEST</span> : null}
          </div>
          <p className="mt-1 text-[13px] text-muted">
            {order.customerName} · {order.createdBy === "Shopify" ? `Shopify ${channelLabel(order).label.toLowerCase()}` : SOURCE_LABELS[order.source]} · {shortWhen(order.createdAt)}
          </p>
        </div>
        <dl className="flex gap-4 text-right text-[12px]">
          <div><dt className="text-muted">Offered</dt><dd className="text-[16px] font-semibold tabular-nums">{inr(order.offeredTotalMinor)}</dd></div>
          <div><dt className="text-muted">Paid</dt><dd className="text-[16px] font-semibold tabular-nums text-good">{inr(order.paidMinor)}</dd></div>
          <div><dt className="text-muted">Balance</dt><dd className={`text-[16px] font-semibold tabular-nums ${balance && order.stage !== "cancelled" ? "text-warn" : ""}`}>{inr(balance)}</dd></div>
        </dl>
      </header>

      <div className="mb-2.5 rounded-[18px] border border-[rgba(140,186,255,0.4)] bg-[rgba(52,120,246,0.1)] px-4 py-3">
        <p className="text-[11px] tracking-[0.06em] text-info uppercase">Next step{ownerLabel(order.stage) !== "—" ? ` · ${ownerLabel(order.stage)}` : ""}</p>
        <p className="mt-0.5 text-[15px] text-ink">{nextStep(order)}</p>
        {order.holdReason && order.stage === "on_hold" ? <p className="mt-1 text-[13px] text-bad">On hold: {order.holdReason}</p> : null}
        {order.cancelReason && order.stage === "cancelled" ? <p className="mt-1 text-[13px] text-muted">Cancelled: {order.cancelReason}</p> : null}
        {flags.map((flag) => <p key={flag} className="mt-1 text-[13px] text-warn">⚠ {flag}</p>)}
        {[order.declaredPaymentStatus, order.declaredPaymentMode].some(Boolean) && order.stage === "awaiting_payment" ? (
          <p className="mt-1 text-[13px] text-muted">As entered: {[order.declaredPaymentStatus, order.declaredPaymentMode].filter(Boolean).join(" · ")}</p>
        ) : null}
      </div>

      <div className="detail-layout">
        <div>
          <Panel title="Products">
            <ul className="grid gap-1.5">
              {order.lines.map((line) => {
                const level = line.sku ? stock[line.sku] : null;
                const po = line.poId ? allPos.find((p) => p.id === line.poId) : null;
                const deciding = line.status === "pending" || line.status === "rejected";
                const extras = [
                  line.serialNo ? `Serial ${line.serialNo}` : "",
                  po ? `Backordered on ${po.poNumber}${po.eta ? `, ETA ${shortDate(po.eta)}` : ""}` : "",
                  line.rejectReason && line.status === "rejected" ? `Rejected: ${line.rejectReason}` : "",
                  deciding && line.sku ? `In stock: ${level?.available ?? 0} free${level?.incoming ? ` · ${level.incoming} incoming${level.nextEta ? ` ${shortDate(level.nextEta)}` : ""}` : ""}` : "",
                  [line.accessories, line.extendedWarranty, line.installation].filter((x) => x && !/^(none|no|not added)$/i.test(x)).join(" · "),
                ].filter(Boolean);
                return (
                  <li key={line.id} className="flex flex-wrap items-start justify-between gap-2 rounded-[12px] border border-line px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-medium text-ink">{line.qty > 1 ? `${line.qty} × ` : ""}{line.productName}</p>
                      <p className="text-[12px] text-faint">
                        {line.sku ?? <span className="text-warn">No SKU</span>} · {inr(line.offeredPriceMinor)}{line.listPriceMinor && line.listPriceMinor !== line.offeredPriceMinor ? <span> (list {inr(line.listPriceMinor)})</span> : null}
                      </p>
                      {extras.length ? <p className="mt-0.5 text-[12px] text-muted">{extras.join(" · ")}</p> : null}
                    </div>
                    <LineBadge status={line.status} />
                  </li>
                );
              })}
            </ul>
          </Panel>

          <FoldPanel title="Customer and delivery" subtitle={[order.customerName, order.phone, order.hub, order.poc].filter(Boolean).join(" · ")}>
            <dl>
              <Row label="Phone">{order.phone ? <a href={`tel:${order.phone}`} className="text-info">{order.phone}</a> : null}</Row>
              <Row label="Email">{order.email}</Row>
              <Row label="Ship to">{[order.shippingAddress, order.pincode].filter(Boolean).join(", ")}</Row>
              <Row label="Billing">{order.billingAddress ?? (order.shippingAddress ? "Same as shipping" : null)}</Row>
              <Row label="GST">{order.gst}</Row>
              <Row label="Hub · POC">{[order.hub, order.poc].filter(Boolean).join(" · ")}</Row>
              <Row label="Sale">{[order.cxType, order.saleSource, order.saleType].filter(Boolean).join(" · ")}</Row>
              {order.driver ? <Row label="Delivery">{`${order.driver}${order.expectedDeliveryDate ? ` · expected ${shortDate(order.expectedDeliveryDate)}` : ""}${order.deliveredAt ? ` · delivered ${shortWhen(order.deliveredAt)}` : ""}`}</Row> : order.expectedDeliveryDate ? <Row label="Expected">{shortDate(order.expectedDeliveryDate)}</Row> : null}
              {order.notes ? <Row label="Notes">{order.notes}</Row> : null}
            </dl>
          </FoldPanel>

          <FoldPanel
            title="Payments"
            subtitle={`${PAYMENT_STATE_LABELS[paymentState(order)]} · ${order.payments.length ? `${order.payments.length} verified` : "none verified yet"}${order.codDueMinor && order.stage !== "delivered" && order.stage !== "cancelled" ? ` · COD ${inr(order.codDueMinor)}` : ""}`}
          >
            {[order.declaredPaymentStatus, order.declaredPaymentMode].some(Boolean) ? (
              <p className="mb-2 text-[13px] text-muted">As entered: {[order.declaredPaymentStatus, order.declaredPaymentMode].filter(Boolean).join(" · ")}</p>
            ) : null}
            {order.payments.length ? (
              <TableWrap minWidth={520}>
                <thead><tr><th>When</th><th className="num">Amount</th><th>Mode</th><th>For</th><th>Reference</th><th>By</th></tr></thead>
                <tbody>
                  {order.payments.map((p) => (
                    <tr key={p.id}>
                      <td className="whitespace-nowrap text-muted">{shortWhen(p.createdAt)}</td>
                      <td className={`num ${p.status === "rejected" ? "text-bad line-through" : ""}`}>{inr(p.amountMinor)}</td>
                      <td>{p.mode}</td>
                      <td>{KIND_LABELS[p.kind] ?? p.kind}</td>
                      <td className="max-w-[140px] truncate">{p.reference ?? "—"}</td>
                      <td className="text-muted">{p.recordedBy}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            ) : (
              <p className="text-[13px] text-muted">No verified payment yet.</p>
            )}
          </FoldPanel>

          {order.procurement.length ? (
            <FoldPanel title="Procurement" subtitle={order.procurement.map((r) => `${r.vendor}: ${r.status}`).join(" · ")}>
              <TableWrap minWidth={520}>
                <thead><tr><th>Product</th><th>Vendor</th><th>Status</th><th>PO</th><th>ETA</th><th className="num">Cost</th></tr></thead>
                <tbody>
                  {order.procurement.map((r) => (
                    <tr key={r.id}>
                      <td className="max-w-[180px] truncate">{r.productName}</td>
                      <td>{r.vendor}</td>
                      <td className="capitalize">{r.status}</td>
                      <td>{r.poNumber ?? "—"}</td>
                      <td className="whitespace-nowrap">{shortDate(r.eta)}</td>
                      <td className="num">{inr(r.costMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </FoldPanel>
          ) : null}

          {order.installations.length ? (
            <FoldPanel title="Installation" subtitle={order.installations.map((i) => (i.status === "pending" ? `Due ${shortDate(i.dueDate)}` : i.status === "done" ? "Done" : "Not required")).join(" · ")}>
              <ul className="text-[13px]">
                {order.installations.map((i) => (
                  <li key={i.id} className="flex flex-wrap justify-between gap-2 border-t border-line py-2 first:border-t-0">
                    <span>{i.productName}</span>
                    <span className={i.status === "pending" ? "text-warn" : "text-good"}>
                      {i.status === "pending" ? `Due ${shortDate(i.dueDate)}` : i.status === "done" ? `Done ${shortWhen(i.doneAt)}${i.technician ? ` by ${i.technician}` : ""}` : "Not required"}
                    </span>
                  </li>
                ))}
              </ul>
            </FoldPanel>
          ) : null}

          <FoldPanel title="History" subtitle={events.length ? `${events.length} step${events.length === 1 ? "" : "s"} · last: ${events[0]!.summary.slice(0, 70)}` : "No history yet."}>
            {events.length ? (
              <ol className="text-[13px]">
                {events.map((e) => (
                  <li key={e.id} className="grid grid-cols-[100px_minmax(0,1fr)] gap-2 border-t border-line py-2 first:border-t-0">
                    <span className="text-[12px] tabular-nums text-faint">{shortWhen(e.createdAt)}</span>
                    <span className="min-w-0">
                      <span className="text-ink">{e.summary}</span>
                      <span className="block text-[11px] text-faint">{e.actor}</span>
                    </span>
                  </li>
                ))}
              </ol>
            ) : null}
          </FoldPanel>

          <FoldPanel title="Shopify" subtitle={order.shopifyOrderId ? `Linked to ${order.shopifyOrderId}` : "Not linked"}>
            <ShopifyPanel order={order} {...shopifyStatus()} />
          </FoldPanel>
        </div>
        <div>
          <Panel title="What to do">
            <OrderActionPanel order={order} stock={stock} pos={pos} />
          </Panel>
        </div>
      </div>
    </section>
  );
}

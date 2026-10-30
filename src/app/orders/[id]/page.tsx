import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { BlockedState } from "@/components/blocked-state";
import { LineBadge, Panel, StageBadge, TableWrap, ownerLabel } from "@/components/ops/bits";
import { KIND_LABELS, OrderActionPanel } from "@/components/ops/order-actions";
import { nextStep } from "@/lib/ops/service";
import type { PurchaseOrder, StockLevel } from "@/lib/ops/types";
import { inr, shortDate, shortWhen } from "@/lib/ops-ui/format";
import { loadOps } from "@/lib/ops-ui/load";

const SOURCE_LABELS = { slack: "Slack", desk: "Dashboard", import: "Imported sheet" } as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2 border-t border-line py-1.5 text-[13px] first:border-t-0">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children || <span className="text-faint">—</span>}</dd>
    </div>
  );
}

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
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

  return (
    <section>
      <Link href="/orders" className="mb-2 inline-flex items-center gap-1 text-[12px] text-muted"><ArrowLeft size={13} /> Orders</Link>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">{order.id}</h1>
            <StageBadge stage={order.stage} />
            {order.shopifyOrderId ? <span className="badge tone-muted">{order.shopifyOrderId}</span> : null}
          </div>
          <p className="mt-1 text-[13px] text-muted">
            {order.customerName} · {SOURCE_LABELS[order.source]} · {shortWhen(order.createdAt)}
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
      </div>

      <div className="detail-layout">
        <div>
          <Panel title="Products">
            <div className="grid gap-2">
              {order.lines.map((line) => {
                const level = line.sku ? stock[line.sku] : null;
                const po = line.poId ? allPos.find((p) => p.id === line.poId) : null;
                const extras = [
                  line.accessories ? `Accessories: ${line.accessories}` : "",
                  line.extendedWarranty ? `Warranty: ${line.extendedWarranty}` : "",
                  line.installation ? `Installation: ${line.installation}` : "",
                  line.serialNo ? `Serial: ${line.serialNo}` : "",
                  po ? `Held on ${po.poNumber}${po.eta ? `, ETA ${shortDate(po.eta)}` : ""}` : line.status === "awaiting_po" ? "Held on a PO" : "",
                  line.rejectReason && line.status === "rejected" ? `Rejected: ${line.rejectReason}` : "",
                ].filter(Boolean);
                return (
                  <div key={line.id} className="rounded-[14px] border border-line p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[14px] font-medium text-ink">{line.qty > 1 ? `${line.qty} × ` : ""}{line.productName}</p>
                        <p className="text-[12px] text-faint">{line.sku ?? <span className="text-warn">No SKU</span>}</p>
                      </div>
                      <LineBadge status={line.status} />
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-4">
                      <div><dt className="text-faint">List price</dt><dd className="tabular-nums">{inr(line.listPriceMinor)}</dd></div>
                      <div><dt className="text-faint">Offered</dt><dd className="tabular-nums">{inr(line.offeredPriceMinor)}</dd></div>
                      {line.sku ? (
                        <>
                          <div><dt className="text-faint">Free / reserved</dt><dd className="tabular-nums">{level ? `${level.available} / ${level.reserved}` : "0 / 0"}</dd></div>
                          <div><dt className="text-faint">Incoming</dt><dd className="tabular-nums">{level?.incoming ? `${level.incoming}${level.nextEta ? ` · ${shortDate(level.nextEta)}` : ""}` : "None"}</dd></div>
                        </>
                      ) : null}
                    </dl>
                    {extras.length ? <p className="mt-2 text-[12px] text-muted">{extras.join(" · ")}</p> : null}
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel title="Customer">
            <dl>
              <Row label="Name">{order.customerName}</Row>
              <Row label="Phone">{order.phone ? <a href={`tel:${order.phone}`} className="text-info">{order.phone}</a> : null}</Row>
              <Row label="Email">{order.email}</Row>
              <Row label="Ship to">{[order.shippingAddress, order.pincode].filter(Boolean).join(", ")}</Row>
              <Row label="Billing">{order.billingAddress ?? (order.shippingAddress ? "Same as shipping" : null)}</Row>
              <Row label="GST">{order.gst}</Row>
              <Row label="Hub · POC">{[order.hub, order.poc].filter(Boolean).join(" · ")}</Row>
              <Row label="Customer">{[order.cxType, order.saleSource, order.saleType].filter(Boolean).join(" · ")}</Row>
              <Row label="Declared">{[order.declaredPaymentStatus, order.declaredPaymentMode].filter(Boolean).join(" · ")}</Row>
              {order.driver ? <Row label="Delivery">{`${order.driver}${order.expectedDeliveryDate ? ` · expected ${shortDate(order.expectedDeliveryDate)}` : ""}${order.deliveredAt ? ` · delivered ${shortWhen(order.deliveredAt)}` : ""}`}</Row> : null}
              {order.notes ? <Row label="Notes">{order.notes}</Row> : null}
            </dl>
          </Panel>

          <Panel title="Payments" subtitle={order.codDueMinor && order.stage !== "delivered" && order.stage !== "cancelled" ? `COD to collect: ${inr(order.codDueMinor)}` : "Verified against the bank."}>
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
          </Panel>

          {order.procurement.length ? (
            <Panel title="Procurement">
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
            </Panel>
          ) : null}

          {order.installations.length ? (
            <Panel title="Installations">
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
            </Panel>
          ) : null}

          <Panel title="History" subtitle="Newest first.">
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
            ) : (
              <p className="text-[13px] text-muted">No history yet.</p>
            )}
          </Panel>
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

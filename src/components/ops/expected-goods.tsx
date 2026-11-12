import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { decideLineAction, procurementOrderedAction, procurementReceivedAction, receivePoAction } from "@/app/actions/ops";
import { ActionForm, SubmitButton } from "@/components/ops/action-form";
import { inputClass } from "@/components/ops/bits";
import { isoDateInIst } from "@/lib/format";
import type { OpsStore } from "@/lib/ops/store";
import type { StockLevel } from "@/lib/ops/types";
import { age, inr, requestNow, shortDate } from "@/lib/ops-ui/format";
import { buildBackorders, type WaitingLine } from "@/lib/ops-ui/inventory-queue";

/** Goods we are waiting for: brand POs (with orders already sold on them) and units bought for one customer. */
export async function ExpectedGoods({ store }: { store: OpsStore }) {
  const [stocking, deciding, pos, requests] = await Promise.all([
    store.listOrders({ stage: "awaiting_stock", limit: 500 }),
    store.listOrders({ stage: "awaiting_inventory", limit: 500 }),
    store.listPurchaseOrders({ status: "open" }),
    store.listProcurement({ status: "open" }),
  ]);
  const orders = [...stocking.items, ...deciding.items];
  const skus = [...new Set(orders.flatMap((o) => o.lines.filter((l) => l.status === "awaiting_po" || l.status === "procuring").map((l) => l.sku)).filter((s): s is string => !!s))];
  const levels = await Promise.all(skus.map((sku) => store.stockFor(sku)));
  const stock: Record<string, StockLevel | null> = Object.fromEntries(skus.map((s, i) => [s, levels[i]]));
  const today = isoDateInIst(new Date());
  const { onPo, buying } = buildBackorders(orders, pos, requests, stock, today);
  const now = requestNow();

  const poUnits = onPo.reduce((sum, g) => sum + g.waitingQty, 0);
  const late = onPo.filter((g) => g.late).length + buying.filter((b) => b.late).length;
  const freeNow = onPo.reduce((sum, g) => sum + g.waiting.filter((w) => w.freeNow).length, 0) + buying.filter((b) => b.freeNow).length;
  const cells = [
    { label: "Waiting on a brand PO", value: poUnits, note: `${onPo.length} PO${onPo.length === 1 ? "" : "s"}` },
    { label: "Buying for a customer", value: buying.length, note: "From a vendor" },
    { label: "Past the expected date", value: late, tone: late ? "bad" : undefined, note: late ? "Call the vendor" : "All on time" },
    { label: "Stock is free now", value: freeNow, tone: freeNow ? "good" : undefined, note: freeNow ? "Allocate them below" : "Nothing yet" },
  ];

  return (
    <>
      <dl className="inv-strip is-4">
        {cells.map((cell) => (
          <div key={cell.label}>
            <dt>{cell.label}</dt>
            <dd className={cell.tone ? `is-${cell.tone}` : undefined}>{cell.value}</dd>
            <p>{cell.note}</p>
          </div>
        ))}
      </dl>

      <h2 className="mb-2 mt-1 text-[15px] font-semibold text-ink">Arriving on a brand PO, already sold</h2>
      {!onPo.length ? (
        <div className="inv-empty mb-4">Nothing is backordered on a PO. Inventory picks “Backorder” on New orders when a PO is on the way.</div>
      ) : (
        <div className="bo-grid mb-5">
          {onPo.map((group) => {
            const po = group.po;
            const pending = po ? po.qtyOrdered - po.qtyReceived : 0;
            return (
              <article key={group.poId} className={`bo-card ${!po ? "is-lost" : group.late ? "is-late" : ""}`}>
                <div className="bo-top">
                  <span className="bo-title">{po ? po.poNumber : "PO closed"}</span>
                  <span className="bo-when">{po ? (po.eta ? `${group.late ? "Was due" : "Due"} ${shortDate(po.eta)}` : "No ETA") : "Decide again"}</span>
                </div>
                <p className="bo-prod" title={po?.productName ?? group.waiting[0]?.line.productName}>{po?.productName ?? group.waiting[0]?.line.productName}</p>
                <p className="bo-sub">
                  {po ? `${po.vendor ?? "Vendor not set"} · ${pending} of ${po.qtyOrdered} still to arrive · ${group.waitingQty} sold` : "This PO was fully received or closed, but these products still wait. Allocate if stock is free, or open the order to procure."}
                </p>
                <WaitingList items={group.waiting} now={now} />
                {po ? (
                  <details className="action-more">
                    <summary>Goods arrived: receive</summary>
                    <ActionForm action={receivePoAction} className="grid gap-2 pb-1">
                      <input type="hidden" name="poId" value={po.id} />
                      <div className="grid grid-cols-[80px_minmax(0,1fr)] gap-2">
                        <label className="block text-[12px] text-muted">
                          Qty
                          <input name="qty" type="number" min={1} max={pending} defaultValue={pending} required className={`mt-1 ${inputClass}`} />
                        </label>
                        <label className="block text-[12px] text-muted">
                          Cost per unit (₹)
                          <input name="cost" inputMode="decimal" placeholder="Optional" className={`mt-1 ${inputClass}`} />
                        </label>
                      </div>
                      <label className="block text-[12px] text-muted">
                        Serial numbers
                        <textarea name="serials" rows={2} placeholder="One per line, optional" className="field mt-1 w-full px-3 py-2 text-[13px] outline-none" />
                      </label>
                      <SubmitButton tone="good" small>Received: allocate to waiting orders</SubmitButton>
                    </ActionForm>
                  </details>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      <h2 className="mb-2 text-[15px] font-semibold text-ink">Bought for one customer</h2>
      {!buying.length ? (
        <div className="inv-empty">Nothing being bought. Inventory picks “Procure” on New orders when no stock and no PO.</div>
      ) : (
        <div className="bo-grid">
          {buying.map(({ request, order, line, late, freeNow }) => (
            <article key={request.id} className={`bo-card is-buy ${late ? "is-late" : ""}`}>
              <div className="bo-top">
                <span className="bo-title">{request.vendor}</span>
                <span className="bo-when">{request.eta ? `${late ? "Was due" : "Due"} ${shortDate(request.eta)}` : "No ETA"}</span>
              </div>
              <p className="bo-prod" title={request.productName}>{line && line.qty > 1 ? `${line.qty}× ` : ""}{request.productName}</p>
              <p className="bo-sub">
                {request.status === "ordered" ? `Ordered${request.poNumber ? ` on ${request.poNumber}` : ""}` : "Requested, not ordered yet"}
                {request.costMinor ? ` · ${inr(request.costMinor)} a unit` : ""}
              </p>
              {order && line ? <WaitingList items={[{ order, line, freeNow }]} now={now} /> : null}
              <details className="action-more">
                <summary>Goods arrived: receive</summary>
                <ActionForm action={procurementReceivedAction} className="grid gap-2 pb-1">
                  <input type="hidden" name="requestId" value={request.id} />
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-[12px] text-muted">
                      Serial number
                      <input name="serial" maxLength={80} placeholder="Optional" className={`mt-1 ${inputClass}`} />
                    </label>
                    <label className="block text-[12px] text-muted">
                      Cost per unit (₹)
                      <input name="cost" inputMode="decimal" placeholder={request.costMinor ? String(request.costMinor / 100) : "Optional"} className={`mt-1 ${inputClass}`} />
                    </label>
                  </div>
                  <SubmitButton tone="good" small>Received: allocate to this order</SubmitButton>
                </ActionForm>
              </details>
              <details className="action-more">
                <summary>{request.status === "ordered" ? "Update PO number or date" : "Mark ordered with the vendor"}</summary>
                <ActionForm action={procurementOrderedAction} className="grid gap-2 pb-1">
                  <input type="hidden" name="requestId" value={request.id} />
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-[12px] text-muted">
                      PO number
                      <input name="poNumber" maxLength={40} defaultValue={request.poNumber ?? ""} className={`mt-1 ${inputClass}`} />
                    </label>
                    <label className="block text-[12px] text-muted">
                      Expected date
                      <input name="eta" type="date" defaultValue={request.eta ?? ""} className={`mt-1 ${inputClass}`} />
                    </label>
                  </div>
                  <SubmitButton tone="quiet" small>Save</SubmitButton>
                </ActionForm>
              </details>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

/** The orders waiting, oldest first. When stock has come in since, one tap allocates it. */
function WaitingList({ items, now }: { items: WaitingLine[]; now: number }) {
  return (
    <ul className="bo-waiting">
      {items.map(({ order, line, freeNow }) => (
        <li key={line.id} className={freeNow ? "is-free" : undefined}>
          <Link href={`/orders/${encodeURIComponent(order.id)}`}>{order.id}</Link>
          <span>{line.qty > 1 ? `${line.qty}× · ` : ""}{order.customerName} · {age(order.createdAt, now)}</span>
          {freeNow ? (
            <ActionForm action={decideLineAction}>
              <input type="hidden" name="lineId" value={line.id} />
              <input type="hidden" name="decision" value="reserve" />
              <button type="submit" className="bo-free-btn"><CheckCircle2 size={13} /> In stock: allocate</button>
            </ActionForm>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

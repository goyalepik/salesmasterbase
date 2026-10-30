import type { ReactNode } from "react";
import Link from "next/link";
import {
  cancelOrderAction,
  clearWithoutPaymentAction,
  completeInstallationAction,
  decideLineAction,
  deliveredAction,
  mapSkuAction,
  noteAction,
  outForDeliveryAction,
  procurementOrderedAction,
  procurementReceivedAction,
  shopifyAction,
  verifyPaymentAction,
} from "@/app/actions/ops";
import { ActionForm, SubmitButton } from "@/components/ops/action-form";
import { Field, LineBadge, inputClass } from "@/components/ops/bits";
import { ProductPicker } from "@/components/ops/product-picker";
import { isoDateInIst } from "@/lib/format";
import {
  OPEN_STAGES,
  PAYMENT_KINDS,
  PAYMENT_MODES,
  type Installation,
  type OrderDetail,
  type OrderLine,
  type OrderSummary,
  type PaymentKind,
  type ProcurementRequest,
  type PurchaseOrder,
  type StockLevel,
} from "@/lib/ops/types";
import { inr, shortDate } from "@/lib/ops-ui/format";

export const KIND_LABELS: Record<PaymentKind, string> = {
  advance: "Advance",
  full: "Full payment",
  balance: "Balance",
  cod: "Cash on delivery",
  finance: "Finance (Bajaj, Snapmint)",
};

const DECIDABLE_STAGES = ["awaiting_inventory", "awaiting_stock", "on_hold"];
const DECIDABLE_LINES: OrderLine["status"][] = ["pending", "rejected", "awaiting_po", "procuring"];

function Hidden({ name, value }: { name: string; value: string }) {
  return <input type="hidden" name={name} value={value} />;
}

function Block({ title, note, children, tone }: { title: string; note?: ReactNode; children: ReactNode; tone?: "main" }) {
  return (
    <div className={`action-block ${tone === "main" ? "!border-[rgba(140,186,255,0.45)] !bg-[rgba(52,120,246,0.07)]" : ""}`}>
      <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
      {note ? <p className="mt-0.5 text-[12px] text-muted">{note}</p> : null}
      <div className="mt-3">{children}</div>
    </div>
  );
}

function More({ summary, children, open = false }: { summary: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="action-more" open={open}>
      <summary>{summary}</summary>
      <div className="pb-2">{children}</div>
    </details>
  );
}

function rupees(minor: number): string {
  return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2);
}

function tomorrow(): string {
  return isoDateInIst(new Date(Date.now() + 24 * 60 * 60 * 1000));
}

// ── Payment ──────────────────────────────────────────────────────────────────

export function PaymentForm({ order, primary }: { order: OrderSummary; primary: boolean }) {
  const declaredMode = (PAYMENT_MODES as readonly string[]).includes(order.declaredPaymentMode ?? "") ? order.declaredPaymentMode! : "";
  const kind: PaymentKind = /advance/i.test(order.declaredPaymentStatus ?? "") ? "advance" : order.paidMinor > 0 ? "balance" : "full";
  return (
    <ActionForm action={verifyPaymentAction} className="grid gap-3">
      <Hidden name="orderId" value={order.id} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount received (₹)">
          <input name="amount" inputMode="decimal" required placeholder="25000" className={inputClass} />
        </Field>
        <Field label="Mode">
          <select name="mode" required defaultValue={declaredMode} className={inputClass}>
            <option value="" disabled>Choose</option>
            {PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="What is it for">
          <select name="kind" defaultValue={kind} className={inputClass}>
            {PAYMENT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
          </select>
        </Field>
        <Field label="Reference / UTR">
          <input name="reference" maxLength={80} placeholder="Optional" className={inputClass} />
        </Field>
      </div>
      {order.stage === "awaiting_payment" ? (
        <label className="flex min-h-11 items-center gap-2.5 text-[14px]">
          <input type="checkbox" name="clear" defaultChecked className="size-5 accent-[#3478f6]" />
          Send to inventory after saving
        </label>
      ) : null}
      <SubmitButton tone={primary ? "good" : "quiet"}>Verify payment</SubmitButton>
    </ActionForm>
  );
}

export function ClearWithoutPaymentForm({ orderId }: { orderId: string }) {
  return (
    <ActionForm action={clearWithoutPaymentAction} className="grid gap-3">
      <Hidden name="orderId" value={orderId} />
      <Field label="Why is it cleared without payment?" hint="For example: Bajaj finance approved, or trusted repeat customer.">
        <input name="reason" required minLength={3} maxLength={300} className={inputClass} />
      </Field>
      <SubmitButton tone="quiet">Clear and send to inventory</SubmitButton>
    </ActionForm>
  );
}

// ── Inventory: one block per product line ───────────────────────────────────

export function LineDecisionBlock({ line, stock, pos }: { line: OrderLine; stock: StockLevel | null; pos: PurchaseOrder[] }) {
  const free = stock?.available ?? 0;
  const enough = !!line.sku && free >= line.qty;
  return (
    <div className="action-block">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[14px] font-medium text-ink">{line.qty > 1 ? `${line.qty} × ` : ""}{line.productName}</p>
          <p className="text-[12px] text-faint">{line.sku ?? "No SKU yet"}</p>
        </div>
        <LineBadge status={line.status} />
      </div>
      <p className={`mt-2 text-[13px] ${!line.sku ? "text-warn" : enough ? "text-good" : "text-warn"}`}>
        {!line.sku ? "Map this product to a SKU to check stock." : `${free} free in stock${stock?.reserved ? `, ${stock.reserved} reserved` : ""}${stock?.incoming ? `, ${stock.incoming} incoming${stock.nextEta ? ` (next ${shortDate(stock.nextEta)})` : ""}` : ""}.`}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <ActionForm action={decideLineAction}>
          <Hidden name="lineId" value={line.id} />
          <Hidden name="decision" value="reserve" />
          <SubmitButton tone={enough ? "good" : "quiet"}>Reserve from stock</SubmitButton>
        </ActionForm>
        <ActionForm action={decideLineAction}>
          <Hidden name="lineId" value={line.id} />
          <Hidden name="decision" value="brand_direct" />
          <SubmitButton tone="quiet">Brand ships direct</SubmitButton>
        </ActionForm>
      </div>
      <div className="mt-2">
        {!line.sku || line.status === "pending" || line.status === "rejected" ? (
          <More summary={line.sku ? "Change SKU" : "Map to a SKU"} open={!line.sku}>
            <ActionForm action={mapSkuAction} className="grid gap-2">
              <Hidden name="lineId" value={line.id} />
              <ProductPicker skuField="sku" label="Catalogue product" requireSku />
              <SubmitButton tone="quiet" small>Save SKU</SubmitButton>
            </ActionForm>
          </More>
        ) : null}
        <More summary={pos.length ? `Hold on an incoming PO (${pos.length} open)` : "Hold on an incoming PO (none open)"}>
          {pos.length ? (
            <ActionForm action={decideLineAction} className="grid gap-2">
              <Hidden name="lineId" value={line.id} />
              <Hidden name="decision" value="hold_po" />
              <Field label="Purchase order">
                <select name="poId" required className={inputClass} defaultValue={pos.length === 1 ? pos[0].id : ""}>
                  <option value="" disabled>Choose</option>
                  {pos.map((po) => (
                    <option key={po.id} value={po.id}>
                      {po.poNumber} · {po.qtyOrdered - po.qtyReceived} pending{po.eta ? ` · ETA ${shortDate(po.eta)}` : ""}{po.vendor ? ` · ${po.vendor}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <SubmitButton tone="quiet" small>Hold on this PO</SubmitButton>
            </ActionForm>
          ) : (
            <p className="text-[12px] text-muted">{line.sku ? "No open purchase order for this SKU. Use Procure instead." : "Map a SKU first."}</p>
          )}
        </More>
        <More summary="Procure for this customer">
          <ActionForm action={decideLineAction} className="grid gap-2">
            <Hidden name="lineId" value={line.id} />
            <Hidden name="decision" value="procure" />
            <Field label="Vendor">
              <input name="vendor" required maxLength={80} placeholder="Distributor or brand" className={inputClass} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Cost per unit (₹)">
                <input name="cost" inputMode="decimal" placeholder="Optional" className={inputClass} />
              </Field>
              <Field label="Expected date">
                <input name="eta" type="date" className={inputClass} />
              </Field>
            </div>
            <SubmitButton tone="quiet" small>Request procurement</SubmitButton>
          </ActionForm>
        </More>
        {line.status !== "rejected" ? (
          <More summary="Reject">
            <ActionForm action={decideLineAction} className="grid gap-2">
              <Hidden name="lineId" value={line.id} />
              <Hidden name="decision" value="reject" />
              <Field label="Reason" hint="Sales sees this. Say what they should tell the customer.">
                <input name="reason" required maxLength={300} placeholder="Discontinued, no stock anywhere…" className={inputClass} />
              </Field>
              <SubmitButton tone="danger" small>Reject this product</SubmitButton>
            </ActionForm>
          </More>
        ) : (
          <p className="mt-1 text-[12px] text-bad">Rejected: {line.rejectReason ?? "no reason given"}</p>
        )}
      </div>
    </div>
  );
}

export function MapSkuOnly({ line }: { line: OrderLine }) {
  return (
    <div className="action-block">
      <p className="text-[14px] font-medium text-ink">{line.productName}</p>
      <p className="text-[12px] text-warn">No SKU yet. Map it now so inventory can check stock.</p>
      <ActionForm action={mapSkuAction} className="mt-2 grid gap-2">
        <Hidden name="lineId" value={line.id} />
        <ProductPicker skuField="sku" label="Catalogue product" requireSku />
        <SubmitButton tone="quiet" small>Save SKU</SubmitButton>
      </ActionForm>
    </div>
  );
}

// ── Procurement ──────────────────────────────────────────────────────────────

export function ProcurementForms({ request }: { request: ProcurementRequest }) {
  return (
    <div className="action-block">
      <p className="text-[14px] font-medium text-ink">{request.productName}</p>
      <p className="text-[12px] text-muted">
        From {request.vendor} · {request.status === "ordered" ? `Ordered${request.poNumber ? ` on ${request.poNumber}` : ""}` : "Requested, not ordered yet"}
        {request.eta ? ` · ETA ${shortDate(request.eta)}` : ""}
      </p>
      <ActionForm action={procurementReceivedAction} className="mt-3 grid gap-2">
        <Hidden name="requestId" value={request.id} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Serial number">
            <input name="serial" maxLength={80} placeholder="Optional" className={inputClass} />
          </Field>
          <Field label="Cost per unit (₹)">
            <input name="cost" inputMode="decimal" placeholder={request.costMinor ? rupees(request.costMinor) : "Optional"} className={inputClass} />
          </Field>
        </div>
        <SubmitButton tone="good">Goods received</SubmitButton>
      </ActionForm>
      <More summary={request.status === "ordered" ? "Update PO number or ETA" : "Mark ordered with the vendor"}>
        <ActionForm action={procurementOrderedAction} className="grid gap-2">
          <Hidden name="requestId" value={request.id} />
          <div className="grid grid-cols-2 gap-2">
            <Field label="PO number">
              <input name="poNumber" maxLength={40} defaultValue={request.poNumber ?? ""} className={inputClass} />
            </Field>
            <Field label="Expected date">
              <input name="eta" type="date" defaultValue={request.eta ?? ""} className={inputClass} />
            </Field>
          </div>
          <SubmitButton tone="quiet" small>Mark ordered</SubmitButton>
        </ActionForm>
      </More>
    </div>
  );
}

// ── Logistics ────────────────────────────────────────────────────────────────

export function DispatchForm({ order }: { order: OrderSummary }) {
  const reserved = order.lines.filter((l) => l.status === "reserved");
  const direct = order.lines.filter((l) => l.status === "brand_direct");
  return (
    <ActionForm action={outForDeliveryAction} className="grid gap-3">
      <Hidden name="orderId" value={order.id} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Delivery person">
          <input name="driver" required maxLength={60} placeholder="Name" className={inputClass} />
        </Field>
        <Field label="Expected delivery">
          <input name="expectedDate" type="date" defaultValue={tomorrow()} className={inputClass} />
        </Field>
      </div>
      {reserved.map((line) => (
        <Field key={line.id} label={`Serial: ${line.productName}`}>
          <input name={`serial_${line.id}`} maxLength={80} placeholder="Scan or type" className={inputClass} />
        </Field>
      ))}
      {direct.length ? <p className="text-[12px] text-muted">{direct.map((l) => l.productName).join(", ")}: shipped by the brand.</p> : null}
      {order.codDueMinor ? <p className="text-[13px] text-warn">Collect {inr(order.codDueMinor)} on delivery.</p> : null}
      <SubmitButton tone="good">Out for delivery</SubmitButton>
    </ActionForm>
  );
}

export function DeliveredForm({ order }: { order: OrderSummary }) {
  return (
    <ActionForm action={deliveredAction} className="grid gap-3">
      <Hidden name="orderId" value={order.id} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Collected (₹)" hint={order.codDueMinor ? `COD due ${inr(order.codDueMinor)}` : "Nothing due. Leave 0."}>
          <input name="collected" inputMode="decimal" defaultValue={rupees(order.codDueMinor)} className={inputClass} />
        </Field>
        <Field label="Mode">
          <select name="mode" defaultValue="Cash" className={inputClass}>
            {PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
      </div>
      <SubmitButton tone="good">Delivered</SubmitButton>
    </ActionForm>
  );
}

export function InstallationForm({ item, compact = false }: { item: Installation; compact?: boolean }) {
  return (
    <ActionForm action={completeInstallationAction} className="grid gap-2">
      <Hidden name="installationId" value={item.id} />
      {compact ? null : <p className="text-[14px] font-medium text-ink">{item.productName}</p>}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Technician">
          <input name="technician" maxLength={60} placeholder="Name" className={inputClass} />
        </Field>
        <Field label="Note">
          <input name="note" maxLength={300} placeholder="Optional" className={inputClass} />
        </Field>
      </div>
      <label className="flex min-h-9 items-center gap-2 text-[13px] text-muted">
        <input type="checkbox" name="notRequired" className="size-4 accent-[#3478f6]" />
        Customer did not need installation
      </label>
      <SubmitButton tone="good" small={compact}>Installation done</SubmitButton>
    </ActionForm>
  );
}

// ── Whole panel ──────────────────────────────────────────────────────────────

export function OrderActionPanel({ order, stock, pos }: { order: OrderDetail; stock: Record<string, StockLevel | null>; pos: Record<string, PurchaseOrder[]> }) {
  const stage = order.stage;
  const decidable = DECIDABLE_STAGES.includes(stage);
  const linesToDecide = decidable ? order.lines.filter((l) => DECIDABLE_LINES.includes(l.status)) : [];
  const needDecision = linesToDecide.filter((l) => l.status === "pending" || l.status === "rejected");
  const onOrder = linesToDecide.filter((l) => l.status === "awaiting_po" || l.status === "procuring");
  const unmappedEarly = stage === "awaiting_payment" ? order.lines.filter((l) => !l.sku && l.status === "pending") : [];
  const openProcurement = order.procurement.filter((p) => p.status === "requested" || p.status === "ordered");
  const pendingInstalls = order.installations.filter((i) => i.status === "pending");
  const cancellable = stage !== "out_for_delivery" && OPEN_STAGES.includes(stage);

  return (
    <div className="grid gap-2.5">
      {stage === "awaiting_payment" ? (
        <Block title="Verify payment" note="Check the bank or the payment app first. Offered price is not money received." tone="main">
          <PaymentForm order={order} primary />
          <More summary="Clear without payment">
            <ClearWithoutPaymentForm orderId={order.id} />
          </More>
        </Block>
      ) : null}

      {unmappedEarly.map((line) => <MapSkuOnly key={line.id} line={line} />)}

      {needDecision.length ? (
        <Block title="Decide stock" note="One decision per product. The order moves on when every product has one." tone="main">
          <div className="grid gap-2.5">
            {needDecision.map((line) => (
              <LineDecisionBlock key={line.id} line={line} stock={line.sku ? stock[line.sku] ?? null : null} pos={line.sku ? pos[line.sku] ?? [] : []} />
            ))}
          </div>
        </Block>
      ) : null}

      {openProcurement.length ? (
        <Block title="Procurement" note="Goods bought for this customer. Receiving them reserves the stock." tone={stage === "awaiting_stock" ? "main" : undefined}>
          <div className="grid gap-2.5">
            {openProcurement.map((request) => <ProcurementForms key={request.id} request={request} />)}
          </div>
        </Block>
      ) : null}

      {stage === "awaiting_stock" && order.lines.some((l) => l.status === "awaiting_po") ? (
        <Block title="Held on a purchase order" note="These products are reserved automatically when the PO is received on the Procurement page.">
          <Link href="/procurement" className="text-[13px] text-info">Open Procurement</Link>
        </Block>
      ) : null}

      {onOrder.length ? (
        <More summary={`Change stock decision (${onOrder.length} on order)`}>
          <div className="grid gap-2.5">
            {onOrder.map((line) => (
              <LineDecisionBlock key={line.id} line={line} stock={line.sku ? stock[line.sku] ?? null : null} pos={line.sku ? pos[line.sku] ?? [] : []} />
            ))}
          </div>
        </More>
      ) : null}

      {stage === "ready_to_dispatch" ? (
        <Block title="Dispatch" note="Stock is ready. Assign who delivers it." tone="main">
          <DispatchForm order={order} />
        </Block>
      ) : null}

      {stage === "out_for_delivery" ? (
        <Block title="Confirm delivery" note={order.driver ? `With ${order.driver}${order.expectedDeliveryDate ? `, expected ${shortDate(order.expectedDeliveryDate)}` : ""}.` : undefined} tone="main">
          <DeliveredForm order={order} />
        </Block>
      ) : null}

      {pendingInstalls.length ? (
        <Block title="Installation" note={`Due ${shortDate(pendingInstalls[0].dueDate)}.`} tone="main">
          <div className="grid gap-4">
            {pendingInstalls.map((item) => <InstallationForm key={item.id} item={item} />)}
          </div>
        </Block>
      ) : null}

      <Block title="More">
        {stage !== "awaiting_payment" && stage !== "cancelled" ? (
          <More summary="Record a payment">
            <PaymentForm order={order} primary={false} />
          </More>
        ) : null}
        <More summary={order.shopifyOrderId ? `Shopify ${order.shopifyOrderId}: change` : "Link Shopify order (#PIK)"}>
          <ActionForm action={shopifyAction} className="grid gap-2">
            <Hidden name="orderId" value={order.id} />
            <Field label="Shopify order number">
              <input name="shopifyId" required maxLength={20} placeholder="#PIK3918" defaultValue={order.shopifyOrderId ?? ""} className={inputClass} />
            </Field>
            <SubmitButton tone="quiet" small>Link</SubmitButton>
          </ActionForm>
        </More>
        <More summary="Add a note">
          <ActionForm action={noteAction} className="grid gap-2">
            <Hidden name="orderId" value={order.id} />
            <Field label="Note">
              <textarea name="note" required maxLength={500} rows={3} className="field w-full px-3 py-2 text-[14px] outline-none" placeholder="Customer asked for evening delivery…" />
            </Field>
            <SubmitButton tone="quiet" small>Add note</SubmitButton>
          </ActionForm>
        </More>
        {cancellable ? (
          <More summary="Cancel order">
            <ActionForm action={cancelOrderAction} className="grid gap-2" confirm="Cancel this order? Reserved stock is released.">
              <Hidden name="orderId" value={order.id} />
              <Field label="Reason">
                <input name="reason" required maxLength={300} placeholder="Customer changed mind…" className={inputClass} />
              </Field>
              <SubmitButton tone="danger" small>Cancel order</SubmitButton>
            </ActionForm>
          </More>
        ) : null}
      </Block>
    </div>
  );
}

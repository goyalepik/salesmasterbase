"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Ban, CheckCircle2, Clock3, Loader2, PackageSearch, ShoppingCart, Truck, X } from "lucide-react";
import { allocateOrderAction, allocateReadyAction, decideLineAction, mapSkuAction } from "@/app/actions/ops";
import { ActionForm, SubmitButton, useFormPending } from "@/components/ops/action-form";
import { Field, inputClass } from "@/components/ops/bits";
import { ProductPicker } from "@/components/ops/product-picker";
import type { QueueGroup, QueueLine } from "@/lib/ops-ui/inventory-queue";
import { shortDate } from "@/lib/ops-ui/format";

type Panel = "sku" | "po" | "procure" | "reject" | null;

export type QueueOrderView = {
  id: string;
  customer: string;
  /** Where the sale came from: Website, Slack · Home Demo, Dashboard, Old sheet. */
  source: string;
  /** The customer's city, when the address or pincode says it. */
  city: string | null;
  /** The seller (POC), when it is a person rather than the channel. */
  poc: string | null;
  pay: { label: string; tone: "good" | "warn" | "bad" };
  age: string;
  ageTone: "" | "is-late" | "is-old";
  group: QueueGroup;
  allocatable: number;
  pendingCount: number;
};

/**
 * One new order, read left to right: where it came from, who and where, the product, its stock, then the choices.
 * An order with several products repeats only the product, stock and choices on the next rows.
 */
export function QueueOrderCard({ order, lines }: { order: QueueOrderView; lines: QueueLine[] }) {
  const lead = (
    <>
      <div className="iq-src">
        <span className="iq-src-chip">{order.source}</span>
        <Link href={`/orders/${encodeURIComponent(order.id)}`} className="iq-id">{order.id}</Link>
      </div>
      <div className="iq-who">
        <p className="iq-customer" title={order.customer}>{order.customer}</p>
        <p className="iq-meta">
          {order.city ? <span>{order.city}</span> : null}
          {order.poc ? <span>by {order.poc}</span> : null}
        </p>
        <p className="iq-tags">
          <span className={`iq-pay is-${order.pay.tone}`}>{order.pay.label}</span>
          <span className={`iq-age ${order.ageTone}`} title="Since the sale">{order.age}</span>
        </p>
        {order.allocatable > 0 && order.pendingCount > 1 ? (
          <ActionForm action={allocateOrderAction} className="mt-1.5">
            <input type="hidden" name="orderId" value={order.id} />
            <AllButton label={order.allocatable === order.pendingCount ? `Allocate all ${order.pendingCount}` : `Allocate ${order.allocatable} in stock`} />
          </ActionForm>
        ) : null}
      </div>
    </>
  );
  return (
    <article className={`iq-order is-${order.group}`}>
      <ul className="iq-lines">
        {lines.map((item, i) => <QueueLineRow key={item.line.id} item={item} lead={i === 0 ? lead : null} />)}
      </ul>
    </article>
  );
}

const VERDICT: Record<QueueLine["suggestion"], string> = { reserve: "In stock", po: "PO on the way", procure: "Out of stock", sku: "No SKU" };

function stockText({ line, stock, pos, suggestion, aheadQty }: QueueLine): ReactNode {
  if (!line.sku) return "Pick the catalogue product to see stock.";
  const free = stock?.available ?? 0;
  const parts: ReactNode[] = [<span key="f"><b>{free}</b> free</span>];
  if (stock?.incoming) parts.push(<span key="i"><b>{stock.incoming}</b> incoming{stock.nextEta ? ` · ${shortDate(stock.nextEta)}` : ""}</span>);
  if (aheadQty > 0 && free > 0) parts.push(<span key="a" className="is-warn">{aheadQty} wanted by older orders</span>);
  if (suggestion === "po" && pos[0]) parts.push(<span key="p">{pos[0].poNumber}{pos.length > 1 ? ` +${pos.length - 1}` : ""}</span>);
  return parts;
}

function QueueLineRow({ item, lead }: { item: QueueLine; lead: ReactNode }) {
  const { line, stock, pos, suggestion } = item;
  const [panel, setPanel] = useState<Panel>(null);
  const toggle = (next: Panel) => setPanel((current) => (current === next ? null : next));
  const canAllocate = !!line.sku && (stock?.available ?? 0) >= line.qty;
  const rejected = line.status === "rejected";
  const tone = rejected ? "rejected" : suggestion;

  return (
    <li className={`iq-line is-${tone} ${lead ? "is-first" : ""}`}>
      {lead ?? <><div className="iq-src" /><div className="iq-who" /></>}
      <div className="iq-prod">
        <p className="iq-name" title={line.productName}>
          {line.qty > 1 ? <span className="iq-qty">{line.qty}×</span> : null}
          {line.productName}
        </p>
        <p className="iq-sku">{line.sku ?? "No SKU yet"}</p>
      </div>
      <div className="iq-stock">
        <span className="iq-verdict">{rejected ? "Rejected" : VERDICT[suggestion]}</span>
        <span className="iq-numbers">{rejected ? line.rejectReason ?? "No reason given" : stockText(item)}</span>
      </div>
      <div className="iq-acts" role="group" aria-label={`Choices for ${line.productName}`}>
        {!line.sku ? (
          <Choice icon={<PackageSearch size={14} />} label="Map SKU" main active={panel === "sku"} onClick={() => toggle("sku")} />
        ) : null}
        {canAllocate ? (
          <ActionForm action={decideLineAction} className="contents">
            <input type="hidden" name="lineId" value={line.id} />
            <input type="hidden" name="decision" value="reserve" />
            <Choice icon={<CheckCircle2 size={14} />} label="Allocate" main={suggestion === "reserve"} submit />
          </ActionForm>
        ) : null}
        {line.sku && pos.length ? <Choice icon={<Clock3 size={14} />} label="Backorder" main={suggestion === "po"} active={panel === "po"} onClick={() => toggle("po")} /> : null}
        <Choice icon={<ShoppingCart size={14} />} label="Procure" main={suggestion === "procure" && !rejected} active={panel === "procure"} onClick={() => toggle("procure")} />
        <ActionForm action={decideLineAction} className="contents" confirm={`Drop-ship: the brand delivers ${line.productName} straight to the customer?`}>
          <input type="hidden" name="lineId" value={line.id} />
          <input type="hidden" name="decision" value="brand_direct" />
          <Choice icon={<Truck size={14} />} label="Drop-ship" submit />
        </ActionForm>
        {line.sku && !rejected ? <Choice icon={<PackageSearch size={14} />} label="SKU" title="Change SKU" active={panel === "sku"} onClick={() => toggle("sku")} /> : null}
        {!rejected ? <Choice icon={<Ban size={14} />} label="Reject" tone="bad" active={panel === "reject"} onClick={() => toggle("reject")} /> : null}
      </div>

      {panel ? (
        <div className="iq-panel">
          <button type="button" className="dcard-close" aria-label="Close" onClick={() => setPanel(null)}><X size={14} /></button>
          {panel === "sku" ? (
            <ActionForm action={mapSkuAction} className="grid max-w-[520px] gap-2">
              <input type="hidden" name="lineId" value={line.id} />
              <ProductPicker skuField="sku" label={line.sku ? "Change to" : "Which catalogue product is it?"} requireSku />
              <div><SubmitButton tone="quiet" small>Save SKU</SubmitButton></div>
            </ActionForm>
          ) : null}
          {panel === "po" ? (
            <ActionForm action={decideLineAction} className="grid max-w-[520px] gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <input type="hidden" name="lineId" value={line.id} />
              <input type="hidden" name="decision" value="hold_po" />
              <Field label="Backorder on purchase order">
                <select name="poId" required className={inputClass} defaultValue={pos.length === 1 ? pos[0].id : ""}>
                  <option value="" disabled>Choose</option>
                  {pos.map((po) => (
                    <option key={po.id} value={po.id}>
                      {po.poNumber} · {po.qtyOrdered - po.qtyReceived} pending{po.eta ? ` · ${shortDate(po.eta)}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <SubmitButton tone="quiet" small className="h-11">Backorder</SubmitButton>
            </ActionForm>
          ) : null}
          {panel === "procure" ? (
            <ActionForm action={decideLineAction} className="grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_auto] sm:items-end">
              <input type="hidden" name="lineId" value={line.id} />
              <input type="hidden" name="decision" value="procure" />
              <Field label="Vendor">
                <input name="vendor" required maxLength={80} placeholder="Devi International, Croma…" className={inputClass} />
              </Field>
              <Field label="Cost / unit (₹)">
                <input name="cost" inputMode="decimal" placeholder="Optional" className={inputClass} />
              </Field>
              <Field label="Expected">
                <input name="eta" type="date" className={inputClass} />
              </Field>
              <SubmitButton tone="quiet" small className="h-11">Request</SubmitButton>
            </ActionForm>
          ) : null}
          {panel === "reject" ? (
            <ActionForm action={decideLineAction} className="grid max-w-[620px] gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <input type="hidden" name="lineId" value={line.id} />
              <input type="hidden" name="decision" value="reject" />
              <Field label="Reason" hint="Sales sees this and tells the customer.">
                <input name="reason" required maxLength={300} placeholder="Discontinued, no stock anywhere…" className={inputClass} />
              </Field>
              <SubmitButton tone="danger" small className="h-11">Reject</SubmitButton>
            </ActionForm>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function Choice({ icon, label, title, main, submit, active, tone, onClick }: { icon: ReactNode; label: string; title?: string; main?: boolean; submit?: boolean; active?: boolean; tone?: "bad"; onClick?: () => void }) {
  const pending = useFormPending();
  return (
    <button
      type={submit ? "submit" : "button"}
      title={title}
      className={`iq-choice ${main ? "is-main" : ""} ${tone === "bad" ? "is-bad" : ""}`}
      aria-expanded={submit ? undefined : active}
      onClick={onClick}
    >
      {submit && pending ? <Loader2 size={14} className="animate-spin" /> : icon}
      {label}
    </button>
  );
}

function AllButton({ label }: { label: string }) {
  const pending = useFormPending();
  return (
    <button type="submit" className="iq-all">
      {pending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
      {label}
    </button>
  );
}

/** Page button: allocate every order whose products are all in free stock. */
export function AllocateReadyButton({ count }: { count: number }) {
  if (!count) return null;
  return (
    <ActionForm action={allocateReadyAction} confirm={`Allocate stock to ${count} order${count === 1 ? "" : "s"} that ${count === 1 ? "has" : "have"} everything in stock? Oldest first.`}>
      <SubmitButton tone="good">
        <CheckCircle2 size={16} /> Allocate all ready ({count})
      </SubmitButton>
    </ActionForm>
  );
}

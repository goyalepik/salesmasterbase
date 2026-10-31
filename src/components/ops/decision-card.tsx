"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Ban, CheckCircle2, Clock3, Loader2, PackageSearch, ShoppingCart, Truck, X } from "lucide-react";
import { decideLineAction, mapSkuAction } from "@/app/actions/ops";
import { ActionForm, SubmitButton, useFormPending } from "@/components/ops/action-form";
import { Field, inputClass } from "@/components/ops/bits";
import { ProductPicker } from "@/components/ops/product-picker";
import type { OrderLine, PurchaseOrder, StockLevel } from "@/lib/ops/types";
import { shortDate } from "@/lib/ops-ui/format";
import { suggestFor, type Suggestion } from "@/lib/ops-ui/suggest";

type Panel = "sku" | "po" | "procure" | "reject" | null;

const HINTS: Record<Suggestion, string> = {
  reserve: "Enough free stock. Reserve it.",
  po: "No free stock, but a PO is on the way.",
  procure: "No free stock and nothing on order.",
  sku: "Typed by sales. Pick the catalogue product first.",
};

/** One product on a paid order, with every stock decision one tap away. */
export function DecisionCard({
  line,
  stock,
  pos,
  order,
}: {
  line: OrderLine;
  stock: StockLevel | null;
  pos: PurchaseOrder[];
  order: { id: string; customer: string; hub: string | null; age: string; days: number };
}) {
  const suggestion = suggestFor(line, stock, pos);
  const [panel, setPanel] = useState<Panel>(suggestion === "sku" ? "sku" : null);
  const toggle = (next: Panel) => setPanel((current) => (current === next ? null : next));
  const free = stock?.available ?? 0;
  const canReserve = !!line.sku && free >= line.qty;

  return (
    <article className={`dcard is-${suggestion}`}>
      <header className="dcard-top">
        <Link href={`/orders/${encodeURIComponent(order.id)}`} className="dcard-order">{order.id}</Link>
        <span className="min-w-0 truncate">{order.customer}{order.hub ? ` · ${order.hub}` : ""}</span>
        <span className={`dcard-age ${order.days > 7 ? "is-old" : order.days > 2 ? "is-late" : ""}`} title="Since the sale">{order.age}</span>
      </header>

      <h3 className="dcard-name" title={line.productName}>
        {line.qty > 1 ? <span className="dcard-qty">{line.qty}×</span> : null}
        {line.productName}
      </h3>
      <p className="dcard-sku">{line.sku ?? "No SKU yet"}</p>

      {line.sku ? (
        <dl className="dcard-stock">
          <div className={free >= line.qty ? "is-good" : "is-bad"}><dt>Free</dt><dd>{free}</dd></div>
          <div><dt>Reserved</dt><dd>{stock?.reserved ?? 0}</dd></div>
          <div className={stock?.incoming ? "is-info" : undefined}>
            <dt>Incoming</dt>
            <dd>{stock?.incoming ?? 0}{stock?.nextEta ? <small>{shortDate(stock.nextEta)}</small> : null}</dd>
          </div>
        </dl>
      ) : null}

      {line.status === "rejected" ? (
        <p className="dcard-note is-bad">Rejected: {line.rejectReason ?? "no reason given"}</p>
      ) : (
        <p className="dcard-note">{HINTS[suggestion]}</p>
      )}

      <div className="dcard-actions" role="group" aria-label="Decide this product">
        <ActionForm action={decideLineAction} className="contents">
          <input type="hidden" name="lineId" value={line.id} />
          <input type="hidden" name="decision" value="reserve" />
          <SegButton icon={<CheckCircle2 size={16} />} label="Reserve" lit={suggestion === "reserve"} disabled={!canReserve} title={canReserve ? "Book a unit for this customer" : line.sku ? `Only ${free} free` : "Map a SKU first"} />
        </ActionForm>
        <SegToggle icon={<Clock3 size={16} />} label="On PO" lit={suggestion === "po"} active={panel === "po"} disabled={!pos.length} title={pos.length ? "Wait for an incoming PO" : "No open PO for this SKU"} onClick={() => toggle("po")} />
        <SegToggle icon={<ShoppingCart size={16} />} label="Procure" lit={suggestion === "procure"} active={panel === "procure"} title="Buy it for this customer" onClick={() => toggle("procure")} />
        <ActionForm action={decideLineAction} className="contents" confirm={`The brand will deliver ${line.productName} straight to the customer?`}>
          <input type="hidden" name="lineId" value={line.id} />
          <input type="hidden" name="decision" value="brand_direct" />
          <SegButton icon={<Truck size={16} />} label="Brand" title="Brand ships direct to the customer" />
        </ActionForm>
        <SegToggle icon={<Ban size={16} />} label="Reject" tone="bad" active={panel === "reject"} title="Send back to sales" onClick={() => toggle("reject")} />
      </div>

      {line.sku && line.status === "pending" && panel !== "sku" ? (
        <button type="button" className="dcard-link" onClick={() => toggle("sku")}><PackageSearch size={13} /> Change SKU</button>
      ) : null}

      {panel ? (
        <div className="dcard-panel">
          <button type="button" className="dcard-close" aria-label="Close" onClick={() => setPanel(null)}><X size={14} /></button>
          {panel === "sku" ? (
            <ActionForm action={mapSkuAction} className="grid gap-2">
              <input type="hidden" name="lineId" value={line.id} />
              <ProductPicker skuField="sku" label={line.sku ? "Change to" : "Which catalogue product is it?"} requireSku />
              <SubmitButton tone="quiet" small>Save SKU</SubmitButton>
            </ActionForm>
          ) : null}
          {panel === "po" ? (
            <ActionForm action={decideLineAction} className="grid gap-2">
              <input type="hidden" name="lineId" value={line.id} />
              <input type="hidden" name="decision" value="hold_po" />
              <Field label="Hold on purchase order">
                <select name="poId" required className={inputClass} defaultValue={pos.length === 1 ? pos[0].id : ""}>
                  <option value="" disabled>Choose</option>
                  {pos.map((po) => (
                    <option key={po.id} value={po.id}>
                      {po.poNumber} · {po.qtyOrdered - po.qtyReceived} pending{po.eta ? ` · ${shortDate(po.eta)}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <SubmitButton tone="quiet" small>Hold on this PO</SubmitButton>
            </ActionForm>
          ) : null}
          {panel === "procure" ? (
            <ActionForm action={decideLineAction} className="grid gap-2">
              <input type="hidden" name="lineId" value={line.id} />
              <input type="hidden" name="decision" value="procure" />
              <Field label="Vendor">
                <input name="vendor" required maxLength={80} placeholder="Devi International, Croma…" className={inputClass} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Cost / unit (₹)">
                  <input name="cost" inputMode="decimal" placeholder="Optional" className={inputClass} />
                </Field>
                <Field label="Expected">
                  <input name="eta" type="date" className={inputClass} />
                </Field>
              </div>
              <SubmitButton tone="quiet" small>Request procurement</SubmitButton>
            </ActionForm>
          ) : null}
          {panel === "reject" ? (
            <ActionForm action={decideLineAction} className="grid gap-2">
              <input type="hidden" name="lineId" value={line.id} />
              <input type="hidden" name="decision" value="reject" />
              <Field label="Reason" hint="Sales sees this and tells the customer.">
                <input name="reason" required maxLength={300} placeholder="Discontinued, no stock anywhere…" className={inputClass} />
              </Field>
              <SubmitButton tone="danger" small>Reject this product</SubmitButton>
            </ActionForm>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function SegButton({ icon, label, title, lit, disabled }: { icon: ReactNode; label: string; title: string; lit?: boolean; disabled?: boolean }) {
  const pending = useFormPending();
  return (
    <button type="submit" className={`seg ${lit ? "is-lit" : ""}`} title={title} disabled={disabled}>
      {pending ? <Loader2 size={16} className="animate-spin" /> : icon}
      <span>{label}</span>
    </button>
  );
}

function SegToggle({ icon, label, title, lit, active, disabled, tone, onClick }: { icon: ReactNode; label: string; title: string; lit?: boolean; active?: boolean; disabled?: boolean; tone?: "bad"; onClick: () => void }) {
  return (
    <button type="button" className={`seg ${lit ? "is-lit" : ""} ${tone === "bad" ? "is-bad" : ""}`} aria-expanded={active} title={title} disabled={disabled} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

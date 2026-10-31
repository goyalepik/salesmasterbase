"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Ban, CheckCircle2, ChevronDown, Clock3, Loader2, PackageSearch, ShoppingCart, Truck, X } from "lucide-react";
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

/** One product on a paid order: the suggested move as one big button, every other choice under More. */
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
  const [panel, setPanel] = useState<Panel>(null);
  const [more, setMore] = useState(false);
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

      <p className="dcard-stock-line">
        {line.sku ? (
          <>
            <span className={free >= line.qty ? "is-good" : "is-bad"}><b>{free}</b> free</span>
            <span><b>{stock?.reserved ?? 0}</b> reserved</span>
            <span className={stock?.incoming ? "is-info" : undefined}><b>{stock?.incoming ?? 0}</b> incoming{stock?.nextEta ? ` · ${shortDate(stock.nextEta)}` : ""}</span>
          </>
        ) : (
          <span className="is-warn">No SKU yet</span>
        )}
      </p>

      {line.status === "rejected" ? <p className="dcard-note is-bad">Rejected: {line.rejectReason ?? "no reason given"}</p> : <p className="dcard-note">{HINTS[suggestion]}</p>}

      <div className="dcard-foot">
        {suggestion === "reserve" ? (
          <ActionForm action={decideLineAction} className="min-w-0 flex-1">
            <input type="hidden" name="lineId" value={line.id} />
            <input type="hidden" name="decision" value="reserve" />
            <MainButton icon={<CheckCircle2 size={16} />} label="Reserve from stock" />
          </ActionForm>
        ) : (
          <button type="button" className="dcard-main" aria-expanded={panel === MAIN_PANEL[suggestion]} onClick={() => toggle(MAIN_PANEL[suggestion])}>
            {MAIN_ICON[suggestion]}
            {MAIN_LABEL[suggestion]}
          </button>
        )}
        <button type="button" className="dcard-more" aria-expanded={more} onClick={() => setMore((value) => !value)}>
          More <ChevronDown size={14} className={more ? "rotate-180" : ""} />
        </button>
      </div>

      {more ? (
        <div className="dcard-options" role="group" aria-label="Other choices">
          {suggestion !== "reserve" && canReserve ? (
            <ActionForm action={decideLineAction} className="contents">
              <input type="hidden" name="lineId" value={line.id} />
              <input type="hidden" name="decision" value="reserve" />
              <OptionButton icon={<CheckCircle2 size={14} />} label="Reserve" submit />
            </ActionForm>
          ) : null}
          {suggestion !== "po" && pos.length ? <OptionButton icon={<Clock3 size={14} />} label="Hold on PO" active={panel === "po"} onClick={() => toggle("po")} /> : null}
          {suggestion !== "procure" ? <OptionButton icon={<ShoppingCart size={14} />} label="Procure" active={panel === "procure"} onClick={() => toggle("procure")} /> : null}
          <ActionForm action={decideLineAction} className="contents" confirm={`The brand will deliver ${line.productName} straight to the customer?`}>
            <input type="hidden" name="lineId" value={line.id} />
            <input type="hidden" name="decision" value="brand_direct" />
            <OptionButton icon={<Truck size={14} />} label="Brand ships direct" submit />
          </ActionForm>
          {line.sku && line.status === "pending" && suggestion !== "sku" ? <OptionButton icon={<PackageSearch size={14} />} label="Change SKU" active={panel === "sku"} onClick={() => toggle("sku")} /> : null}
          {line.status !== "rejected" ? <OptionButton icon={<Ban size={14} />} label="Reject" tone="bad" active={panel === "reject"} onClick={() => toggle("reject")} /> : null}
        </div>
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

const MAIN_PANEL: Record<Exclude<Suggestion, "reserve">, Panel> = { po: "po", procure: "procure", sku: "sku" };
const MAIN_LABEL: Record<Exclude<Suggestion, "reserve">, string> = { po: "Hold on incoming PO", procure: "Procure for this customer", sku: "Map to a SKU" };
const MAIN_ICON: Record<Exclude<Suggestion, "reserve">, ReactNode> = { po: <Clock3 size={16} />, procure: <ShoppingCart size={16} />, sku: <PackageSearch size={16} /> };

function MainButton({ icon, label }: { icon: ReactNode; label: string }) {
  const pending = useFormPending();
  return (
    <button type="submit" className="dcard-main is-go">
      {pending ? <Loader2 size={16} className="animate-spin" /> : icon}
      {label}
    </button>
  );
}

function OptionButton({ icon, label, submit, active, tone, onClick }: { icon: ReactNode; label: string; submit?: boolean; active?: boolean; tone?: "bad"; onClick?: () => void }) {
  const pending = useFormPending();
  return (
    <button type={submit ? "submit" : "button"} className={`dcard-option ${tone === "bad" ? "is-bad" : ""}`} aria-expanded={submit ? undefined : active} onClick={onClick}>
      {submit && pending ? <Loader2 size={14} className="animate-spin" /> : icon}
      {label}
    </button>
  );
}

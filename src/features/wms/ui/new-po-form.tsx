"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { createPoAction } from "@/app/actions/wms";
import { ActionForm, SubmitButton } from "@/components/ops/action-form";
import { Field, inputClass } from "@/components/ops/bits";
import { ProductPicker } from "@/components/ops/product-picker";
import type { ActionResult } from "@/lib/ops-ui/action-result";

export type PoFormLists = { vendors: string[]; hubs: string[]; billing: string[]; terms: string[] };

/** Raise a PO: vendor, hub, who it's billed to, terms, then up to 20 products with units and price (incl. GST). */
export function NewWmsPoForm({ lists }: { lists: PoFormLists }) {
  const router = useRouter();
  const vendorList = useId();
  const [rows, setRows] = useState([0]);

  async function action(form: FormData): Promise<ActionResult> {
    const result = await createPoAction(form);
    if (result.ok && "poNumber" in result && result.poNumber) router.push(`/wms/po/${encodeURIComponent(result.poNumber)}`);
    return result;
  }

  return (
    <ActionForm action={action} resetOnSuccess={false} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Vendor">
          <input name="vendor" required minLength={2} maxLength={80} list={vendorList} className={inputClass} placeholder="Pick or type" />
          <datalist id={vendorList}>{lists.vendors.map((v) => <option key={v} value={v} />)}</datalist>
        </Field>
        <Field label="Goods come to">
          <select name="hub" required defaultValue={lists.hubs[0]} className={inputClass}>
            {lists.hubs.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        </Field>
        <Field label="Bill in the name of">
          <select name="billedTo" defaultValue="" className={inputClass}>
            <option value="">Not decided</option>
            {lists.billing.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </Field>
        <Field label="Payment terms">
          <select name="paymentTerms" defaultValue="" className={inputClass}>
            <option value="">Not decided</option>
            {lists.terms.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Expected on (ETA)">
          <input name="eta" type="date" className={inputClass} />
        </Field>
        <Field label="Priority">
          <select name="priority" defaultValue="normal" className={inputClass}>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </Field>
      </div>

      <div className="grid gap-2">
        {rows.map((row, index) => (
          <div key={row} className="wms-po-row">
            <ProductPicker skuField={`sku_${index}`} label={`Product ${index + 1}`} requireSku required={index === 0} />
            <Field label="Units">
              <input name={`qty_${index}`} type="number" inputMode="numeric" min={1} max={10000} step={1} required={index === 0} defaultValue={index === 0 ? 1 : undefined} className={inputClass} />
            </Field>
            <Field label="Price per unit, incl. GST (₹)">
              <input name={`cost_${index}`} inputMode="decimal" maxLength={12} placeholder="45000" className={inputClass} />
            </Field>
            <Field label="Stock type">
              <select name={`own_${index}`} defaultValue="" className={inputClass}>
                <option value="">As product</option>
                <option value="CnC">CnC (bought)</option>
                <option value="SOR">SOR (sale or return)</option>
              </select>
            </Field>
            {index > 0 ? (
              <button type="button" className="topbar-icon self-end" aria-label={`Remove product ${index + 1}`} onClick={() => setRows((list) => list.filter((r) => r !== row))}>
                <Trash2 size={16} />
              </button>
            ) : <span />}
          </div>
        ))}
      </div>

      <Field label="Notes (optional)">
        <input name="notes" maxLength={300} className={inputClass} placeholder="Mail subject, scheme, anything the warehouse should know" />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {rows.length < 20 ? (
          <button type="button" className="btn-quiet inline-flex h-9 items-center gap-1.5 rounded-[12px] px-3 text-[13px]" onClick={() => setRows((list) => [...list, Math.max(...list) + 1])}>
            <Plus size={14} /> Add another product
          </button>
        ) : <span />}
        <div className="flex items-center gap-2">
          <input name="poNumber" maxLength={40} className={`${inputClass} w-56`} placeholder="PO number (empty = next)" aria-label="PO number, leave empty for the next number" />
          <SubmitButton>Raise PO</SubmitButton>
        </div>
      </div>
    </ActionForm>
  );
}

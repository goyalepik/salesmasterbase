"use client";

import { useState } from "react";
import { PackagePlus, Plus, Scale, Tag, Trash2 } from "lucide-react";
import { correctStockAction, createPoAction, receiveStockAction, saveProductAction } from "@/app/actions/ops";
import { ActionForm, SubmitButton } from "@/components/ops/action-form";
import { Field, inputClass } from "@/components/ops/bits";
import { ProductPicker } from "@/components/ops/product-picker";

type Tool = "receive" | "correct" | "product";

const TOOLS: Array<{ id: Tool; label: string; note: string; icon: typeof PackagePlus }> = [
  { id: "receive", label: "Add stock", note: "Units that came in without a PO: a return, a found unit, a transfer.", icon: PackagePlus },
  { id: "correct", label: "Correct a count", note: "After a physical count. Reserved units can never be removed.", icon: Scale },
  { id: "product", label: "New product", note: "Add a SKU to the catalogue before buying or selling it.", icon: Tag },
];

/** Every way stock enters the app outside the order flow. Goods on a PO are received on Procurement. */
export function StockTools() {
  const [tool, setTool] = useState<Tool>("receive");
  // A new key clears the product search after a save.
  const [round, setRound] = useState(0);
  const next = () => setRound((value) => value + 1);
  const current = TOOLS.find((t) => t.id === tool)!;

  return (
    <div className="grid gap-3">
      <div className="tool-tabs" role="tablist" aria-label="Stock tools">
        {TOOLS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} type="button" role="tab" aria-selected={tool === t.id} className="tool-tab" onClick={() => setTool(t.id)}>
              <Icon size={16} />
              {t.label}
            </button>
          );
        })}
      </div>
      <p className="text-[12.5px] text-muted">{current.note}</p>

      {tool === "receive" ? (
        <ActionForm key={`r${round}`} action={receiveStockAction} onSuccess={next} className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><ProductPicker skuField="sku" label="Product" requireSku required /></div>
          <Field label="How many">
            <input name="qty" type="number" min={1} max={1000} step={1} required defaultValue={1} className={inputClass} />
          </Field>
          <Field label="Why it came in">
            <select name="reason" required defaultValue="" className={inputClass}>
              <option value="" disabled>Choose</option>
              <option value="return">Customer return</option>
              <option value="found">Found in a count</option>
              <option value="transfer">Moved in from a hub</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Note" hint="Order number for a return, or where it came from.">
            <input name="note" maxLength={200} className={inputClass} placeholder="EPK-000123" />
          </Field>
          <Field label="Cost per unit (₹)" hint="Leave blank if not known.">
            <input name="cost" inputMode="decimal" className={inputClass} placeholder="45000" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Serial numbers" hint="One per unit, separated by spaces or commas. Optional.">
              <input name="serials" className={inputClass} placeholder="SN123 SN124" />
            </Field>
          </div>
          <div className="sm:col-span-2 flex justify-end"><SubmitButton tone="good">Add to stock</SubmitButton></div>
        </ActionForm>
      ) : null}

      {tool === "correct" ? (
        <ActionForm key={`c${round}`} action={correctStockAction} onSuccess={next} className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><ProductPicker skuField="sku" label="Product" requireSku required /></div>
          <Field label="Change">
            <select name="direction" defaultValue="add" className={inputClass}>
              <option value="add">Add units</option>
              <option value="remove">Remove units</option>
            </select>
          </Field>
          <Field label="How many">
            <input name="qty" type="number" min={1} max={1000} step={1} required defaultValue={1} className={inputClass} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Reason" hint="Saved with your name. For example: Physical count on 30 Oct, 2 short.">
              <input name="reason" required minLength={5} maxLength={200} className={inputClass} />
            </Field>
          </div>
          <div className="sm:col-span-2 flex justify-end"><SubmitButton tone="quiet">Save correction</SubmitButton></div>
        </ActionForm>
      ) : null}

      {tool === "product" ? (
        <ActionForm key={`p${round}`} action={saveProductAction} onSuccess={next} className="grid gap-3 sm:grid-cols-2">
          <Field label="SKU" hint="Small letters, numbers and dashes. Same SKU again updates it.">
            <input name="sku" required pattern="[a-zA-Z0-9][a-zA-Z0-9\-]{1,59}" maxLength={60} className={inputClass} placeholder="ep-nw-freo-x1" />
          </Field>
          <Field label="Product name">
            <input name="name" required minLength={3} maxLength={160} className={inputClass} placeholder="NARWAL Freo X1 Robot Vacuum" />
          </Field>
          <Field label="Brand">
            <input name="brand" maxLength={60} className={inputClass} placeholder="Narwal" />
          </Field>
          <Field label="Category">
            <input name="category" maxLength={60} className={inputClass} placeholder="Robot Vacuum" />
          </Field>
          <Field label="List price (₹)">
            <input name="listPrice" inputMode="decimal" className={inputClass} placeholder="59999" />
          </Field>
          <label className="flex items-center gap-2.5 self-end pb-3 text-[13px] text-ink">
            <input type="checkbox" name="needsInstallation" className="size-4 accent-[var(--space)]" />
            Needs installation after delivery
          </label>
          <div className="sm:col-span-2 flex justify-end"><SubmitButton tone="quiet">Save product</SubmitButton></div>
        </ActionForm>
      ) : null}
    </div>
  );
}

/** A brand purchase order with one or more products. */
export function NewPoForm() {
  const [rows, setRows] = useState([0]);
  const [round, setRound] = useState(0);

  return (
    <ActionForm
      key={round}
      action={createPoAction}
      onSuccess={() => {
        setRows([0]);
        setRound((value) => value + 1);
      }}
      className="grid gap-3"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="PO number">
          <input name="poNumber" required maxLength={40} className={inputClass} placeholder="PO-EPIK-26-27-0041" />
        </Field>
        <Field label="Vendor">
          <input name="vendor" required minLength={2} maxLength={80} className={inputClass} placeholder="Value-One Retail" />
        </Field>
        <Field label="Expected on">
          <input name="eta" type="date" className={inputClass} />
        </Field>
      </div>
      <div className="grid gap-2">
        {rows.map((row, index) => (
          <div key={row} className="po-row">
            <ProductPicker skuField={`sku_${index}`} label={`Product ${index + 1}`} requireSku required={index === 0} />
            <Field label="Units">
              <input name={`qty_${index}`} type="number" min={1} max={10000} step={1} required={index === 0} defaultValue={index === 0 ? 1 : undefined} className={inputClass} />
            </Field>
            {index > 0 ? (
              <button type="button" className="topbar-icon self-end" aria-label={`Remove product ${index + 1}`} onClick={() => setRows((list) => list.filter((r) => r !== row))}>
                <Trash2 size={16} />
              </button>
            ) : <span />}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {rows.length < 10 ? (
          <button type="button" className="btn-quiet inline-flex h-9 items-center gap-1.5 rounded-[12px] px-3 text-[13px]" onClick={() => setRows((list) => [...list, Math.max(...list) + 1])}>
            <Plus size={14} /> Add another product
          </button>
        ) : <span />}
        <SubmitButton>Save purchase order</SubmitButton>
      </div>
    </ActionForm>
  );
}

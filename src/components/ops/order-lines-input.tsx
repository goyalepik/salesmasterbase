"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ProductPicker, type PickedProduct } from "@/components/ops/product-picker";

const MAX_LINES = 3;

function suffix(index: number): string {
  return index === 0 ? "" : `_${index + 1}`;
}

/** Up to three products, each picked from the catalogue (or typed), with list and offered price. */
export function OrderLinesInput() {
  const [lines, setLines] = useState<Array<{ key: number; list: string }>>([{ key: 1, list: "" }]);
  const [next, setNext] = useState(2);

  function setList(key: number, list: string) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, list } : line)));
  }

  function picked(key: number, product: PickedProduct | null) {
    if (product?.listPriceMinor) setList(key, String(Math.round(product.listPriceMinor / 100)));
  }

  return (
    <div className="grid gap-3">
      {lines.map((line, index) => {
        const s = suffix(index);
        return (
          <fieldset key={line.key} className="grid gap-3 rounded-[16px] border border-line p-3">
            <legend className="px-1 text-[12px] text-muted">Product {index + 1}</legend>
            <ProductPicker nameField={`product${s}`} skuField={`sku${s}`} label="Product" required onPick={(p) => picked(line.key, p)} />
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-[12px] text-muted">
                List price (₹)
                <input
                  className="field mt-1 h-11 w-full px-3 text-[14px] outline-none"
                  name={`list_price${s}`}
                  required={index === 0}
                  inputMode="decimal"
                  placeholder="75000"
                  value={line.list}
                  onChange={(event) => setList(line.key, event.target.value)}
                />
              </label>
              <label className="block text-[12px] text-muted">
                Offered price (₹)
                <input className="field mt-1 h-11 w-full px-3 text-[14px] outline-none" name={`offered_price${s}`} required inputMode="decimal" placeholder="69900" />
              </label>
            </div>
            {index > 0 ? (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 justify-self-start text-[13px] text-muted hover:text-bad"
                onClick={() => setLines((current) => current.filter((l) => l.key !== line.key))}
              >
                <Trash2 size={14} /> Remove product {index + 1}
              </button>
            ) : null}
          </fieldset>
        );
      })}
      {lines.length < MAX_LINES ? (
        <button
          type="button"
          className="btn-quiet inline-flex h-11 items-center justify-center gap-1.5 rounded-[14px] px-4 text-[14px]"
          onClick={() => {
            setLines((current) => [...current, { key: next, list: "" }]);
            setNext((n) => n + 1);
          }}
        >
          <Plus size={15} /> Add another product
        </button>
      ) : (
        <p className="text-[12px] text-faint">Three products at most. Post a second order for more.</p>
      )}
    </div>
  );
}

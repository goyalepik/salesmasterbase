"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { Search } from "lucide-react";
import { inr } from "@/lib/ops-ui/format";

export type PickedProduct = { sku: string; name: string; brand: string | null; listPriceMinor: number | null };

/**
 * Type a few letters, pick from the catalogue. Typing something that is not in the list is allowed:
 * the hidden SKU stays empty and inventory maps it later.
 */
export function ProductPicker({
  nameField,
  skuField,
  label = "Product",
  placeholder = "Type brand, model or SKU",
  required = false,
  requireSku = false,
  onPick,
}: {
  nameField?: string;
  skuField: string;
  label?: string;
  placeholder?: string;
  required?: boolean;
  requireSku?: boolean;
  onPick?: (product: PickedProduct | null) => void;
}) {
  const listId = useId();
  const [text, setText] = useState("");
  const [sku, setSku] = useState("");
  const [items, setItems] = useState<PickedProduct[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const timer = useRef<number | null>(null);
  const controller = useRef<AbortController | null>(null);

  function search(q: string) {
    if (timer.current) window.clearTimeout(timer.current);
    controller.current?.abort();
    if (q.trim().length < 2) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = window.setTimeout(async () => {
      const abort = new AbortController();
      controller.current = abort;
      try {
        const response = await fetch(`/api/products?q=${encodeURIComponent(q.trim())}`, { signal: abort.signal });
        const body = (await response.json()) as { items?: PickedProduct[] };
        setItems(body.items ?? []);
        setActive(-1);
      } catch {
        // Aborted or offline: keep the old list.
      } finally {
        if (controller.current === abort) setLoading(false);
      }
    }, 180);
  }

  function choose(product: PickedProduct) {
    setText(product.name);
    setSku(product.sku);
    setOpen(false);
    onPick?.(product);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open || !items.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(items.length - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === "Enter" && active >= 0) {
      event.preventDefault();
      choose(items[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <label className="block text-[12px] text-muted">
        {label}
        <span className="relative mt-1 block">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
          <input
            className="field h-11 w-full pr-3 pl-8 text-[14px] outline-none"
            name={nameField}
            value={text}
            required={required}
            maxLength={120}
            autoComplete="off"
            placeholder={placeholder}
            role="combobox"
            aria-expanded={open && items.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            onChange={(event) => {
              setText(event.target.value);
              if (sku) {
                setSku("");
                onPick?.(null);
              }
              setOpen(true);
              search(event.target.value);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 150)}
            onKeyDown={onKeyDown}
          />
        </span>
      </label>
      <input type="hidden" name={skuField} value={sku} />
      {open && text.trim().length >= 2 ? (
        <ul id={listId} role="listbox" className="product-menu">
          {loading && !items.length ? <li className="px-3 py-2 text-[12px] text-faint">Searching…</li> : null}
          {!loading && !items.length ? (
            <li className="px-3 py-2 text-[12px] text-muted">{requireSku ? "Nothing found. Try fewer words." : "Not in the catalogue. It will be saved as typed and inventory will map it."}</li>
          ) : null}
          {items.map((item, index) => (
            <li key={item.sku} role="option" aria-selected={index === active}>
              <button
                type="button"
                className={`flex w-full items-start justify-between gap-3 px-3 py-2 text-left ${index === active ? "bg-white/10" : "hover:bg-white/6"}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(item)}
              >
                <span className="min-w-0">
                  <span className="block text-[13px] text-ink">{item.name}</span>
                  <span className="block text-[11px] text-faint">{item.sku}{item.brand ? ` · ${item.brand}` : ""}</span>
                </span>
                <span className="shrink-0 text-[12px] tabular-nums text-muted">{inr(item.listPriceMinor)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-1 text-[11px] text-faint">
        {sku ? <>SKU <span className="text-good">{sku}</span></> : text.trim() ? (requireSku ? "Pick one from the list." : "Free text. No SKU yet.") : null}
      </p>
    </div>
  );
}

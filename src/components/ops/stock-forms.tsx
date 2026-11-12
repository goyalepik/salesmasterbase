"use client";

import { useRef, useState } from "react";
import { FileScan, Loader2, PackagePlus, Plus, Scale, Sparkles, Tag, Trash2, Upload, X } from "lucide-react";
import { correctStockAction, createPoAction, importBillAction, receiveStockAction, saveProductAction } from "@/app/actions/ops";
import { ActionForm, SubmitButton } from "@/components/ops/action-form";
import { Field, inputClass } from "@/components/ops/bits";
import { ProductPicker } from "@/components/ops/product-picker";

type Tool = "bill" | "receive" | "correct" | "product";

const TOOLS: Array<{ id: Tool; label: string; note: string; icon: typeof PackagePlus }> = [
  { id: "bill", label: "From a bill", note: "Upload a photo or PDF of the bill. The AI reads the products, you check them, then add.", icon: FileScan },
  { id: "receive", label: "Add stock", note: "Type it in: a bill without a PO, a return, a found unit, a transfer.", icon: PackagePlus },
  { id: "correct", label: "Correct a count", note: "After a physical count. Reserved units can never be removed.", icon: Scale },
  { id: "product", label: "New product", note: "Add a SKU to the catalogue before buying or selling it.", icon: Tag },
];

/** Every way stock enters the app outside the order flow. Goods on a PO are received on Procurement. */
export function StockTools({ onSaved, initial = "bill" }: { onSaved?: () => void; initial?: Tool }) {
  const [tool, setTool] = useState<Tool>(initial);
  // A new key clears the product search after a save.
  const [round, setRound] = useState(0);
  const next = () => {
    setRound((value) => value + 1);
    onSaved?.();
  };
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

      {tool === "bill" ? <BillImport key={`b${round}`} onSaved={next} /> : null}

      {tool === "receive" ? (
        <ActionForm key={`r${round}`} action={receiveStockAction} onSuccess={next} className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><ProductPicker skuField="sku" label="Product" requireSku required /></div>
          <Field label="How many">
            <input name="qty" type="number" min={1} max={1000} step={1} required defaultValue={1} className={inputClass} />
          </Field>
          <Field label="Why it came in">
            <select name="reason" required defaultValue="" className={inputClass}>
              <option value="" disabled>Choose</option>
              <option value="purchase">Bought on a bill (no PO)</option>
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

type BillLineResult = {
  description: string;
  qty: number;
  unitCostMinor: number | null;
  serials: string[];
  match: { sku: string; name: string } | null;
  pos: Array<{ id: string; poNumber: string; vendor: string | null; pending: number }>;
  checks: Array<{ tone: "good" | "warn" | "bad"; text: string }>;
};
type BillResult = { vendor: string | null; invoiceNo: string | null; invoiceDate: string | null; addedBefore: string | null; lines: BillLineResult[] };
type ReviewRow = { include: boolean; sku: string; qty: string; cost: string; serials: string; target: string; line: BillLineResult; matched: boolean };

function rupeeText(minor: number | null): string {
  if (minor == null) return "";
  return Number.isInteger(minor / 100) ? String(minor / 100) : (minor / 100).toFixed(2);
}

/** Upload a bill, let the AI read it, the app checks every line, the person confirms, then it all goes to stock. */
export function BillImport({ onSaved, big = false }: { onSaved: () => void; big?: boolean }) {
  const [phase, setPhase] = useState<"pick" | "reading" | "review">("pick");
  const [error, setError] = useState<string | null>(null);
  const [bill, setBill] = useState<BillResult | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [again, setAgain] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function read(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.size > 4 * 1024 * 1024) return setError("The file is over 4 MB. Take a smaller photo or compress the PDF.");
    setPhase("reading");
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/stock/bill", { method: "POST", body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not read the bill.");
      const result = data as BillResult;
      setBill(result);
      setRows(
        result.lines.map((line) => ({
          // A line that failed a check (same serial already in stock) starts unticked.
          include: !line.checks?.some((c) => c.tone === "bad"),
          sku: line.match?.sku ?? "",
          qty: String(line.qty),
          cost: rupeeText(line.unitCostMinor),
          serials: line.serials.join(" "),
          target: line.pos[0]?.id ?? "stock",
          line,
          matched: !!line.match,
        })),
      );
      setAgain(false);
      setPhase("review");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not read the bill.");
      setPhase("pick");
    }
  }

  const update = (index: number, patch: Partial<ReviewRow>) => setRows((list) => list.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const chosen = rows.filter((row) => row.include);
  const missing = chosen.filter((row) => !row.sku).length;
  const units = chosen.reduce((sum, row) => sum + (Number(row.qty) || 0), 0);
  const payload = JSON.stringify({
    vendor: bill?.vendor ?? null,
    invoiceNo: bill?.invoiceNo ?? null,
    lines: chosen.map((row) => ({
      sku: row.sku,
      qty: Number(row.qty),
      unitCostMinor: row.cost.trim() ? Math.round(Number(row.cost.replace(/[,₹\s]/g, "")) * 100) || null : null,
      serials: row.serials.split(/[,\s]+/).filter(Boolean),
      poId: row.target === "stock" ? null : row.target,
    })),
  });

  if (phase !== "review") {
    return (
      <div className="grid gap-3">
        <label
          className={`bill-drop ${phase === "reading" ? "is-busy" : ""} ${big ? "is-big" : ""}`}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (phase !== "reading") void read(event.dataTransfer.files?.[0]);
          }}
        >
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" disabled={phase === "reading"} onChange={(event) => read(event.target.files?.[0])} />
          {phase === "reading" ? (
            <>
              <Loader2 size={26} className="animate-spin text-[var(--space)]" />
              <span className="bill-drop-title">Reading the bill…</span>
              <span className="bill-drop-note">Reading products, quantities, prices and serial numbers, then checking each one. About 10 to 20 seconds.</span>
            </>
          ) : (
            <>
              <span className="bill-drop-icon"><Upload size={22} /></span>
              <span className="bill-drop-title">Upload the bill</span>
              <span className="bill-drop-note">Tap to choose, or drop the file here. Photo or PDF, up to 4 MB.</span>
            </>
          )}
        </label>
        {error ? <p className="text-[13px] text-bad">{error}</p> : null}
        <p className="flex items-start gap-2 text-[12px] text-muted"><Sparkles size={14} className="mt-0.5 shrink-0 text-[var(--space)]" />The AI reads the bill, the app checks it (same bill twice, serials already in stock, cost and PO), and nothing is saved until you press Add.</p>
      </div>
    );
  }

  return (
    <ActionForm action={importBillAction} onSuccess={onSaved} className="grid gap-3">
      <input type="hidden" name="payload" value={payload} />
      <div className="bill-head">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-ink">{bill?.vendor ?? "Unknown vendor"}</p>
          <p className="text-[12px] text-muted">{[bill?.invoiceNo ? `Bill ${bill.invoiceNo}` : null, bill?.invoiceDate, `${rows.length} ${rows.length === 1 ? "line" : "lines"} found`].filter(Boolean).join(" · ")}</p>
        </div>
        <button type="button" className="btn-quiet h-8 shrink-0 rounded-[10px] px-3 text-[12px]" onClick={() => { setPhase("pick"); setRows([]); setBill(null); }}>Read another</button>
      </div>
      {bill?.addedBefore ? (
        <label className="bill-dupe">
          <span><b>This bill was already added</b> on {new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(bill.addedBefore))}. Adding it again would count the stock twice.</span>
          <span className="inline-flex items-center gap-2 whitespace-nowrap"><input type="checkbox" checked={again} onChange={(event) => setAgain(event.target.checked)} className="size-4 accent-[var(--danger)]" /> Add it again anyway</span>
        </label>
      ) : null}
      <ul className="grid gap-2.5">
        {rows.map((row, index) => (
          <li key={index} className={`bill-line ${row.include ? "" : "is-off"}`}>
            <label className="bill-line-top">
              <input type="checkbox" checked={row.include} onChange={(event) => update(index, { include: event.target.checked })} className="size-4 accent-[var(--space)]" />
              <span className="min-w-0 flex-1 truncate text-[12px] text-muted" title={row.line.description}>On the bill: <span className="text-ink">{row.line.description}</span></span>
            </label>
            {row.line.checks?.length ? (
              <ul className="bill-checks">
                {row.line.checks.map((check) => <li key={check.text} className={`is-${check.tone}`}>{check.text}</li>)}
              </ul>
            ) : null}
            {row.include ? (
              <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_88px_110px]">
                <div className="min-w-0">
                  <ProductPicker
                    skuField={`bill_sku_${index}`}
                    label={row.matched ? "Matched product (change if wrong)" : "Pick the product"}
                    requireSku
                    initial={row.line.match}
                    onPick={(product) => update(index, { sku: product?.sku ?? "", target: product?.sku === row.line.match?.sku ? row.target : "stock" })}
                  />
                  {!row.sku ? <p className="mt-1 text-[11.5px] text-warn">No match found. Search and pick the product.</p> : null}
                </div>
                <Field label="Units">
                  <input type="number" min={1} max={1000} value={row.qty} onChange={(event) => update(index, { qty: event.target.value })} className={inputClass} />
                </Field>
                <Field label="Cost / unit (₹)">
                  <input inputMode="decimal" value={row.cost} onChange={(event) => update(index, { cost: event.target.value })} placeholder="Optional" className={inputClass} />
                </Field>
                <div className="min-w-0">
                  <Field label="Serial numbers" hint={row.serials ? undefined : "None found on the bill. Add them now or at dispatch."}>
                    <input value={row.serials} onChange={(event) => update(index, { serials: event.target.value })} placeholder="SN123 SN124" className={inputClass} />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="Add as">
                    <select value={row.target} onChange={(event) => update(index, { target: event.target.value })} className={inputClass}>
                      {row.sku === row.line.match?.sku
                        ? row.line.pos.map((po) => <option key={po.id} value={po.id}>{po.poNumber} · {po.pending} due</option>)
                        : null}
                      <option value="stock">New stock (no PO)</option>
                    </select>
                  </Field>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-muted">{missing ? <span className="text-warn">{missing} {missing === 1 ? "line needs" : "lines need"} a product picked.</span> : "Lines on an open PO are received on that PO, so waiting orders get their units."}</p>
        {missing || !chosen.length || (bill?.addedBefore && !again) ? (
          <button type="button" disabled className="btn-good inline-flex h-11 items-center rounded-[14px] px-4 text-[14px] font-medium opacity-50">Add {units} {units === 1 ? "unit" : "units"} to stock</button>
        ) : (
          <SubmitButton tone="good">Add {units} {units === 1 ? "unit" : "units"} to stock</SubmitButton>
        )}
      </div>
    </ActionForm>
  );
}

/** Incoming: the bill upload on the page itself. After a save it starts fresh for the next bill. */
export function IncomingUpload() {
  const [round, setRound] = useState(0);
  return <BillImport key={round} big onSaved={() => setRound((n) => n + 1)} />;
}

/** The stock tools in a pop-up, opened from a button in the page header. */
export function StockInDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" className="glow-button inline-flex h-10 shrink-0 items-center gap-2 rounded-[12px] px-3.5 text-[13px] font-medium text-white" onClick={() => dialog.current?.showModal()}>
        <PackagePlus size={15} /> Stock in
      </button>
      <dialog
        ref={dialog}
        className="sheet-dialog"
        aria-label="Stock in and corrections"
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current?.close();
        }}
      >
        <div className="sheet-body">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-ink">Stock in and corrections</h2>
              <p className="mt-0.5 text-[12.5px] text-muted">Goods on a purchase order are received on Procurement.</p>
            </div>
            <button type="button" className="topbar-icon" aria-label="Close" onClick={() => dialog.current?.close()}><X size={16} /></button>
          </div>
          <StockTools onSaved={() => dialog.current?.close()} />
        </div>
      </dialog>
    </>
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

"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Plus, Sparkles, Trash2, Upload } from "lucide-react";
import { readBillAction, saveReceiptAction, type ReceiptInput } from "@/app/actions/ims";

type Product = { sku: string; name: string };
type Line = { sku: string; name: string; description: string; qty: number; unitCost: number; serials: string; condition: "Good" | "Damaged" | "Open box"; options: Array<{ sku: string; name: string; score: number }> };
const empty = (): Line => ({ sku: "", name: "", description: "", qty: 1, unitCost: 0, serials: "", condition: "Good", options: [] });

/** Photos are shrunk on the phone before sending (Vercel takes up to 4.5 MB). */
async function shrink(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.size < 1_500_000) return file;
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 2200 / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.85));
}

export function BillForm({ products, vendors, ready }: { products: Product[]; vendors: string[]; ready: boolean }) {
  const [reading, startRead] = useTransition();
  const [saving, startSave] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; message: string } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [bill, setBill] = useState<{ path: string; name: string } | null>(null);
  const [head, setHead] = useState({ vendor: "", invoice: "", invoiceDate: "", po: "", billedTo: "Curioso", terms: "Cash and Carry" as "Cash and Carry" | "SOR", note: "" });
  const [lines, setLines] = useState<Line[]>([empty()]);
  const byName = new Map(products.map((p) => [`${p.name} · ${p.sku}`, p]));
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  function read(file: File) {
    setNote(null);
    startRead(async () => {
      const blob = await shrink(file);
      const form = new FormData();
      form.set("bill", new File([blob], file.name.replace(/\.(heic|png|webp)$/i, ".jpg"), { type: blob.type || file.type }));
      const res = await readBillAction(form);
      if (res.billPath) setBill({ path: res.billPath, name: res.billName ?? file.name });
      if (!res.ok) return setNote({ ok: false, message: res.message });
      setBill({ path: res.billPath, name: res.billName });
      setHead((h) => ({ ...h, vendor: res.draft.vendor || h.vendor, invoice: res.draft.invoice || h.invoice, invoiceDate: res.draft.invoiceDate ?? h.invoiceDate, po: res.draft.po ?? h.po, billedTo: /viva/i.test(res.draft.billedTo ?? "") ? "Vivavilla" : /navkar/i.test(res.draft.billedTo ?? "") ? "Navkar" : h.billedTo }));
      setLines(res.draft.lines.length ? res.draft.lines.map((l, i) => {
        const best = res.matches[i]?.[0];
        const sure = best && best.score >= 0.5;
        return { ...empty(), description: l.description, qty: l.qty, unitCost: l.unitCost, serials: l.serials.join("\n"), sku: sure ? best.sku : "", name: sure ? best.name : "", options: res.matches[i] ?? [] };
      }) : [empty()]);
      setNote({ ok: true, message: `Read ${res.draft.lines.length} line${res.draft.lines.length === 1 ? "" : "s"}. Check each one, pick the product where it isn't sure, and add serials.` });
    });
  }

  function save() {
    setNote(null);
    const input: ReceiptInput = {
      vendor: head.vendor, invoice: head.invoice, invoiceDate: head.invoiceDate || null, po: head.po || null, billedTo: head.billedTo || null, terms: head.terms,
      lines: lines.map((l) => ({ sku: l.sku, name: l.name || l.description, qty: l.qty, unitCost: l.unitCost, serials: l.serials.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean), condition: l.condition })),
      billPath: bill?.path ?? null, billName: bill?.name ?? null, note: head.note || null,
    };
    startSave(async () => {
      const res = await saveReceiptAction(input);
      setNote({ ok: res.ok, message: res.message });
      if (res.ok && res.id) setSaved(res.id);
    });
  }

  if (saved) {
    return (
      <div className="ims-card" style={{ maxWidth: 620 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Saved {saved}</h2>
        <p className="ims-note" style={{ marginTop: 6 }}>{note?.message}</p>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <Link href="/ims/stock-in" className="ims-btn">See stock in</Link>
          <button type="button" className="ims-btn is-quiet" onClick={() => { setSaved(null); setBill(null); setLines([empty()]); setHead({ vendor: "", invoice: "", invoiceDate: "", po: "", billedTo: "Curioso", terms: "Cash and Carry", note: "" }); setNote(null); }}>Add another bill</button>
        </div>
      </div>
    );
  }

  const total = lines.reduce((a, l) => a + l.qty * l.unitCost, 0);
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {!ready ? <p className="ims-card ims-note" style={{ borderColor: "rgba(251,191,36,0.4)" }}>Saving needs one step first: an admin runs <code>supabase/migrations/0007_ims.sql</code> in Supabase. You can still try reading a bill.</p> : null}
      <section className="ims-card">
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
          <label className="ims-btn is-accent" style={{ cursor: "pointer" }}>
            {reading ? <Sparkles size={16} /> : <Upload size={16} />} {reading ? "Reading the bill…" : bill ? "Upload another bill" : "Upload bill (photo or PDF)"}
            <input type="file" accept="image/*,application/pdf" capture="environment" hidden disabled={reading} onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
          </label>
          {bill ? <span className="ims-note">Kept: {bill.name}</span> : <span className="ims-note">Or fill the form below by hand.</span>}
        </div>
        {note ? <p className={note.ok ? "ims-msg-ok" : "ims-msg-bad"} style={{ marginTop: 10 }}>{note.message}</p> : null}
      </section>

      <section className="ims-card" style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <label className="ims-label">Vendor<input className="ims-input" list="ims-vendors" value={head.vendor} onChange={(e) => setHead({ ...head, vendor: e.target.value })} /></label>
          <label className="ims-label">Invoice number<input className="ims-input" value={head.invoice} onChange={(e) => setHead({ ...head, invoice: e.target.value })} /></label>
          <label className="ims-label">Invoice date<input className="ims-input" type="date" value={head.invoiceDate} onChange={(e) => setHead({ ...head, invoiceDate: e.target.value })} /></label>
          <label className="ims-label">PO (if any)<input className="ims-input" value={head.po} placeholder="PO-EPIK-26-27-0107" onChange={(e) => setHead({ ...head, po: e.target.value })} /></label>
          <label className="ims-label">Billed to<select className="ims-select" style={{ height: 40 }} value={head.billedTo} onChange={(e) => setHead({ ...head, billedTo: e.target.value })}><option>Curioso</option><option>Vivavilla</option><option>Navkar</option></select></label>
          <label className="ims-label">Terms<select className="ims-select" style={{ height: 40 }} value={head.terms} onChange={(e) => setHead({ ...head, terms: e.target.value as typeof head.terms })}><option>Cash and Carry</option><option>SOR</option></select></label>
        </div>
        <datalist id="ims-vendors">{vendors.map((v) => <option key={v} value={v} />)}</datalist>
        <datalist id="ims-products">{products.map((p) => <option key={p.sku} value={`${p.name} · ${p.sku}`} />)}</datalist>
      </section>

      {lines.map((l, i) => (
        <section key={i} className="ims-card" style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <strong style={{ fontSize: 14 }}>Line {i + 1}{l.description ? <span className="ims-sub">On the bill: {l.description}</span> : null}</strong>
            {lines.length > 1 ? <button type="button" className="ims-icon-btn" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove line"><Trash2 size={15} /></button> : null}
          </div>
          {l.options.length && !l.sku ? (
            <div className="ims-pills">{l.options.map((o) => <button key={o.sku} type="button" onClick={() => set(i, { sku: o.sku, name: o.name })}>{o.name.slice(0, 48)} · {Math.round(o.score * 100)}%</button>)}</div>
          ) : null}
          <label className="ims-label">Product (type to search)
            <input className="ims-input" list="ims-products" value={l.sku ? `${l.name} · ${l.sku}` : ""} placeholder="Start typing the product name or SKU" onChange={(e) => { const p = byName.get(e.target.value); set(i, p ? { sku: p.sku, name: p.name } : { sku: "", name: "" }); }} />
          </label>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
            <label className="ims-label">Quantity<input className="ims-input" type="number" min={1} value={l.qty} onChange={(e) => set(i, { qty: Number(e.target.value) })} /></label>
            <label className="ims-label">Cost per unit incl. GST (₹)<input className="ims-input" type="number" min={0} step="0.01" value={l.unitCost} onChange={(e) => set(i, { unitCost: Number(e.target.value) })} /></label>
            <label className="ims-label">Condition<select className="ims-select" style={{ height: 40 }} value={l.condition} onChange={(e) => set(i, { condition: e.target.value as Line["condition"] })}><option>Good</option><option>Open box</option><option>Damaged</option></select></label>
          </div>
          <label className="ims-label">Serials (scan or type, one per line; {l.serials.split(/[\s,;]+/).filter(Boolean).length} of {l.qty})
            <textarea className="ims-input" rows={Math.min(6, Math.max(2, l.qty))} value={l.serials} onChange={(e) => set(i, { serials: e.target.value })} placeholder="Scan each unit's barcode here" />
          </label>
        </section>
      ))}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <button type="button" className="ims-btn is-quiet" onClick={() => setLines([...lines, empty()])}><Plus size={15} /> Add a line</button>
        <span className="ims-note" style={{ marginLeft: "auto" }}>{lines.reduce((a, l) => a + l.qty, 0)} units · ₹{Math.round(total).toLocaleString("en-IN")}</span>
        <button type="button" className="ims-btn is-accent" disabled={saving || !ready} onClick={save}>{saving ? "Saving…" : "Save: add to stock"}</button>
      </div>
      {note && !note.ok ? <p className="ims-msg-bad">{note.message}</p> : null}
    </div>
  );
}

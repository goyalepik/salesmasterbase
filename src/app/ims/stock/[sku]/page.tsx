import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CATEGORIES, CATEGORY_COLOURS } from "@/features/ims/domain/categories";
import { daysBetween, INCOMING_LABELS } from "@/features/ims/domain/model";
import { ActionButtonForm } from "@/features/ims/ui/forms";
import { day, money, units } from "@/features/ims/ui/format";
import { CardHead } from "@/features/ims/ui/kit";
import { loadPage } from "@/features/ims/ui/load";
import { ImsShell } from "@/features/ims/ui/shell";
import { ImsUnavailable } from "@/features/ims/ui/unavailable";
import { setCategoryAction } from "@/app/actions/ims";
import "@/features/ims/ims.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Product · Inventory · EPIK" };

export default async function ImsProduct({ params }: { params: Promise<{ sku: string }> }) {
  const [{ sku: raw }, { data, role }] = await Promise.all([params, loadPage()]);
  if (!data) return <ImsUnavailable role={role} current="stock" />;
  const s = data.snapshot;
  const sku = decodeURIComponent(raw).toLowerCase();
  const p = s.products.find((x) => x.sku.toLowerCase() === sku);
  if (!p) {
    return (
      <ImsShell current="stock" role={role} readAt={data.readAt} stale={data.stale}>
        <Link href="/ims/stock" className="ims-back"><ArrowLeft size={15} /> Stock</Link>
        <p className="ims-card ims-empty">No product with SKU {raw} in the sheets.</p>
      </ImsShell>
    );
  }
  const all = s.units.filter((u) => u.sku.toLowerCase() === sku);
  const inStock = all.filter((u) => u.inStock && !u.returnedToVendor).sort((a, b) => (a.inwardOn ?? "").localeCompare(b.inwardOn ?? ""));
  const out = all.filter((u) => !u.inStock && u.dispatchedOn).sort((a, b) => (b.dispatchedOn ?? "").localeCompare(a.dispatchedOn ?? "")).slice(0, 15);
  const lines = s.incoming.filter((l) => l.sku?.toLowerCase() === sku);
  const ins = s.inwards.filter((w) => w.sku?.toLowerCase() === sku).slice(0, 15);

  return (
    <ImsShell current="stock" role={role} readAt={data.readAt} stale={data.stale}>
      <Link href={`/ims/stock?cat=${encodeURIComponent(p.category)}`} className="ims-back"><ArrowLeft size={15} /> {p.category}</Link>
      <div className="ims-head">
        <div style={{ maxWidth: 900 }}>
          <h1 style={{ fontSize: 22, lineHeight: 1.3 }}>{p.name}</h1>
          <p>{p.sku}{p.brand ? ` · ${p.brand}` : ""}{p.terms ? ` · ${p.terms}` : ""}{p.listPrice ? ` · list price ${money(p.listPrice)}` : ""}</p>
        </div>
        {role === "admin" ? (
          <ActionButtonForm action={setCategoryAction} className="ims-inline-form">
            <input type="hidden" name="sku" value={p.sku} />
            <select name="category" defaultValue={p.category} className="ims-select" aria-label="Category">{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            <button type="submit" className="ims-btn is-small is-quiet">Set category</button>
          </ActionButtonForm>
        ) : <span className="ims-tag is-quiet" style={{ gap: 6 }}><i style={{ width: 8, height: 8, borderRadius: 3, background: CATEGORY_COLOURS[p.category] }} />{p.category}</span>}
      </div>

      <div className="ims-grid" style={{ marginBottom: 14 }}>
        {[
          ["In stock", units(p.inStock)],
          ["Value at cost", money(p.value)],
          ["Tracker count", p.trackerUnits == null ? "—" : units(p.trackerUnits)],
          ["Coming", `${units(p.incoming)}${p.nextEta ? ` · ${day(p.nextEta)}` : ""}`],
          ["Sold, 30 days", units(p.out30)],
          ["Lasts", p.cover == null ? "—" : `${p.cover} days`],
        ].map(([label, value]) => (
          <div key={label} className="ims-card span-2" style={{ gridColumn: "span 2", padding: 16 }}>
            <div className="ims-note">{label}</div>
            <div style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>{value}</div>
          </div>
        ))}
      </div>

      <div className="ims-grid">
        <section className="ims-card span-7">
          <CardHead title="Units in stock" sub="Oldest first" />
          {inStock.length ? (
            <div className="ims-table-wrap">
              <table className="ims-table">
                <thead><tr><th>Serial</th><th>Hub</th><th>Came in</th><th className="n">Age</th><th>Vendor</th><th className="n">Cost</th></tr></thead>
                <tbody>
                  {inStock.map((u, i) => (
                    <tr key={`${u.serial}-${i}`}>
                      <td><strong>{u.serial ?? "No serial"}</strong>{u.qty > 1 ? <span className="ims-sub">{u.qty} units</span> : null}</td>
                      <td>{u.hub ?? "—"}</td>
                      <td>{day(u.inwardOn)}</td>
                      <td className="n">{u.inwardOn ? daysBetween(u.inwardOn, s.today) : "—"}</td>
                      <td>{u.vendor ?? "—"}<span className="ims-sub">{u.invoice ? `Inv ${u.invoice}` : ""}</span></td>
                      <td className="n">{u.cost ? money(u.cost) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="ims-empty">None in stock.</p>}
        </section>
        <div className="span-5" style={{ display: "grid", gap: 14, alignContent: "start" }}>
          {lines.length ? (
            <section className="ims-card">
              <CardHead title="On order" />
              <div className="ims-list">
                {lines.map((l) => (
                  <div key={l.row}><span><strong>{l.po ?? "No PO number"} · {l.pending} of {l.qty}</strong><small>{l.vendor ?? "—"} · ETA {day(l.eta)}{l.appStatus ? ` · ${l.appStatus}` : ""}</small></span><span className={`ims-tag ${l.state === "overdue" ? "is-bad" : "is-accent"}`}>{INCOMING_LABELS[l.state]}</span></div>
                ))}
              </div>
            </section>
          ) : null}
          <section className="ims-card">
            <CardHead title="Came in" sub="Latest inwards" />
            {ins.length ? <div className="ims-list">{ins.map((w) => <div key={w.id}><span><strong>{day(w.on)} · {w.qty} unit{w.qty === 1 ? "" : "s"}</strong><small>{w.vendor ?? "—"}{w.invoice ? ` · Inv ${w.invoice}` : ""}{w.source === "app" ? " · added here" : ""}</small></span><b>{money(w.cost * w.qty)}</b></div>)}</div> : <p className="ims-empty">No inwards recorded.</p>}
          </section>
          <section className="ims-card">
            <CardHead title="Went out" sub="Latest dispatches" />
            {out.length ? <div className="ims-list">{out.map((u, i) => <div key={i}><span><strong>{day(u.dispatchedOn)}</strong><small>{u.serial ?? "—"}{u.poc ? ` · ${u.poc}` : ""}</small></span><b>{money(u.cost)}</b></div>)}</div> : <p className="ims-empty">Nothing dispatched yet.</p>}
          </section>
        </div>
      </div>
    </ImsShell>
  );
}

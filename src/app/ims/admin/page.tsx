import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { saveImsSourcesAction, setCategoryAction } from "@/app/actions/ims";
import { CATEGORIES, CATEGORY_COLOURS } from "@/features/ims/domain/categories";
import { readSources, SOURCE_IDS, SOURCE_INFO } from "@/features/ims/sources";
import { ActionButtonForm } from "@/features/ims/ui/forms";
import { units } from "@/features/ims/ui/format";
import { CardHead } from "@/features/ims/ui/kit";
import { loadPage, type SearchParams } from "@/features/ims/ui/load";
import { ImsShell } from "@/features/ims/ui/shell";
import { firstParam } from "@/lib/query";
import "@/features/ims/ims.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin · Inventory · EPIK" };

const FLOW = [
  ["PO raised", "Procurement sheet → Procurement list", "Shows under Incoming until it arrives."],
  ["Goods arrive", "Procurement sheet → Inward Sheet, or a bill added here", "Shows under Stock in, with invoice, vendor and cost."],
  ["In stock", "Inventory Masterbase (In System = Yes)", "The truth for stock: one row per serial."],
  ["Dispatched", "Masterbase dispatch date + Dispatch Tracker status", "Leaves stock; delivery status under Dispatch."],
];

export default async function ImsAdmin({ searchParams }: { searchParams: SearchParams }) {
  const [{ data, role, q }, links] = await Promise.all([loadPage(searchParams), readSources()]);
  if (role !== "admin") {
    return <ImsShell current="admin" role={role} readAt={data?.readAt ?? null}><p className="ims-card ims-empty">Switch to Admin (top right) to see this page.</p></ImsShell>;
  }
  const s = data?.snapshot;
  const catFilter = firstParam(q.cat) ?? "unsure";
  const catList = (s?.products ?? []).filter((p) => p.inStock > 0 || p.out30 > 0).filter((p) => (catFilter === "unsure" ? p.categorySource !== "name" && p.categorySource !== "admin" : catFilter === "all" ? true : p.category === catFilter)).slice(0, 120);

  return (
    <ImsShell current="admin" role={role} readAt={data?.readAt ?? null} stale={data?.stale}>
      <div className="ims-head">
        <div>
          <h1>Admin</h1>
          <p>Where the data comes from, categories, and the data checks the team should fix in the sheets.</p>
        </div>
      </div>

      <section className="ims-card" style={{ marginBottom: 14 }}>
        <CardHead title="How stock moves" sub="Each step and where it is written today. The IMS only reads the sheets; it never changes them." />
        <div className="ims-grid">
          {FLOW.map(([t, w, d], i) => (
            <div key={t} className="span-3" style={{ padding: 14, borderRadius: 16, background: "rgba(255,255,255,0.03)", border: "1px solid var(--line)" }}>
              <div className="ims-note">Step {i + 1}</div>
              <div style={{ fontWeight: 600, marginTop: 2 }}>{t}</div>
              <div style={{ fontSize: 12.5, color: "#c9c1ff", marginTop: 4 }}>{w}</div>
              <div className="ims-note" style={{ marginTop: 4 }}>{d}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="ims-grid" style={{ marginBottom: 14 }}>
        <section className="ims-card span-7">
          <CardHead title="Sources" sub="One tab per link (with its gid). Each sheet must be viewable by anyone with the link." />
          <div style={{ display: "grid", gap: 6, marginBottom: 14 }}>
            {SOURCE_IDS.map((id) => {
              const st = data?.sources.find((x) => x.id === id);
              return (
                <div key={id} style={{ display: "flex", gap: 8, fontSize: 13 }}>
                  {st?.ok ? <CheckCircle2 size={16} style={{ color: "var(--good)", flexShrink: 0, marginTop: 2 }} /> : <CircleAlert size={16} style={{ color: "var(--bad)", flexShrink: 0, marginTop: 2 }} />}
                  <span><strong>{SOURCE_INFO[id].sheet} → {SOURCE_INFO[id].tab}</strong>: {st?.ok ? `${units(st.rows)} rows` : st?.message ?? "not read"}. <span className="ims-note">{SOURCE_INFO[id].role}</span></span>
                </div>
              );
            })}
          </div>
          <ActionButtonForm action={saveImsSourcesAction} className="ims-inline-form" >
            <div style={{ display: "grid", gap: 8, width: "100%" }}>
              {SOURCE_IDS.map((id) => (
                <label key={id} className="ims-label">{SOURCE_INFO[id].sheet} → {SOURCE_INFO[id].tab}
                  <input name={id} defaultValue={links[id] ?? ""} className="ims-input" placeholder="https://docs.google.com/spreadsheets/d/…/edit?gid=…" autoComplete="off" />
                </label>
              ))}
            </div>
            <button type="submit" className="ims-btn is-small">Save and check</button>
          </ActionButtonForm>
        </section>
        <section className="ims-card span-5">
          <CardHead title="Data checks" sub="Problems in the sheets. Not shown on the dashboards; send the list to the team." />
          {s?.checks.length ? (
            <div style={{ display: "grid" }}>
              {s.checks.map((c, i) => (
                <details key={c.id} className="ims-details" style={{ borderTop: i ? "1px solid var(--line)" : 0 }}>
                  <summary style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "11px 0" }}>
                    <span><strong style={{ fontSize: 13.5 }}>{c.title}</strong>{c.detail ? <span className="ims-sub">{c.detail}</span> : null}</span>
                    <span className="ims-tag is-warn">{units(c.count)}</span>
                  </summary>
                  {c.items?.length ? <div className="ims-list" style={{ paddingBottom: 8 }}>{c.items.slice(0, 25).map((it, j) => <div key={j}><small style={{ color: "var(--ink-2)" }}>{it.label}</small><small>{it.a}{it.b ? ` · ${it.b}` : ""}</small></div>)}</div> : null}
                </details>
              ))}
            </div>
          ) : <p className="ims-empty">All clear.</p>}
        </section>
      </div>

      <section className="ims-card">
        <CardHead title="Categories" sub="Decided from the product name; where the name isn't clear, the sheets' category is used. Fix any here; your choice always wins." />
        <nav className="ims-pills" style={{ marginBottom: 12 }}>
          <Link href="/ims/admin?cat=unsure" aria-current={catFilter === "unsure" ? "page" : undefined}>Not sure</Link>
          <Link href="/ims/admin?cat=all" aria-current={catFilter === "all" ? "page" : undefined}>All</Link>
          {CATEGORIES.map((c) => <Link key={c} href={`/ims/admin?cat=${encodeURIComponent(c)}`} aria-current={catFilter === c ? "page" : undefined}>{c}</Link>)}
        </nav>
        {catList.length ? (
          <div className="ims-table-wrap">
            <table className="ims-table">
              <tbody>
                {catList.map((p) => (
                  <tr key={p.sku}>
                    <td className="name"><Link href={`/ims/stock/${encodeURIComponent(p.sku)}`}>{p.name}</Link><small>{p.sku} · {p.categorySource === "admin" ? "set by admin" : p.categorySource === "name" ? "from the name" : p.categorySource === "sheet" ? "from the sheet's category" : "no clue"}</small></td>
                    <td><span style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12.5 }}><i style={{ width: 8, height: 8, borderRadius: 3, background: CATEGORY_COLOURS[p.category] }} />{p.category}</span></td>
                    <td>
                      <ActionButtonForm action={setCategoryAction} className="ims-inline-form">
                        <input type="hidden" name="sku" value={p.sku} />
                        <select name="category" defaultValue={p.category} className="ims-select" aria-label="Category">{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
                        <button type="submit" className="ims-btn is-small is-quiet">Save</button>
                      </ActionButtonForm>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="ims-empty">Nothing to fix here.</p>}
      </section>
    </ImsShell>
  );
}

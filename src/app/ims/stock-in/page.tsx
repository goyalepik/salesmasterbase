import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown, FileText, Plus } from "lucide-react";
import { voidReceiptAction } from "@/app/actions/ims";
import { addDays } from "@/features/ims/domain/model";
import { canEdit } from "@/features/ims/role";
import { billLink } from "@/features/ims/store";
import { ConfirmButton } from "@/features/ims/ui/confirm-button";
import { day, money, units } from "@/features/ims/ui/format";
import { CardHead, Kpi } from "@/features/ims/ui/kit";
import { loadPage, type SearchParams } from "@/features/ims/ui/load";
import { ImsShell } from "@/features/ims/ui/shell";
import { ImsUnavailable } from "@/features/ims/ui/unavailable";
import { firstParam } from "@/lib/query";
import "@/features/ims/ims.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Stock in · Inventory · EPIK" };

export default async function ImsStockIn({ searchParams }: { searchParams: SearchParams }) {
  const { data, role, r, q: query } = await loadPage(searchParams);
  if (!data) return <ImsUnavailable role={role} current="in" />;
  const s = data.snapshot;
  const q = (firstParam(query.q) ?? "").toLowerCase().trim().slice(0, 60);
  const sum = (from: string) => s.inwards.filter((w) => w.on && w.on >= from && w.on <= s.today).reduce((a, w) => ({ units: a.units + w.qty, value: a.value + w.qty * w.cost }), { units: 0, value: 0 });
  const today = sum(s.today), week = sum(addDays(s.today, -6)), month = sum(addDays(s.today, -29));
  const list = s.inwards.filter((w) => w.on && w.on >= s.range.from && w.on <= s.range.to && (!q || `${w.vendor} ${w.name} ${w.sku} ${w.invoice} ${w.serial} ${w.po}`.toLowerCase().includes(q)));
  // One group per invoice (or per day + vendor when there is no invoice).
  const groups = new Map<string, { on: string | null; vendor: string; invoice: string | null; po: string | null; billedTo: string | null; source: "sheet" | "app"; items: typeof list }>();
  for (const w of list) {
    const k = `${w.on}|${w.invoice ?? w.vendor}`;
    const g = groups.get(k) ?? { on: w.on, vendor: w.vendor ?? "Vendor not filled", invoice: w.invoice, po: w.po, billedTo: w.billedTo, source: w.source, items: [] };
    g.items.push(w);
    groups.set(k, g);
  }
  const editor = canEdit(role);
  const appReceipts = s.receipts.slice(0, 20);
  const links = await Promise.all(appReceipts.map((rc) => (rc.billPath ? billLink(rc.billPath).catch(() => null) : null)));

  return (
    <ImsShell current="in" role={role} readAt={data.readAt} stale={data.stale} range={r}>
      <div className="ims-head">
        <div>
          <h1>Stock in</h1>
          <p>Live from the Procurement sheet&apos;s Inward Sheet, plus bills added here. {s.range.label}.</p>
        </div>
        {editor ? <Link href="/ims/stock-in/new" className="ims-btn is-accent"><Plus size={16} /> Add stock from a bill</Link> : null}
      </div>
      {editor && !data.entriesReady ? <p className="ims-card ims-note" style={{ marginBottom: 14, borderColor: "rgba(251,191,36,0.4)" }}>One step left before bills can be saved: an admin runs <code>supabase/migrations/0007_ims.sql</code> in Supabase (SQL Editor → New query → paste → Run).</p> : null}

      <div className="ims-grid" style={{ marginBottom: 14 }}>
        <div className="span-4"><Kpi label="Today" value={units(today.units)} sub={`${money(today.value)} at cost`} /></div>
        <div className="span-4"><Kpi label="Last 7 days" value={units(week.units)} sub={`${money(week.value)} at cost`} /></div>
        <div className="span-4"><Kpi label="Last 30 days" value={units(month.units)} sub={`${money(month.value)} at cost`} /></div>
      </div>

      {appReceipts.length ? (
        <section className="ims-card" style={{ marginBottom: 14 }}>
          <CardHead title="Bills added here" sub="Newest first. These count in stock until the Masterbase has the same serials or invoice." />
          <div className="ims-list">
            {appReceipts.map((rc, i) => (
              <div key={rc.id}>
                <span style={{ minWidth: 0 }}>
                  <strong>{rc.id} · {rc.vendor} · Inv {rc.invoice}{rc.voided ? " · cancelled" : ""}</strong>
                  <small>{day(rc.at.slice(0, 10))} by {rc.by} · {rc.lines.reduce((a, l) => a + l.qty, 0)} units · {money(rc.lines.reduce((a, l) => a + l.qty * l.unitCost, 0))}</small>
                </span>
                <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {links[i] ? <a href={links[i]!} target="_blank" rel="noreferrer" className="ims-btn is-small is-quiet"><FileText size={14} /> Bill</a> : null}
                  {editor && !rc.voided ? <ConfirmButton action={voidReceiptAction} arg={rc.id} label="Cancel" confirm={`Cancel ${rc.id}? Its units leave stock.`} /> : null}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <form action="/ims/stock-in" className="ims-search" role="search" style={{ marginBottom: 12 }}>
        <label><input name="q" defaultValue={q} placeholder="Vendor, product, invoice, PO or serial" aria-label="Filter stock in" autoComplete="off" /></label>
        {r !== "30d" ? <input type="hidden" name="r" value={r} /> : null}
        <button type="submit" className="ims-btn">Filter</button>
      </form>

      <section className="ims-card">
        <CardHead title={`${groups.size} deliveries · ${units(list.reduce((a, w) => a + w.qty, 0))} units`} sub={`${money(list.reduce((a, w) => a + w.qty * w.cost, 0))} at cost`} />
        {groups.size ? (
          <div style={{ display: "grid" }}>
            {[...groups.values()].slice(0, 200).map((g, i) => {
              const u = g.items.reduce((a, w) => a + w.qty, 0);
              const v = g.items.reduce((a, w) => a + w.qty * w.cost, 0);
              const bad = g.items.filter((w) => /bad|damag|average/i.test(w.condition ?? "")).length;
              return (
                <details key={i} className="ims-details" style={{ borderTop: i ? "1px solid var(--line)" : 0 }}>
                  <summary style={{ display: "grid", gridTemplateColumns: "70px minmax(0,1fr) auto auto 18px", gap: 12, alignItems: "center", padding: "12px 0" }}>
                    <span className="ims-note">{day(g.on)}</span>
                    <span style={{ minWidth: 0 }}><strong style={{ fontSize: 14 }}>{g.vendor}</strong><span className="ims-sub">{g.invoice ? `Inv ${g.invoice}` : "No invoice"}{g.po ? ` · ${g.po}` : ""}{g.billedTo ? ` · ${g.billedTo}` : ""}{g.source === "app" ? " · added here" : ""}</span></span>
                    <span>{bad ? <span className="ims-tag is-warn">{bad} not good</span> : null}</span>
                    <span style={{ textAlign: "right" }}><strong>{units(u)}</strong><span className="ims-sub">{money(v)}</span></span>
                    <ChevronDown size={16} className="ims-chev" />
                  </summary>
                  <div className="ims-table-wrap" style={{ paddingBottom: 10 }}>
                    <table className="ims-table">
                      <thead><tr><th>Product</th><th>Serial</th><th className="n">Qty</th><th className="n">Cost each</th><th>Condition</th></tr></thead>
                      <tbody>
                        {g.items.map((w) => (
                          <tr key={w.id}>
                            <td className="name">{w.sku ? <Link href={`/ims/stock/${encodeURIComponent(w.sku)}`}>{w.name}</Link> : <strong>{w.name}</strong>}<small>{w.sku ?? "No SKU"}</small></td>
                            <td>{w.serial ?? "—"}</td>
                            <td className="n">{w.qty}</td>
                            <td className="n">{w.cost ? money(w.cost) : "—"}</td>
                            <td>{w.condition ? <span className={`ims-tag ${/good/i.test(w.condition) ? "is-good" : "is-warn"}`}>{w.condition}</span> : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              );
            })}
          </div>
        ) : <p className="ims-empty">Nothing received in this period.</p>}
      </section>
    </ImsShell>
  );
}

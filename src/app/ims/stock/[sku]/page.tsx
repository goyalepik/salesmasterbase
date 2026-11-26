import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { INCOMING_LABELS } from "@/features/ims/domain/model";
import { imsRole } from "@/features/ims/role";
import { loadIms } from "@/features/ims/sources";
import { day, money, units } from "@/features/ims/ui/format";
import { ImsShell } from "@/features/ims/ui/shell";
import { ImsUnavailable } from "@/features/ims/ui/unavailable";
import "@/features/ims/ims.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Product · Inventory · EPIK" };

const ageOf = (from: string | null, today: string) => (from ? Math.max(0, Math.round((Date.parse(today) - Date.parse(from)) / 86_400_000)) : null);

export default async function ImsProduct({ params }: { params: Promise<{ sku: string }> }) {
  const [{ sku: raw }, data, role] = await Promise.all([params, loadIms(), imsRole()]);
  if (!data) return <ImsUnavailable role={role} current="stock" />;
  const s = data.snapshot;
  const admin = role === "admin";
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

  return (
    <ImsShell current="stock" role={role} readAt={data.readAt} stale={data.stale}>
      <Link href="/ims/stock" className="ims-back"><ArrowLeft size={15} /> Stock</Link>
      <div className="ims-head">
        <div>
          <h1 style={{ fontSize: 22 }}>{p.name}</h1>
          <p>{p.sku}{p.brand ? ` · ${p.brand}` : ""}{p.terms ? ` · ${p.terms}` : ""}</p>
        </div>
      </div>
      <dl className="ims-facts" style={{ marginBottom: 14 }}>
        <div><dt>In stock</dt><dd>{units(p.inStock)}</dd></div>
        <div><dt>Tracker count</dt><dd>{p.trackerUnits == null ? "—" : units(p.trackerUnits)}{p.gap ? <span className="ims-tag is-warn" style={{ marginLeft: 6 }}>{p.gap > 0 ? `+${p.gap}` : p.gap}</span> : null}</dd></div>
        <div><dt>Coming</dt><dd>{units(p.incoming)}{p.nextEta ? <small className="ml-1 text-[12px] font-normal text-[var(--ims-muted)]">by {day(p.nextEta)}</small> : null}</dd></div>
        <div><dt>Sold, 30 days</dt><dd>{units(p.out30)}</dd></div>
        <div><dt>Lasts</dt><dd>{p.cover == null ? "—" : `${p.cover} days`}</dd></div>
        {admin ? <div><dt>Value at cost</dt><dd>{money(p.value)}</dd></div> : null}
      </dl>

      {lines.length ? (
        <>
          <div className="ims-section-title"><h2>On order</h2><span>{lines.length} PO line{lines.length === 1 ? "" : "s"}</span></div>
          <section className="ims-card ims-table-wrap">
            <table className="ims-table">
              <thead><tr><th>PO</th><th>Vendor</th><th className="n">Pending</th><th>ETA</th><th>State</th><th>Owner</th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.row}>
                    <td><strong>{l.po ?? "No PO number"}</strong><small className="block text-[12px] text-[var(--ims-faint)]">raised {day(l.raisedOn)}</small></td>
                    <td>{l.vendor ?? "—"}</td>
                    <td className="n">{l.pending} of {l.qty}</td>
                    <td>{day(l.eta)}{l.delayReason ? <small className="block text-[12px] text-[var(--ims-faint)]">{l.delayReason}</small> : null}</td>
                    <td><span className={`ims-tag ${l.state === "overdue" ? "is-bad" : l.state === "stale" ? "is-quiet" : "is-accent"}`}>{INCOMING_LABELS[l.state]}</span></td>
                    <td>{l.owner ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : null}

      <div className="ims-section-title"><h2>Units in stock</h2><span>Oldest first</span></div>
      <section className="ims-card ims-table-wrap">
        {inStock.length ? (
          <table className="ims-table">
            <thead><tr><th>Serial</th><th>Hub</th><th>In on</th><th className="n">Age</th><th>Vendor</th><th>Condition</th>{admin ? <th className="n">Cost</th> : null}</tr></thead>
            <tbody>
              {inStock.map((u, i) => (
                <tr key={`${u.serial}-${i}`}>
                  <td><strong>{u.serial ?? "No serial"}</strong>{u.qty > 1 ? <small className="block text-[12px] text-[var(--ims-faint)]">{u.qty} units</small> : null}</td>
                  <td>{u.hub ?? "—"}</td>
                  <td>{day(u.inwardOn)}</td>
                  <td className="n">{ageOf(u.inwardOn, s.today) ?? "—"}</td>
                  <td>{u.vendor ?? "—"}{u.invoice ? <small className="block text-[12px] text-[var(--ims-faint)]">Inv {u.invoice}</small> : null}</td>
                  <td>{u.condition ?? "—"}</td>
                  {admin ? <td className="n">{u.cost ? money(u.cost) : "—"}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="ims-empty">None in stock.</p>
        )}
      </section>

      {out.length ? (
        <>
          <div className="ims-section-title"><h2>Recently dispatched</h2><span>Last 15</span></div>
          <section className="ims-card ims-table-wrap">
            <table className="ims-table">
              <thead><tr><th>Serial</th><th>Dispatched</th><th>Sold by</th>{admin ? <th>Customer</th> : null}</tr></thead>
              <tbody>
                {out.map((u, i) => (
                  <tr key={`${u.serial}-${i}`}><td>{u.serial ?? "—"}</td><td>{day(u.dispatchedOn)}</td><td>{u.poc ?? "—"}</td>{admin ? <td>{u.customer ?? "—"}</td> : null}</tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : null}
    </ImsShell>
  );
}

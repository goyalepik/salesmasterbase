import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { CATEGORY_COLOURS } from "@/features/ims/domain/categories";
import { findProducts, findUnits, productsInView, STOCK_VIEWS, type StockView } from "@/features/ims/domain/model";
import { day, money, units } from "@/features/ims/ui/format";
import { loadPage, type SearchParams } from "@/features/ims/ui/load";
import { ImsShell } from "@/features/ims/ui/shell";
import { ImsUnavailable } from "@/features/ims/ui/unavailable";
import { firstParam } from "@/lib/query";
import "@/features/ims/ims.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Stock · Inventory · EPIK" };

export default async function ImsStock({ searchParams }: { searchParams: SearchParams }) {
  const { data, role, r, q: query } = await loadPage(searchParams);
  if (!data) return <ImsUnavailable role={role} current="stock" />;
  const s = data.snapshot;
  const q = (firstParam(query.q) ?? "").trim().slice(0, 80);
  const cat = firstParam(query.cat) ?? null;
  const view = (STOCK_VIEWS.some((v) => v.id === firstParam(query.view)) ? firstParam(query.view) : "in") as StockView;
  const serials = q ? findUnits(s, q) : [];
  const list = q ? findProducts(s, q, 300) : productsInView(s, view, cat);
  const link = (o: { view?: string; cat?: string | null }) => {
    const p = new URLSearchParams();
    if (o.view ?? view) p.set("view", o.view ?? view);
    const c = o.cat === undefined ? cat : o.cat;
    if (c) p.set("cat", c);
    if (r !== "30d") p.set("r", r);
    return `/ims/stock?${p.toString()}`;
  };

  return (
    <ImsShell current="stock" role={role} readAt={data.readAt} stale={data.stale}>
      <div className="ims-head">
        <div>
          <h1>Stock{cat ? ` · ${cat}` : ""}</h1>
          <p>Counted from the Masterbase serials. Search by product, SKU, brand or serial.</p>
        </div>
      </div>

      <div className="ims-grid" style={{ marginBottom: 14 }}>
        <div className="span-12" style={{ display: "flex", gap: 8, overflowX: "auto", scrollbarWidth: "none" }}>
          <Link href={link({ cat: null })} className="ims-card" style={{ padding: "12px 16px", minWidth: 150, borderColor: !cat ? "rgba(255,255,255,0.3)" : undefined }}>
            <div className="ims-note">All categories</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{units(s.kpis.unitsInStock)}</div>
            <div className="ims-sub">{money(s.kpis.stockValue)}</div>
          </Link>
          {s.categories.map((c) => (
            <Link key={c.category} href={link({ cat: c.category })} className="ims-card" style={{ padding: "12px 16px", minWidth: 150, borderColor: cat === c.category ? CATEGORY_COLOURS[c.category] : undefined }}>
              <div className="ims-note" style={{ display: "flex", alignItems: "center", gap: 6 }}><i style={{ width: 8, height: 8, borderRadius: 3, background: CATEGORY_COLOURS[c.category] }} />{c.category}</div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{units(c.units)}</div>
              <div className="ims-sub">{money(c.value)}{c.cover != null ? ` · lasts ${c.cover} d` : ""}</div>
            </Link>
          ))}
        </div>
      </div>

      <form action="/ims/stock" className="ims-search" role="search" style={{ marginBottom: 12 }}>
        <label><Search size={17} aria-hidden="true" /><input name="q" defaultValue={q} placeholder="L50 Ultra, ep-ap-i16, Dreame, or a serial" aria-label="Search stock" autoComplete="off" /></label>
        <button type="submit" className="ims-btn">Search</button>
      </form>
      {!q ? (
        <nav className="ims-pills" aria-label="Views" style={{ marginBottom: 14 }}>
          {STOCK_VIEWS.map((v) => <Link key={v.id} href={link({ view: v.id })} aria-current={view === v.id ? "page" : undefined}>{v.label} <span>{productsInView(s, v.id, cat).length}</span></Link>)}
        </nav>
      ) : <p className="ims-note" style={{ marginBottom: 12 }}>{list.length} products{serials.length ? ` and ${serials.length} serials` : ""} for “{q}”. <Link href="/ims/stock" className="underline">Clear</Link></p>}

      {serials.length ? (
        <section className="ims-card" style={{ marginBottom: 14 }}>
          <div className="ims-table-wrap">
            <table className="ims-table">
              <thead><tr><th>Serial</th><th>Product</th><th>Where</th><th>Came in</th><th>Went out</th></tr></thead>
              <tbody>
                {serials.map((u, i) => (
                  <tr key={`${u.serial}-${i}`}>
                    <td><strong>{u.serial}</strong></td>
                    <td className="name"><Link href={`/ims/stock/${encodeURIComponent(u.sku)}`}>{u.name}</Link><small>{u.sku}</small></td>
                    <td>{u.inStock ? <span className="ims-tag is-good">In stock · {u.hub ?? "hub?"}</span> : u.returnedToVendor ? <span className="ims-tag is-quiet">Back to vendor</span> : <span className="ims-tag is-accent">Dispatched{u.poc ? ` · ${u.poc}` : ""}</span>}</td>
                    <td>{day(u.inwardOn)}<span className="ims-sub">{u.vendor ?? ""}</span></td>
                    <td>{day(u.dispatchedOn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="ims-card">
        {list.length ? (
          <div className="ims-table-wrap">
            <table className="ims-table">
              <thead><tr><th>Product</th><th>Category</th><th className="n">In stock</th><th className="n">Value</th><th className="n">Coming</th><th className="n">Sold 30d</th><th className="n">Lasts</th><th className="n">Avg age</th></tr></thead>
              <tbody>
                {list.slice(0, 300).map((p) => (
                  <tr key={p.sku}>
                    <td className="name"><Link href={`/ims/stock/${encodeURIComponent(p.sku)}`}>{p.name}</Link><small>{p.sku}{p.brand ? ` · ${p.brand}` : ""}</small></td>
                    <td><span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", fontSize: 12.5, color: "var(--ink-2)" }}><i style={{ width: 8, height: 8, borderRadius: 3, background: CATEGORY_COLOURS[p.category] }} />{p.category}</span></td>
                    <td className="n"><strong>{units(p.inStock)}</strong></td>
                    <td className="n">{p.value ? money(p.value) : "—"}</td>
                    <td className="n">{p.incoming ? <>{units(p.incoming)}<span className="ims-sub">{p.nextEta ? day(p.nextEta) : ""}</span></> : "—"}</td>
                    <td className="n">{p.out30 || "—"}</td>
                    <td className="n">{p.cover == null ? "—" : p.cover < 7 ? <span className="ims-tag is-bad">{p.cover} d</span> : p.cover < 15 ? <span className="ims-tag is-warn">{p.cover} d</span> : `${Math.min(p.cover, 365)}${p.cover > 365 ? "+" : ""} d`}</td>
                    <td className="n">{p.avgAge == null ? "—" : p.avgAge > 90 ? <span className="ims-tag is-warn">{p.avgAge} d</span> : `${p.avgAge} d`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="ims-empty">{q ? "Nothing matches. Try fewer words." : "Nothing in this view."}</p>}
      </section>
      <p className="ims-foot">“Lasts” is how many days the stock lasts at the last 30 days’ pace. Value is at cost incl. GST.</p>
    </ImsShell>
  );
}

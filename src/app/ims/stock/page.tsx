import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { findProducts, findUnits, productsInView, STOCK_VIEWS, type Product, type StockView } from "@/features/ims/domain/model";
import { imsRole } from "@/features/ims/role";
import { loadIms } from "@/features/ims/sources";
import { day, money, units } from "@/features/ims/ui/format";
import { ImsShell } from "@/features/ims/ui/shell";
import { ImsUnavailable } from "@/features/ims/ui/unavailable";
import { firstParam } from "@/lib/query";
import "@/features/ims/ims.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Stock · Inventory · EPIK" };

const LIMIT = 300;

export default async function ImsStock({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [data, role, query] = await Promise.all([loadIms(), imsRole(), searchParams]);
  if (!data) return <ImsUnavailable role={role} current="stock" />;
  const s = data.snapshot;
  const admin = role === "admin";
  const q = (firstParam(query.q) ?? "").trim().slice(0, 80);
  const view = (STOCK_VIEWS.some((v) => v.id === firstParam(query.view)) ? firstParam(query.view) : "in") as StockView;
  const serials = q ? findUnits(s, q) : [];
  const list: Product[] = q ? findProducts(s, q, LIMIT) : productsInView(s, view);
  const counts = Object.fromEntries(STOCK_VIEWS.map((v) => [v.id, productsInView(s, v.id).length]));

  return (
    <ImsShell current="stock" role={role} readAt={data.readAt} stale={data.stale}>
      <div className="ims-head">
        <div>
          <h1>Stock</h1>
          <p>Every product, counted from the Masterbase serials. Search by name, SKU, brand or serial.</p>
        </div>
      </div>
      <form action="/ims/stock" className="ims-search" role="search">
        <label>
          <Search size={17} aria-hidden="true" />
          <input name="q" defaultValue={q} placeholder="L50 Ultra, ep-ap-i16, Dreame, or a serial" aria-label="Search stock" autoComplete="off" />
        </label>
        <button type="submit">Search</button>
      </form>
      {!q ? (
        <nav className="ims-pills" aria-label="Views">
          {STOCK_VIEWS.map((v) => (
            <Link key={v.id} href={`/ims/stock?view=${v.id}`} aria-current={view === v.id ? "page" : undefined}>{v.label} <span>{counts[v.id]}</span></Link>
          ))}
        </nav>
      ) : (
        <p className="ims-note" style={{ marginBottom: 10 }}>{list.length} product{list.length === 1 ? "" : "s"}{serials.length ? ` and ${serials.length} serial${serials.length === 1 ? "" : "s"}` : ""} for “{q}”. <Link href="/ims/stock" className="underline">Clear</Link></p>
      )}

      {serials.length ? (
        <section className="ims-card" style={{ marginBottom: 12 }}>
          <div className="ims-table-wrap">
            <table className="ims-table">
              <thead><tr><th>Serial</th><th>Product</th><th>Where</th><th>In</th><th>Out</th></tr></thead>
              <tbody>
                {serials.map((u, i) => (
                  <tr key={`${u.serial}-${i}`}>
                    <td><strong>{u.serial}</strong></td>
                    <td className="name"><Link href={`/ims/stock/${encodeURIComponent(u.sku)}`}>{u.name}</Link><small>{u.sku}</small></td>
                    <td>{u.inStock ? <span className="ims-tag is-good">In stock · {u.hub ?? "hub?"}</span> : u.returnedToVendor ? <span className="ims-tag is-quiet">Back to vendor</span> : <span className="ims-tag is-accent">Dispatched{u.poc ? ` · ${u.poc}` : ""}</span>}</td>
                    <td>{day(u.inwardOn)}{u.vendor ? <small className="block text-[12px] text-[var(--ims-faint)]">{u.vendor}</small> : null}</td>
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
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="n">In stock</th>
                  <th className="n">Tracker</th>
                  <th className="n">Coming</th>
                  <th className="n">Sold 30d</th>
                  <th className="n">Lasts</th>
                  <th className="n">Avg age</th>
                  {admin ? <th className="n">Value</th> : null}
                </tr>
              </thead>
              <tbody>
                {list.slice(0, LIMIT).map((p) => (
                  <tr key={p.sku}>
                    <td className="name"><Link href={`/ims/stock/${encodeURIComponent(p.sku)}`}>{p.name}</Link><small>{p.sku}{p.brand ? ` · ${p.brand}` : ""}</small></td>
                    <td className="n"><strong>{units(p.inStock)}</strong></td>
                    <td className="n">{p.trackerUnits == null ? "—" : p.gap ? <span className="ims-tag is-warn" title="The Tracker's count differs">{units(p.trackerUnits)}</span> : units(p.trackerUnits)}</td>
                    <td className="n">{p.incoming ? <>{units(p.incoming)}{p.nextEta ? <small className="block text-[11.5px] text-[var(--ims-faint)]">{day(p.nextEta)}</small> : null}</> : "—"}</td>
                    <td className="n">{p.out30 || "—"}</td>
                    <td className="n">{p.cover == null ? "—" : p.cover < 7 ? <span className="ims-tag is-bad">{p.cover} d</span> : p.cover < 15 ? <span className="ims-tag is-warn">{p.cover} d</span> : `${p.cover > 365 ? "365+" : p.cover} d`}</td>
                    <td className="n">{p.avgAge == null ? "—" : p.avgAge > 90 ? <span className="ims-tag is-warn">{p.avgAge} d</span> : `${p.avgAge} d`}</td>
                    {admin ? <td className="n">{p.value ? money(p.value) : "—"}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ims-empty">{q ? "Nothing matches. Try fewer words." : "Nothing in this view."}</p>
        )}
      </section>
      <p className="ims-foot">“Lasts” is how many days the stock lasts at the last 30 days’ pace. “Tracker” is the Inventory Tracker’s daily count; amber where it differs.</p>
    </ImsShell>
  );
}

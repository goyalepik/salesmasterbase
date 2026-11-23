import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronDown, ChevronRight, Phone, Search } from "lucide-react";
import { EpikLogo } from "@/features/brand/epik-logo";
import { publicTokenMatches } from "@/lib/public-status";
import { firstParam } from "@/lib/query";
import { OPEN_STATUSES, pocKey, pocRows, searchOrders, TRACK_LABELS, TRACK_MEANING, TRACK_TONE, type TrackOrder } from "@/lib/sheets/smb-orders";
import { loadSmbOrders } from "@/lib/sheets/smb-source";

// The CD tracking page. A customer calls a CD: "where is my product?" The CD opens this link, taps their own name
// (or types the customer's name, phone or #PIK) and reads the status logistics set in the Sales Masterbase sheet.
// No login: the long link is the key (checked here and in the proxy). Read only, and no links to anything else.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "EPIK order tracking", robots: { index: false, follow: false } };

type Props = { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const DELIVERED_SHOWN = 40;

const istTime = (ms: number) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", day: "numeric", month: "short" }).format(new Date(ms));

export default async function TrackPage({ params, searchParams }: Props) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  if (!publicTokenMatches(token)) notFound();
  const base = `/track/${token}`;
  const poc = (firstParam(query.poc) ?? "").trim().slice(0, 80);
  const q = (firstParam(query.q) ?? "").trim().slice(0, 80);
  const all = firstParam(query.all) === "1";
  const load = await loadSmbOrders();

  if (!load.ok) {
    return (
      <Frame base={base}>
        <div className="s-card s-empty">
          <p className="font-semibold text-ink">{load.message}</p>
          <p className="mt-1">{load.reason === "failed" ? "Refresh in a minute." : "Ask Bhavya to connect it."}</p>
        </div>
      </Frame>
    );
  }

  const updated = `From the Sales Masterbase, ${istTime(load.at)}${load.stale ? " (couldn't refresh, showing the last copy)" : ""}`;
  if (poc) return <PersonScreen base={base} orders={load.orders} poc={poc} all={all} updated={updated} />;
  return <HomeScreen base={base} orders={load.orders} q={q} updated={updated} />;
}

function Frame({ children, base, updated }: { children: React.ReactNode; base: string; updated?: string }) {
  return (
    <main className="pub">
      <header className="pub-top">
        <Link href={base} aria-label="All names"><EpikLogo height={20} className="text-ink" /></Link>
        <span className="pub-updated">Order tracking</span>
      </header>
      {children}
      <p className="pub-foot">{updated ? `${updated}. ` : ""}Read only. If a status looks wrong, ask logistics to fix it in the sheet.</p>
    </main>
  );
}

function SearchBox({ base, q, poc }: { base: string; q?: string; poc?: string }) {
  return (
    <form action={base} method="get" className="pub-search" role="search">
      {poc ? <input type="hidden" name="poc" value={poc} /> : null}
      <label>
        <Search size={17} aria-hidden="true" />
        <input name="q" defaultValue={q} placeholder="Customer name, phone or #PIK" aria-label="Find an order" autoComplete="off" enterKeyHint="search" />
      </label>
      <button type="submit">Find</button>
    </form>
  );
}

// ── Home: find by customer, or tap your name ─────────────────────────────────

function HomeScreen({ base, orders, q, updated }: { base: string; orders: TrackOrder[]; q: string; updated: string }) {
  const people = pocRows(orders);
  const found = q ? searchOrders(orders, q) : [];
  return (
    <Frame base={base} updated={updated}>
      <div className="pub-head">
        <h1>Where is my product?</h1>
        <p>Type the customer&apos;s name, phone or #PIK. Or tap your name to see all your orders.</p>
      </div>
      <SearchBox base={base} q={q} />
      {q ? (
        <section className="pub-section" aria-label="Search results">
          <h2>{found.length ? `${found.length} found` : "Nothing found"} <span>for “{q}”</span></h2>
          {found.length ? <OrderList orders={found.slice(0, 60)} showPoc /> : <p className="s-card s-empty">Check the spelling, or try the last 4 digits of the phone.</p>}
          <Link href={base} className="pub-back"><ArrowLeft size={15} /> All names</Link>
        </section>
      ) : (
        <section className="pub-section" aria-label="Names">
          <h2>Names <span>{people.length}</span></h2>
          {people.length ? (
            <ul className="s-card pub-rows">
              {people.map((p) => (
                <li key={p.key}>
                  <Link href={`${base}?poc=${encodeURIComponent(p.name)}`} className="pub-row">
                    <span className="min-w-0">
                      <span className="pub-row-title"><strong>{p.name}</strong></span>
                      <span className="pub-row-sub">{p.open ? `${p.open} not delivered` : "All delivered"} · {p.total} order{p.total === 1 ? "" : "s"}</span>
                    </span>
                    <span className="pub-row-side">
                      {p.open ? <span className="badge tone-warn">{p.open} open</span> : null}
                      <ChevronRight size={16} className="text-faint" aria-hidden="true" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="s-card s-empty">No names in the POC column yet.</p>
          )}
        </section>
      )}
    </Frame>
  );
}

// ── One CD's orders ──────────────────────────────────────────────────────────

function PersonScreen({ base, orders, poc, all, updated }: { base: string; orders: TrackOrder[]; poc: string; all: boolean; updated: string }) {
  const mine = orders.filter((o) => pocKey(o.poc) === pocKey(poc));
  const name = mine[0]?.poc ?? poc;
  const open = mine.filter((o) => OPEN_STATUSES.includes(o.status));
  const delivered = mine.filter((o) => o.status === "delivered");
  const cancelled = mine.filter((o) => o.status === "cancelled");
  const deliveredShown = all ? delivered : delivered.slice(0, DELIVERED_SHOWN);
  const personLink = `${base}?poc=${encodeURIComponent(name)}`;
  return (
    <Frame base={base} updated={updated}>
      <Link href={base} className="pub-back"><ArrowLeft size={15} /> All names</Link>
      <div className="pub-head">
        <h1>{name}</h1>
        <p>{mine.length ? "Newest first. Tap an order for the phone, dates and driver." : "No orders under this name in the Sales Masterbase."}</p>
      </div>
      {mine.length ? (
        <>
          <dl className="pub-stats is-3">
            <div><dt>Not delivered</dt><dd>{open.length}</dd></div>
            <div><dt>Delivered</dt><dd>{delivered.length}</dd></div>
            <div><dt>Cancelled</dt><dd>{cancelled.length}</dd></div>
          </dl>
          <SearchBox base={base} />
          {open.length ? (
            <section className="pub-section" aria-label="Not delivered yet">
              <h2>Not delivered yet <span>{open.length}</span></h2>
              <OrderList orders={open} />
            </section>
          ) : null}
          {delivered.length ? (
            <section className="pub-section" aria-label="Delivered">
              <h2>Delivered <span>{delivered.length}</span></h2>
              <OrderList orders={deliveredShown} />
              {deliveredShown.length < delivered.length ? <Link href={`${personLink}&all=1`} className="pub-back">Show all {delivered.length} delivered</Link> : null}
            </section>
          ) : null}
          {cancelled.length ? (
            <section className="pub-section" aria-label="Cancelled">
              <h2>Cancelled <span>{cancelled.length}</span></h2>
              <OrderList orders={cancelled} />
            </section>
          ) : null}
        </>
      ) : null}
    </Frame>
  );
}

// ── Orders: tap to open the details ──────────────────────────────────────────

function OrderList({ orders, showPoc = false }: { orders: TrackOrder[]; showPoc?: boolean }) {
  return (
    <ul className="s-card pub-rows">
      {orders.map((o) => (
        <li key={`${o.key}:${o.row}`}>
          <OrderRow order={o} showPoc={showPoc} />
        </li>
      ))}
    </ul>
  );
}

function OrderRow({ order: o, showPoc }: { order: TrackOrder; showPoc: boolean }) {
  const products = o.products.map((p) => `${p.name}${p.qty && p.qty !== "1" ? ` ×${p.qty}` : ""}`).join(", ") || "Product not filled in";
  const facts: Array<[string, string | null]> = [
    ["Status in the sheet", o.statusText || "Empty"],
    ["Sold on", o.date],
    ["Expected", o.expected],
    ["Dispatched on", o.dispatchedOn],
    ["Driver", o.driver],
    ["Delivered on", o.deliveredOn],
    ["Payment", o.paymentStatus],
    ["Hub", o.hub],
    ...(showPoc ? ([["POC", o.poc]] as Array<[string, string | null]>) : []),
    ["Address", o.address],
    ["Notes", o.notes],
  ];
  return (
    <details className="track-order">
      <summary className="pub-row">
        <span className="min-w-0">
          <span className="pub-row-title">
            <strong>{o.customer}</strong>
            {o.shopify ? <span>{o.shopify}</span> : null}
          </span>
          <span className="pub-row-sub">{products}</span>
          <span className="pub-row-sub">{[o.date ? `Sold ${o.date}` : null, showPoc && o.poc ? o.poc : null].filter(Boolean).join(" · ")}</span>
        </span>
        <span className="pub-row-side">
          <span className={`badge ${TRACK_TONE[o.status]}`}>{o.status === "other" ? o.statusText.slice(0, 24) : TRACK_LABELS[o.status]}</span>
          <ChevronDown size={16} className="text-faint track-chevron" aria-hidden="true" />
        </span>
      </summary>
      <div className="track-detail">
        <p className="track-say">{TRACK_MEANING[o.status]}</p>
        {o.phone ? (
          <a href={`tel:${o.phone.replace(/[^\d+]/g, "")}`} className="track-call"><Phone size={15} aria-hidden="true" /> Call {o.phone}</a>
        ) : null}
        <dl className="track-facts">
          {facts.filter(([, v]) => v).map(([label, value]) => (
            <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
          ))}
        </dl>
      </div>
    </details>
  );
}

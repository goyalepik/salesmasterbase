import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, Phone } from "lucide-react";
import { NameFinder, OrderFinder } from "@/components/track/track-finders";
import { EpikLogo } from "@/features/brand/epik-logo";
import { publicTokenMatches } from "@/lib/public-status";
import { firstParam } from "@/lib/query";
import { isOpen, pocKey, pocRows, TRACK_LABELS, TRACK_MEANING, TRACK_TONE, WEBSITE_POC, type TrackOrder } from "@/lib/sheets/smb-orders";
import { loadSmbOrders } from "@/lib/sheets/smb-source";

// The CD tracking page. A customer calls a CD: "where is my product?" The CD opens this link, types the start of
// their name, taps it, taps the order, and reads the status logistics keeps in the Sales Masterbase.
// No login: the long link is the key (checked here and in the proxy). Read only, and no links to anything else.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "EPIK order tracking", robots: { index: false, follow: false } };

type Props = { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const istTime = (ms: number) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", day: "numeric", month: "short" }).format(new Date(ms));

export default async function TrackPage({ params, searchParams }: Props) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  if (!publicTokenMatches(token)) notFound();
  const base = `/track/${token}`;
  const poc = (firstParam(query.poc) ?? "").trim().slice(0, 80);
  const orderId = (firstParam(query.order) ?? "").trim().slice(0, 40);
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

  const updated = `Updated ${istTime(load.at)}${load.stale ? " (couldn't refresh, showing the last copy)" : ""}`;
  if (orderId) return <OrderScreen base={base} orders={load.orders} id={orderId} poc={poc} updated={updated} />;
  if (poc) return <PersonScreen base={base} orders={load.orders} poc={poc} updated={updated} />;
  const website = load.orders.filter((o) => pocKey(o.poc) === WEBSITE_POC).length;
  return (
    <Frame base={base} updated={updated}>
      <div className="pub-head">
        <h1>Where is my order?</h1>
        <p>Find your name, then tap the customer&apos;s order.</p>
      </div>
      <NameFinder people={pocRows(load.orders)} base={base} website={website} />
    </Frame>
  );
}

function Frame({ children, base, updated }: { children: React.ReactNode; base: string; updated?: string }) {
  return (
    <main className="pub track">
      <header className="pub-top">
        <Link href={base} aria-label="All names"><EpikLogo height={20} className="text-ink" /></Link>
        {updated ? <span className="pub-updated">{updated}</span> : null}
      </header>
      {children}
      <p className="pub-foot">Read only, from the Sales Masterbase. If something looks wrong, ask logistics.</p>
    </main>
  );
}

// ── One CD's orders ──────────────────────────────────────────────────────────

function PersonScreen({ base, orders, poc, updated }: { base: string; orders: TrackOrder[]; poc: string; updated: string }) {
  const mine = orders.filter((o) => pocKey(o.poc) === pocKey(poc));
  const website = pocKey(poc) === WEBSITE_POC;
  const name = website ? "Website orders" : (mine[0]?.poc ?? poc);
  const open = mine.filter((o) => isOpen(o.status)).length;
  return (
    <Frame base={base} updated={updated}>
      <Link href={base} className="pub-back"><ArrowLeft size={15} /> All names</Link>
      <div className="pub-head">
        <h1>{name}</h1>
        <p>{mine.length ? `${mine.length} order${mine.length === 1 ? "" : "s"}, ${open} not delivered yet. Tap one to see where it is.` : "No orders under this name in the Sales Masterbase."}</p>
      </div>
      {mine.length ? <OrderFinder orders={mine} base={base} poc={mine[0]?.poc ?? poc} /> : null}
    </Frame>
  );
}

// ── One order ────────────────────────────────────────────────────────────────

function OrderScreen({ base, orders, id, poc, updated }: { base: string; orders: TrackOrder[]; id: string; poc: string; updated: string }) {
  const o = orders.find((x) => x.id === id);
  const back = poc ? `${base}?poc=${encodeURIComponent(poc)}` : base;
  const backLabel = poc ? (pocKey(poc) === WEBSITE_POC ? "Website orders" : poc) : "All names";
  if (!o) {
    return (
      <Frame base={base} updated={updated}>
        <Link href={back} className="pub-back"><ArrowLeft size={15} /> {backLabel}</Link>
        <p className="s-card s-empty">This order isn&apos;t in the Sales Masterbase any more. Go back and open it again.</p>
      </Frame>
    );
  }
  const facts = (rows: Array<[string, string | null]>) => {
    const filled = rows.filter(([, v]) => v);
    return filled.length ? (
      <dl className="track-facts">
        {filled.map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
        ))}
      </dl>
    ) : null;
  };
  return (
    <Frame base={base} updated={updated}>
      <Link href={back} className="pub-back"><ArrowLeft size={15} /> {backLabel}</Link>
      <div className="pub-head">
        <h1>{o.customer}</h1>
        <p>{[o.shopify, o.date ? `Sold ${o.date}` : null].filter(Boolean).join(" · ")}</p>
      </div>

      <section className={`s-card track-status ${TRACK_TONE[o.status]}`} aria-label="Status">
        <span className="track-status-label">{o.status === "other" ? o.logisticStatus : TRACK_LABELS[o.status]}</span>
        <p className="track-say">{TRACK_MEANING[o.status]}</p>
        {facts([
          ["Logistic status", o.logisticStatus || null],
          ["Delivery status", o.deliveryStatus || null],
          ["Dispatched on", o.dispatchedOn],
          ["Delivered on", o.deliveredOn],
        ])}
      </section>

      {o.update ? (
        <section className="s-card track-block" aria-label="Latest update">
          <h2>Latest update{o.updateBy ? ` from ${o.updateBy}` : ""}</h2>
          <p className="track-update">{o.update}</p>
        </section>
      ) : null}

      <section className="s-card track-block" aria-label="Product">
        <h2>Product</h2>
        {o.products.length ? (
          <ul className="track-products">
            {o.products.map((p, i) => (
              <li key={i}>
                <strong>{p.name}</strong>
                {p.serial ? <span>Serial {p.serial}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">Not filled in.</p>
        )}
      </section>

      <section className="s-card track-block" aria-label="Customer">
        <h2>Customer</h2>
        {o.phone ? (
          <a href={`tel:${o.phone.replace(/[^\d+]/g, "")}`} className="track-call"><Phone size={16} aria-hidden="true" /> Call {o.phone}</a>
        ) : null}
        {o.address ? <p className="track-address"><MapPin size={15} aria-hidden="true" /> {o.address}</p> : null}
        {facts([
          ["City", o.city],
          ["Payment", o.paymentStatus],
          ["Hub", o.hub],
          ["Sold by", o.poc],
        ])}
      </section>
    </Frame>
  );
}

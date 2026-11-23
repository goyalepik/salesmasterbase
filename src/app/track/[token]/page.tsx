import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, Phone, Sparkles } from "lucide-react";
import { NameFinder, OrderFinder } from "@/components/track/track-finders";
import { StatusDonut } from "@/components/track/status-donut";
import { EpikLogo } from "@/features/brand/epik-logo";
import { customerLine } from "@/lib/ai/track-ai";
import { statusFrom } from "@/lib/ops/delivery-status";
import { shortDate } from "@/lib/ops-ui/format";
import { publicTokenMatches } from "@/lib/public-status";
import { firstParam } from "@/lib/query";
import { isOpen, personKey, pocRows, stageCounts, TRACK_LABELS, TRACK_MEANING, TRACK_TONE, WEBSITE_POC, type TrackOrder } from "@/lib/sheets/smb-orders";
import { followSmb, loadTrackData } from "@/lib/sheets/track-data";

// The CD tracking page. A customer calls a CD: "where is my order?" The CD opens this link, types the start of their
// name, taps it, taps the order, and reads the live status. Orders come from the app (Shopify and Slack) and the Sales
// Masterbase; the status is the one logistics keeps in the Sales Masterbase.
// No login: the long link is the key (checked here and in the proxy). Read only, and no links to anything else.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "EPIK order tracking", robots: { index: false, follow: false } };

type Props = { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const istTime = (ms: number) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", day: "numeric", month: "short" }).format(new Date(ms));

export default async function TrackPage({ params, searchParams }: Props) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  if (!publicTokenMatches(token)) notFound();
  after(() => followSmb());
  const base = `/track/${token}`;
  const poc = (firstParam(query.poc) ?? "").trim().slice(0, 80);
  const orderId = (firstParam(query.order) ?? "").trim().slice(0, 40);
  const data = await loadTrackData();
  const note = data.smb.ok
    ? `Updated ${istTime(data.at)}${data.smb.stale ? " (couldn't refresh, last copy)" : ""}`
    : "Showing app status only";

  if (!data.orders.length) {
    return (
      <Frame base={base}>
        <div className="s-card s-empty">
          <p className="font-semibold text-ink">{data.smb.ok ? "No orders yet." : data.smb.message}</p>
          <p className="mt-1">Refresh in a minute. If it stays like this, ask Bhavya.</p>
        </div>
      </Frame>
    );
  }
  if (orderId) return <OrderScreen base={base} data={data.orders} id={orderId} poc={poc} note={note} />;
  if (poc) return <PersonScreen base={base} orders={data.orders} aliases={data.aliases} poc={poc} note={note} />;

  const people = pocRows(data.orders, data.aliases);
  const website = data.orders.filter((o) => personKey(o.poc) === WEBSITE_POC).length;
  const open = data.orders.filter((o) => isOpen(o.status)).length;
  return (
    <Frame base={base} note={note}>
      <div className="pub-head">
        <h1>Where is my order?</h1>
        <p>Find your name, then tap the customer&apos;s order.</p>
      </div>
      <section className="s-card track-hero" aria-label="All orders">
        <StatusDonut counts={stageCounts(data.orders)} centre={open} centreLabel="not delivered" />
        <p className="track-hero-note">{data.orders.length} orders since {shortDate(statusFrom())}, from every CD and the website.</p>
      </section>
      <NameFinder people={people} base={base} website={website} />
    </Frame>
  );
}

function Frame({ children, base, note }: { children: React.ReactNode; base: string; note?: string }) {
  return (
    <main className="pub track">
      <header className="pub-top">
        <Link href={base} aria-label="All names"><EpikLogo height={20} className="text-ink" /></Link>
        {note ? <span className="pub-updated">{note}</span> : null}
      </header>
      {children}
      <p className="pub-foot">Read only. Status from the Sales Masterbase. If something looks wrong, ask logistics.</p>
    </main>
  );
}

// ── One CD's orders ──────────────────────────────────────────────────────────

function PersonScreen({ base, orders, aliases, poc, note }: { base: string; orders: TrackOrder[]; aliases: Record<string, string>; poc: string; note: string }) {
  const key = personKey(poc, aliases);
  const website = key === WEBSITE_POC;
  const mine = orders.filter((o) => personKey(o.poc, aliases) === key);
  const name = website ? "Website orders" : (pocRows(mine, aliases)[0]?.name ?? poc);
  const open = mine.filter((o) => isOpen(o.status)).length;
  return (
    <Frame base={base} note={note}>
      <Link href={base} className="pub-back"><ArrowLeft size={15} /> All names</Link>
      <div className="pub-head">
        <h1>{name}</h1>
        <p>{mine.length ? `${mine.length} order${mine.length === 1 ? "" : "s"}. Tap one to see where it is.` : "No orders under this name."}</p>
      </div>
      {mine.length ? (
        <>
          <section className="s-card track-hero is-small" aria-label="Your orders">
            <StatusDonut counts={stageCounts(mine)} centre={open} centreLabel="not delivered" size={112} />
          </section>
          <OrderFinder orders={mine} base={base} poc={name === "Website orders" ? "Shopify direct" : name} />
        </>
      ) : null}
    </Frame>
  );
}

// ── One order ────────────────────────────────────────────────────────────────

async function OrderScreen({ base, data, id, poc, note }: { base: string; data: TrackOrder[]; id: string; poc: string; note: string }) {
  const o = data.find((x) => x.id === id);
  const back = poc ? `${base}?poc=${encodeURIComponent(poc)}` : base;
  const backLabel = poc ? (personKey(poc) === WEBSITE_POC ? "Website orders" : poc) : "All names";
  if (!o) {
    return (
      <Frame base={base} note={note}>
        <Link href={back} className="pub-back"><ArrowLeft size={15} /> {backLabel}</Link>
        <p className="s-card s-empty">This order isn&apos;t in the list any more. Go back and open it again.</p>
      </Frame>
    );
  }
  const say = await customerLine(o);
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
    <Frame base={base} note={note}>
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
        {o.source === "app" ? <p className="track-small">Not in the Sales Masterbase yet. This is the app&apos;s status.</p> : null}
      </section>

      {say || o.update ? (
        <section className="s-card track-block" aria-label="Latest update">
          <h2>Latest update{o.updateBy ? ` from ${o.updateBy}` : ""}</h2>
          {say ? (
            <p className="track-ai"><Sparkles size={15} aria-hidden="true" /><span><b>Tell the customer:</b> {say}</span></p>
          ) : null}
          {o.update ? <p className="track-update">{o.update}</p> : null}
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

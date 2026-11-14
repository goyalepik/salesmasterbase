import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronRight, Search } from "lucide-react";
import { OrderCardView } from "@/components/ops/order-card-view";
import { EpikLogo } from "@/features/brand/epik-logo";
import { getOpsStore } from "@/lib/ops";
import { DELIVERY_LABELS, deliveryStatusOf, statusFromIso } from "@/lib/ops/delivery-status";
import type { OpsStore } from "@/lib/ops/store";
import type { OrderSummary } from "@/lib/ops/types";
import { boardOrders, countByStatus, DELIVERY_TONE, DONE_DAYS, inView, matchesSearch, readView, recentEnough, sortForBoard, type BoardView } from "@/lib/ops-ui/delivery-board";
import { requestNow, shortDate, shortWhen } from "@/lib/ops-ui/format";
import { cdeRows, monthLabel, monthStartIso, pocKey, PROGRESS, progressOf, type CdeRow, type Tally } from "@/lib/ops-ui/team-board";
import { publicTokenMatches } from "@/lib/public-status";
import { firstParam } from "@/lib/query";

// The salespeople's order status page. No login: the long link is the key (checked here and in the proxy).
// Read only: nothing on this page changes an order. Team (chart + names) → one person's orders → one order's card.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "EPIK order status", robots: { index: false, follow: false } };

type Props = { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const CHIPS: Array<{ view: BoardView; label: string }> = [
  { view: "open", label: "Not delivered" },
  { view: "new", label: "New sale" },
  { view: "waiting_stock", label: "Waiting for stock" },
  { view: "ready", label: "Ready" },
  { view: "out_for_delivery", label: "Out for delivery" },
  { view: "delivered", label: "Delivered" },
  { view: "on_hold", label: "On hold" },
  { view: "cancelled", label: "Cancelled" },
  { view: "all", label: "All" },
];

type Links = {
  team: string;
  orders: (view?: BoardView, q?: string) => string;
  person: (name: string) => string;
  order: (id: string, from: string) => string;
};

function linksFor(base: string): Links {
  const withQuery = (params: Record<string, string | undefined>) => {
    const qs = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
    return qs ? `${base}?${qs}` : base;
  };
  return {
    team: base,
    orders: (view, q) => withQuery({ tab: "orders", view: view && view !== "open" ? view : undefined, q: q || undefined }),
    person: (name) => withQuery({ poc: name }),
    order: (id, from) => withQuery({ order: id, from }),
  };
}

async function loadOrders(store: OpsStore | null): Promise<OrderSummary[] | null> {
  if (!store) return null;
  try {
    const from = statusFromIso();
    const { items } = await store.listOrders({ stage: "all", from, limit: 5000 });
    return boardOrders(items, from);
  } catch {
    return null;
  }
}

export default async function PublicStatusPage({ params, searchParams }: Props) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  if (!publicTokenMatches(token)) notFound();
  const store = await getOpsStore();
  const links = linksFor(`/status/${token}`);
  const now = requestNow();
  const orderId = (firstParam(query.order) ?? "").trim().slice(0, 40);
  const poc = (firstParam(query.poc) ?? "").trim().slice(0, 60);
  const rawView = firstParam(query.view);
  const q = (firstParam(query.q) ?? "").slice(0, 80);
  const everyone = await loadOrders(store);

  if (orderId) return <OrderScreen store={store} everyone={everyone} id={orderId} from={firstParam(query.from) ?? ""} links={links} />;
  if (poc) return <PersonScreen everyone={everyone} poc={poc} links={links} now={now} />;
  // Older links: "?view=new" etc. opened the order list; the plain link and "?view=people" open the team.
  const ordersTab = firstParam(query.tab) === "orders" || !!q || (!!rawView && rawView !== "people");
  if (ordersTab) return <OrdersScreen everyone={everyone} view={readView(rawView)} q={q} links={links} now={now} />;
  return <TeamScreen everyone={everyone} links={links} now={now} />;
}

// ── Frame ────────────────────────────────────────────────────────────────────

function Frame({ children, tab, links, now }: { children: React.ReactNode; tab?: "team" | "orders"; links: Links; now: number }) {
  return (
    <main className="pub">
      <header className="pub-top">
        <EpikLogo height={20} className="text-ink" />
        <span className="pub-updated">Updated {shortWhen(new Date(now).toISOString())}</span>
      </header>
      {tab ? (
        <nav className="pub-tabs" aria-label="View">
          <Link href={links.team} aria-current={tab === "team" ? "page" : undefined}>Team</Link>
          <Link href={links.orders()} aria-current={tab === "orders" ? "page" : undefined}>All orders</Link>
        </nav>
      ) : null}
      {children}
      <p className="pub-foot">Read only. If something looks wrong, ask logistics.</p>
    </main>
  );
}

function Failed() {
  return <p className="s-card s-empty">Couldn&apos;t load orders right now. Refresh in a minute.</p>;
}

function Stats({ items, three = false }: { items: Array<{ label: string; value: number; colour?: string }>; three?: boolean }) {
  return (
    <dl className={`pub-stats${three ? " is-3" : ""}`}>
      {items.map((item) => (
        <div key={item.label}>
          <dt>
            {item.colour ? <i style={{ background: item.colour }} aria-hidden="true" /> : null}
            {item.label}
          </dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ── Team: chart of orders per CDE this month, then the names ─────────────────

function TeamScreen({ everyone, links, now }: { everyone: OrderSummary[] | null; links: Links; now: number }) {
  const today = new Date(now);
  if (!everyone) {
    return (
      <Frame tab="team" links={links} now={now}>
        <Failed />
      </Frame>
    );
  }
  const { rows, month } = cdeRows(everyone, monthStartIso(today));
  const active = rows.filter((r) => r.month.total + r.month.cancelled > 0);
  const quiet = rows.filter((r) => r.month.total + r.month.cancelled === 0);
  const max = Math.max(1, ...active.map((r) => r.month.total));
  return (
    <Frame tab="team" links={links} now={now}>
      <div className="pub-head">
        <h1>Team orders</h1>
        <p>{monthLabel(today)}. Tap your name to see your orders and where each one is.</p>
      </div>
      <Stats
        items={[
          { label: "Sales", value: month.total },
          ...PROGRESS.map((p) => ({ label: p.label, value: month[p.id], colour: p.colour })),
        ]}
      />

      <section className="s-card pub-chart" aria-labelledby="cde-chart">
        <div className="pub-chart-head">
          <h2 id="cde-chart">Orders per CDE this month</h2>
          <ul className="pub-legend" aria-label="Colours">
            {PROGRESS.map((p) => (
              <li key={p.id}><i style={{ background: p.colour }} aria-hidden="true" />{p.label}</li>
            ))}
          </ul>
        </div>
        {active.length ? (
          <ul className="pub-cdes">
            {active.map((row) => (
              <li key={row.name}><CdeBar row={row} max={max} href={links.person(row.name)} /></li>
            ))}
          </ul>
        ) : (
          <p className="s-empty">No sales yet this month.</p>
        )}
      </section>

      {quiet.length ? (
        <section className="s-card pub-quiet" aria-labelledby="quiet">
          <h2 id="quiet">No sales this month</h2>
          <ul>
            {quiet.map((row) => (
              <li key={row.name}>
                <Link href={links.person(row.name)}>
                  <span className="truncate">{row.name}</span>
                  <span className="pub-quiet-meta">{row.open ? `${row.open} open` : `${row.allTime} earlier`}<ChevronRight size={15} aria-hidden="true" /></span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Frame>
  );
}

function tallyText(t: Tally): string {
  const parts = PROGRESS.filter((p) => t[p.id]).map((p) => `${t[p.id]} ${p.label.toLowerCase()}`);
  if (t.cancelled) parts.push(`${t.cancelled} cancelled`);
  return parts.join(" · ") || "Only cancelled orders";
}

function CdeBar({ row, max, href }: { row: CdeRow; max: number; href: string }) {
  const t = row.month;
  return (
    <Link href={href} className="pub-cde" aria-label={`${row.name}: ${t.total} orders this month. ${tallyText(t)}.`}>
      <span className="pub-cde-top">
        <span className="pub-cde-name">{row.name}</span>
        <span className="pub-cde-total">{t.total}<ChevronRight size={15} aria-hidden="true" /></span>
      </span>
      <span className="pub-bar" aria-hidden="true">
        <span className="pub-bar-fill" style={{ width: `${Math.max(t.total ? 6 : 0, (t.total / max) * 100)}%` }}>
          {PROGRESS.filter((p) => t[p.id]).map((p) => (
            <span key={p.id} title={`${t[p.id]} ${p.label.toLowerCase()}`} style={{ flexGrow: t[p.id], background: p.colour }} />
          ))}
        </span>
      </span>
      <span className="pub-cde-sub">{tallyText(t)}</span>
    </Link>
  );
}

// ── One salesperson's orders ─────────────────────────────────────────────────

function OrderRow({ order, href }: { order: OrderSummary; href: string }) {
  const status = deliveryStatusOf(order.stage);
  const products = order.lines.filter((l) => l.status !== "cancelled" && l.status !== "rejected");
  const expected = order.expectedDeliveryDate && status !== "delivered" && status !== "cancelled" ? `Expected ${shortDate(order.expectedDeliveryDate)}` : null;
  return (
    <li>
      <Link href={href} className="pub-row">
        <span className="min-w-0">
          <span className="pub-row-title">
            <strong>{order.customerName}</strong>
            <span>{order.shopifyOrderId ?? order.id}</span>
          </span>
          <span className="pub-row-sub">{(products.length ? products : order.lines).map((l) => `${l.productName}${l.qty > 1 ? ` ×${l.qty}` : ""}`).join(", ")}</span>
          <span className="pub-row-sub">Sold {shortDate(order.createdAt)}</span>
          {expected ? <span className="pub-row-sub"><b>{expected}</b></span> : null}
        </span>
        <span className="pub-row-side">
          <span className={`badge ${DELIVERY_TONE[status]}`}>{DELIVERY_LABELS[status]}</span>
          <ChevronRight size={16} className="text-faint" aria-hidden="true" />
        </span>
      </Link>
    </li>
  );
}

function PersonScreen({ everyone, poc, links, now }: { everyone: OrderSummary[] | null; poc: string; links: Links; now: number }) {
  if (!everyone) {
    return (
      <Frame links={links} now={now}>
        <Failed />
      </Frame>
    );
  }
  const mine = sortForBoard(everyone.filter((o) => pocKey(o.poc) === pocKey(poc)), "all");
  const name = mine[0]?.poc?.trim() || poc;
  const { month } = cdeRows(mine, monthStartIso(new Date(now)));
  const open = mine.filter((o) => {
    const p = progressOf(deliveryStatusOf(o.stage));
    return p === "waiting" || p === "moving";
  });
  const delivered = mine.filter((o) => deliveryStatusOf(o.stage) === "delivered");
  const cancelled = mine.filter((o) => deliveryStatusOf(o.stage) === "cancelled");
  const section = (title: string, list: OrderSummary[]) =>
    list.length ? (
      <section className="pub-section" aria-label={title}>
        <h2>{title} <span>{list.length}</span></h2>
        <ul className="s-card pub-rows">{list.map((o) => <OrderRow key={o.id} order={o} href={links.order(o.id, "poc")} />)}</ul>
      </section>
    ) : null;
  return (
    <Frame links={links} now={now}>
      <Link href={links.team} className="pub-back"><ArrowLeft size={15} /> Team</Link>
      <div className="pub-head">
        <h1>{name}</h1>
        <p>{mine.length ? `${mine.length} order${mine.length === 1 ? "" : "s"} since ${shortDate(statusFromIso())}. Tap one to see everything about it.` : "No orders under this name yet."}</p>
      </div>
      {mine.length ? (
        <>
          <Stats three items={[{ label: "This month", value: month.total }, { label: "Not delivered", value: open.length }, { label: "Delivered", value: delivered.length }]} />
          {section("Not delivered yet", open)}
          {section("Delivered", delivered)}
          {section("Cancelled", cancelled)}
        </>
      ) : null}
    </Frame>
  );
}

// ── One order: the full card, read only ──────────────────────────────────────

async function OrderScreen({ store, everyone, id, from, links }: { store: OpsStore | null; everyone: OrderSummary[] | null; id: string; from: string; links: Links }) {
  const now = requestNow();
  // Only orders this page lists (since the start day, no test orders) can be opened here.
  const listed = everyone?.find((o) => o.id === id);
  const order = listed && store ? await store.getOrder(id).catch(() => null) : null;
  const back = !order ? links.team : from === "orders" ? links.orders() : order.poc ? links.person(order.poc) : links.team;
  const backLabel = !order ? "Team" : from === "orders" ? "All orders" : order.poc?.trim() || "Team";
  return (
    <Frame links={links} now={now}>
      <Link href={back} className="pub-back"><ArrowLeft size={15} /> {backLabel}</Link>
      {order ? <OrderCardView order={order} forSalespeople /> : <p className="s-card s-empty">This order isn&apos;t on this page. Check the #PIK number with logistics.</p>}
    </Frame>
  );
}

// ── Every order, with search ─────────────────────────────────────────────────

function OrdersScreen({ everyone, view, q, links, now }: { everyone: OrderSummary[] | null; view: BoardView; q: string; links: Links; now: number }) {
  if (!everyone) {
    return (
      <Frame tab="orders" links={links} now={now}>
        <Failed />
      </Frame>
    );
  }
  const found = everyone.filter((o) => recentEnough(o, new Date(now)) && matchesSearch(o, q));
  const counts = countByStatus(found);
  const list = sortForBoard(found.filter((o) => inView(o, view)), view === "open" ? "all" : view).slice(0, 300);
  return (
    <Frame tab="orders" links={links} now={now}>
      <form action={links.team} className="pub-search" role="search">
        <input type="hidden" name="tab" value="orders" />
        {view !== "open" ? <input type="hidden" name="view" value={view} /> : null}
        <label>
          <Search size={16} aria-hidden="true" />
          <input name="q" defaultValue={q} inputMode="search" placeholder="#PIK, phone, customer or product" aria-label="Search orders" />
        </label>
        <button type="submit">Search</button>
      </form>
      {q ? (
        <p className="pub-hint">
          {found.length} match{found.length === 1 ? "" : "es"} for “{q}”. <Link href={links.orders(view)}>Clear</Link>
        </p>
      ) : null}
      <nav className="s-chips" aria-label="Status">
        {CHIPS.map((chip) => (
          <Link key={chip.view} href={links.orders(chip.view, q)} aria-current={view === chip.view ? "page" : undefined}>
            {chip.label} <span>{counts[chip.view]}</span>
          </Link>
        ))}
      </nav>
      {list.length ? (
        <ul className="s-card pub-rows">{list.map((o) => <OrderRow key={o.id} order={o} href={links.order(o.id, "orders")} />)}</ul>
      ) : (
        <p className="s-card s-empty">{q ? "No order matches. Try the last 4 digits of the phone, or the #PIK number." : "No orders here."}</p>
      )}
      <p className="pub-hint">Delivered and cancelled orders stay in this list for {DONE_DAYS} days. Your own older orders are under your name on Team.</p>
    </Frame>
  );
}

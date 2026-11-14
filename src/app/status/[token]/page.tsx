import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Phone, Search } from "lucide-react";
import { getOpsStore } from "@/lib/ops";
import { DELIVERY_LABELS, DELIVERY_MEANING, deliveryStatusOf, statusChangedAt, statusFromIso } from "@/lib/ops/delivery-status";
import type { OrderSummary } from "@/lib/ops/types";
import { boardOrders, countByStatus, DELIVERY_TONE, DONE_DAYS, inView, matchesSearch, readView, recentEnough, sortForBoard, type BoardView } from "@/lib/ops-ui/delivery-board";
import { age, inr, requestNow, shortDate, shortWhen } from "@/lib/ops-ui/format";
import { publicTokenMatches } from "@/lib/public-status";
import { firstParam } from "@/lib/query";

// The salespeople's order status page. No login: the long link is the key (checked here and in the proxy).
// Read only: nothing on this page changes an order.

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

export default async function PublicStatusPage({ params, searchParams }: Props) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  if (!publicTokenMatches(token)) notFound();
  const store = await getOpsStore();
  const view = readView(firstParam(query.view));
  const q = (firstParam(query.q) ?? "").slice(0, 80);
  const base = `/status/${token}`;
  const now = requestNow();

  let orders: OrderSummary[] = [];
  let failed = false;
  if (store) {
    try {
      const from = statusFromIso();
      const { items } = await store.listOrders({ stage: "all", from, limit: 5000 });
      orders = boardOrders(items, from).filter((o) => recentEnough(o, new Date(now)));
    } catch {
      failed = true;
    }
  } else failed = true;

  const found = orders.filter((o) => matchesSearch(o, q));
  const counts = countByStatus(found);
  const list = sortForBoard(found.filter((o) => inView(o, view)), view === "open" ? "all" : view).slice(0, 300);
  const href = (v: BoardView) => {
    const qs = new URLSearchParams({ ...(v !== "open" ? { view: v } : {}), ...(q ? { q } : {}) }).toString();
    return qs ? `${base}?${qs}` : base;
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6">
      <header className="mb-4">
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-faint">EPIK</p>
        <h1 className="mt-1 text-[24px] font-semibold tracking-[-0.02em] text-ink">Order status</h1>
        <p className="mt-1 text-[13px] text-muted">
          Where every order is, as logistics last set it. Updated {shortWhen(new Date(now).toISOString())}. Pull down or refresh for the latest.
        </p>
      </header>

      <form action={base} className="mb-3 flex gap-2">
        {view !== "open" ? <input type="hidden" name="view" value={view} /> : null}
        <label className="field flex h-12 min-w-0 flex-1 items-center gap-2 px-3">
          <Search size={16} className="shrink-0 text-faint" aria-hidden="true" />
          <input name="q" defaultValue={q} inputMode="search" placeholder="#PIK, phone, customer or product" className="min-w-0 flex-1 bg-transparent text-[15px] outline-none" aria-label="Search orders" />
        </label>
        <button type="submit" className="glow-button h-12 shrink-0 rounded-[14px] px-4 text-[14px] font-medium text-white">Search</button>
      </form>
      {q ? (
        <p className="mb-2 text-[12px] text-muted">
          {found.length} match{found.length === 1 ? "" : "es"} for “{q}”. <Link href={href(view)} className="text-info">Clear search</Link>
        </p>
      ) : null}

      <nav className="mb-4 flex gap-1.5 overflow-x-auto pb-1" aria-label="Status">
        {CHIPS.map((chip) => (
          <Link
            key={chip.view}
            href={href(chip.view)}
            aria-current={view === chip.view ? "page" : undefined}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-[12px] font-medium ${view === chip.view ? "border-[rgba(120,170,255,0.6)] bg-[rgba(80,130,255,0.18)] text-ink" : "border-line text-muted"}`}
          >
            {chip.label} <span className="ml-0.5 text-faint">{counts[chip.view]}</span>
          </Link>
        ))}
      </nav>

      {failed ? (
        <p className="dashboard-panel text-[14px] text-muted">Couldn&apos;t load orders right now. Refresh in a minute.</p>
      ) : !list.length ? (
        <p className="dashboard-panel text-[14px] text-muted">{q ? "No order matches. Try the last 4 digits of the phone, or the #PIK number." : "No orders here."}</p>
      ) : (
        <ul className="grid gap-2.5">
          {list.map((order) => (
            <OrderCard key={order.id} order={order} now={now} />
          ))}
        </ul>
      )}

      <p className="mt-6 text-[12px] text-faint">Delivered and cancelled orders stay here for {DONE_DAYS} days. If something looks wrong, ask logistics.</p>
    </main>
  );
}

function when(iso: string, now: number): string {
  const a = age(iso, now);
  return a === "just now" ? "just now" : `${a} ago`;
}

function OrderCard({ order, now }: { order: OrderSummary; now: number }) {
  const status = deliveryStatusOf(order.stage);
  const products = order.lines.filter((l) => l.status !== "cancelled" && l.status !== "rejected");
  const reason = status === "on_hold" ? order.holdReason : status === "cancelled" ? order.cancelReason : null;
  return (
    <li className="dashboard-panel !mb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[16px] font-semibold text-ink">{order.shopifyOrderId ?? order.id}</p>
          <p className="text-[12px] text-faint">Sold {shortDate(order.createdAt)}{order.poc ? ` by ${order.poc}` : ""}{order.hub ? `, ${order.hub}` : ""}</p>
        </div>
        <span className={`badge ${DELIVERY_TONE[status]}`}>{DELIVERY_LABELS[status]}</span>
      </div>

      <p className="mt-2 text-[14px] text-ink">{DELIVERY_MEANING[status]}{reason ? ` ${reason}` : ""}</p>
      {order.expectedDeliveryDate && status !== "delivered" && status !== "cancelled" ? (
        <p className="mt-1 text-[14px] font-medium text-info">Expected {shortDate(order.expectedDeliveryDate)}</p>
      ) : null}
      {status === "delivered" && order.deliveredAt ? <p className="mt-1 text-[13px] text-good">Delivered {shortDate(order.deliveredAt)}</p> : null}

      <dl className="mt-3 grid gap-1.5 text-[13px] sm:grid-cols-[110px_minmax(0,1fr)]">
        <dt className="text-faint">Customer</dt>
        <dd className="text-ink">
          {order.customerName}
          {order.phone ? (
            <a href={`tel:${order.phone}`} className="ml-2 inline-flex items-center gap-1 text-info">
              <Phone size={13} aria-hidden="true" /> {order.phone}
            </a>
          ) : null}
        </dd>
        <dt className="text-faint">Product</dt>
        <dd className="text-ink">{(products.length ? products : order.lines).map((l) => `${l.productName}${l.qty > 1 ? ` ×${l.qty}` : ""}`).join(", ")}</dd>
        {order.shippingAddress ? (
          <>
            <dt className="text-faint">Address</dt>
            <dd className="text-muted">{[order.shippingAddress, order.pincode].filter(Boolean).join(", ")}</dd>
          </>
        ) : null}
        <dt className="text-faint">Amount</dt>
        <dd className="text-muted">{[inr(order.offeredTotalMinor), order.declaredPaymentStatus].filter(Boolean).join(" · ")}</dd>
        {order.driver && (status === "out_for_delivery" || status === "delivered") ? (
          <>
            <dt className="text-faint">Driver</dt>
            <dd className="text-muted">{order.driver}</dd>
          </>
        ) : null}
      </dl>
      <p className="mt-2 text-[11px] text-faint">Status changed {when(statusChangedAt(order), now)}</p>
    </li>
  );
}

import { Suspense } from "react";
import Link from "next/link";
import { after } from "next/server";
import { ExternalLink } from "lucide-react";
import { sweepSalesSheetAction } from "@/app/actions/ops";
import { BlockedState } from "@/components/blocked-state";
import { ActionForm, SubmitButton } from "@/components/ops/action-form";
import { inputClass, Panel } from "@/components/ops/bits";
import { CopyLink } from "@/components/ops/copy-link";
import { DeliveryStatusForm } from "@/components/ops/delivery-status-form";
import { SectionSkeleton } from "@/components/ops/overview";
import { PageHeader } from "@/components/ui";
import { DELIVERY_LABELS, DELIVERY_STATUSES, deliveryStatusOf, statusChangedAt, statusFrom, statusFromIso } from "@/lib/ops/delivery-status";
import type { OpsStore } from "@/lib/ops/store";
import type { OrderSummary } from "@/lib/ops/types";
import { boardOrders, countByStatus, DELIVERY_TONE, inView, matchesSearch, readView, sortForBoard, type BoardView } from "@/lib/ops-ui/delivery-board";
import { isAdmin } from "@/lib/ops-ui/actor";
import { age, inr, requestNow, shortDate, shortWhen } from "@/lib/ops-ui/format";
import { loadOps } from "@/lib/ops-ui/load";
import { publicStatusPath } from "@/lib/public-status";
import { firstParam } from "@/lib/query";
import { salesSheetStatus, sweepSalesSheet } from "@/lib/sheets/sales-sheet-run";

export const metadata = { title: "Order status · EPIK" };

export default async function LogisticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [ops, params] = await Promise.all([loadOps(), searchParams]);
  if (ops.kind !== "ready") return <BlockedState health={ops.workspace.health} />;
  const view = readView(firstParam(params.view));
  const q = (firstParam(params.q) ?? "").slice(0, 80);
  // Visiting the page also tops up the sales sheet (at most every 2 minutes).
  after(() => sweepSalesSheet(ops.store));
  return (
    <section>
      <PageHeader
        title="Order status"
        description={`Every sale since ${shortDate(statusFrom())}. Set where each order is. Salespeople see it at once on their status page, and the sales sheet updates by itself.`}
      />
      <Suspense fallback={<SectionSkeleton height={90} />}>
        <LinksStrip store={ops.store} />
      </Suspense>
      <Suspense key={`${view}:${q}`} fallback={<SectionSkeleton height={520} />}>
        <Board store={ops.store} view={view} q={q} />
      </Suspense>
    </section>
  );
}

async function LinksStrip({ store }: { store: OpsStore }) {
  const [sheet, admin] = await Promise.all([salesSheetStatus(store), isAdmin()]);
  const link = publicStatusPath();
  return (
    <div className="mb-3 grid gap-2.5 lg:grid-cols-2">
      <Panel title="Salespeople's status page" subtitle="No login. Anyone with this link can see these orders, so share it only with the team.">
        {link ? (
          <div className="flex flex-wrap gap-2">
            <CopyLink path={link} label="Copy link for salespeople" />
            <a href={link} target="_blank" rel="noreferrer" className="btn-quiet inline-flex h-10 items-center gap-2 rounded-[12px] px-3.5 text-[13px] font-medium">
              <ExternalLink size={15} /> Open
            </a>
          </div>
        ) : (
          <p className="text-[13px] text-muted">Set DASHBOARD_ACCESS_CODE or PUBLIC_STATUS_TOKEN first.</p>
        )}
      </Panel>
      <Panel
        title="Sales sheet"
        subtitle={sheet.on ? (sheet.lastError ? `Last write failed: ${sheet.lastError.message}` : sheet.lastOkAt ? `Connected. Last write ${shortWhen(sheet.lastOkAt)}.` : "Connected. Nothing written yet.") : "Not connected yet. Sales are safe on the dashboard; they go to the sheet once it is connected."}
        aside={sheet.sheetUrl ? <a href={sheet.sheetUrl} target="_blank" rel="noreferrer" className="text-[13px] text-info">Open sheet</a> : null}
      >
        {sheet.on ? (
          admin ? (
            <ActionForm action={sweepSalesSheetAction}>
              <SubmitButton small tone="quiet">Write all orders to the sheet now</SubmitButton>
            </ActionForm>
          ) : null
        ) : (
          <p className="text-[12px] text-faint">
            To connect: add the script in docs/sales-sheet-apps-script.gs to the sheet (Extensions, Apps Script), deploy it as a web app, and put its link in Vercel as {sheet.needs.join(" and ")}.
          </p>
        )}
      </Panel>
    </div>
  );
}

const TABS: Array<{ view: BoardView; label: string }> = [
  { view: "open", label: "To do" },
  ...DELIVERY_STATUSES.map((s) => ({ view: s as BoardView, label: DELIVERY_LABELS[s] })),
  { view: "all", label: "All" },
];

async function Board({ store, view, q }: { store: OpsStore; view: BoardView; q: string }) {
  const { items } = await store.listOrders({ stage: "all", from: statusFromIso(), limit: 5000 });
  const all = boardOrders(items, statusFromIso()).filter((o) => matchesSearch(o, q));
  const counts = countByStatus(all);
  const list = sortForBoard(all.filter((o) => inView(o, view)), view);
  const shown = list.slice(0, 200);
  const now = requestNow();
  const tabHref = (v: BoardView) => {
    const qs = new URLSearchParams({ ...(v !== "open" ? { view: v } : {}), ...(q ? { q } : {}) }).toString();
    return qs ? `/logistics?${qs}` : "/logistics";
  };
  return (
    <>
      <form action="/logistics" className="mb-3 flex gap-2">
        {view !== "open" ? <input type="hidden" name="view" value={view} /> : null}
        <input name="q" defaultValue={q} placeholder="Search #PIK, phone, customer, product, POC" className={`${inputClass} min-w-0 flex-1`} aria-label="Search orders" />
        <button type="submit" className="btn-quiet h-11 shrink-0 rounded-[12px] px-4 text-[13px] font-medium">Search</button>
      </form>
      <nav className="stage-tabs" aria-label="Status">
        {TABS.map((tab) => (
          <Link key={tab.view} href={tabHref(tab.view)} aria-current={view === tab.view ? "page" : undefined}>
            {tab.label} <span>{counts[tab.view]}</span>
          </Link>
        ))}
      </nav>
      {!shown.length ? (
        <p className="panel-strong px-4 py-6 text-[13px] text-muted">
          {q ? "No order matches that search." : view === "open" ? "Nothing to do. New sales show up here as soon as they are posted." : "No orders here."}
        </p>
      ) : (
        <ul className="grid gap-2.5 lg:grid-cols-2">
          {shown.map((order) => (
            <OrderCard key={order.id} order={order} now={now} />
          ))}
        </ul>
      )}
      {list.length > shown.length ? <p className="mt-3 text-[12px] text-faint">Showing the first {shown.length} of {list.length}. Search to find the rest.</p> : null}
    </>
  );
}

function statusAge(iso: string, now: number): string {
  const a = age(iso, now);
  return a === "just now" ? "Status set just now" : `Status set ${a} ago`;
}

function OrderCard({ order, now }: { order: OrderSummary; now: number }) {
  const status = deliveryStatusOf(order.stage);
  const products = order.lines.filter((l) => l.status !== "cancelled" && l.status !== "rejected");
  return (
    <li className="action-block !mt-0 grid gap-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="min-w-0">
          <Link href={`/orders/${encodeURIComponent(order.id)}`} className="font-semibold text-info">{order.shopifyOrderId ?? order.id}</Link>
          <span className="ml-2 text-[12px] text-faint">{shortWhen(order.createdAt)}</span>
        </span>
        <span className={`badge ${DELIVERY_TONE[status]}`}>{DELIVERY_LABELS[status]}</span>
      </div>
      <div className="text-[13px]">
        <p className="text-ink">
          {order.customerName}
          {order.phone ? <a href={`tel:${order.phone}`} className="ml-2 text-info">{order.phone}</a> : null}
        </p>
        <p className="mt-0.5 text-muted">{(products.length ? products : order.lines).map((l) => `${l.productName}${l.qty > 1 ? ` ×${l.qty}` : ""}`).join(", ")}</p>
        <p className="mt-0.5 text-faint">
          {[order.poc ? `Sold by ${order.poc}` : null, order.hub, inr(order.offeredTotalMinor), order.declaredPaymentStatus].filter(Boolean).join(" · ")}
        </p>
        {order.shippingAddress ? <p className="mt-0.5 text-faint">{[order.shippingAddress, order.pincode].filter(Boolean).join(", ")}</p> : null}
        <p className="mt-1 text-[12px] text-faint">
          {[order.expectedDeliveryDate ? `Expected ${shortDate(order.expectedDeliveryDate)}` : null, order.driver ? `Driver ${order.driver}` : null, order.holdReason && status === "on_hold" ? `Hold: ${order.holdReason}` : null, statusAge(statusChangedAt(order), now)]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <DeliveryStatusForm order={order} />
    </li>
  );
}

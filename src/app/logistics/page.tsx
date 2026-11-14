import { Suspense } from "react";
import Link from "next/link";
import { after } from "next/server";
import { ExternalLink } from "lucide-react";
import { sweepSalesSheetAction } from "@/app/actions/ops";
import { BlockedState } from "@/components/blocked-state";
import { ActionForm, SubmitButton } from "@/components/ops/action-form";
import { CopyLink } from "@/components/ops/copy-link";
import { SectionSkeleton } from "@/components/ops/overview";
import { StatusBadge } from "@/components/ops/status-badge";
import { StatusPicker } from "@/components/ops/status-picker";
import { DELIVERY_CODES, DELIVERY_STATUSES, deliveryStatusOf, statusChangedAt, statusFrom, statusFromIso, usesAppStock } from "@/lib/ops/delivery-status";
import type { OpsStore } from "@/lib/ops/store";
import type { OrderSummary } from "@/lib/ops/types";
import { boardOrders, countByStatus, inView, matchesSearch, readView, sortForBoard, type BoardView } from "@/lib/ops-ui/delivery-board";
import { currentSession } from "@/lib/ops-ui/actor";
import { age, inr, requestNow, shortDate, shortWhen } from "@/lib/ops-ui/format";
import { loadOps } from "@/lib/ops-ui/load";
import { publicStatusPath } from "@/lib/public-status";
import { firstParam } from "@/lib/query";
import { salesSheetStatus, sweepSalesSheet } from "@/lib/sheets/sales-sheet-run";

export const metadata = { title: "Update status · EPIK" };

/** Inventory: every new sale lands here. Pick a status; it syncs to the SMB sheet, Slack and the salespeople's page. */
export default async function UpdateStatusPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [ops, params, session] = await Promise.all([loadOps(), searchParams, currentSession()]);
  const admin = session.role === "admin";
  // Everyone can see the list; Inventory and Admin can change a status.
  const canSet = session.role !== "sales";
  if (ops.kind !== "ready") return <BlockedState health={ops.workspace.health} />;
  const view = readView(firstParam(params.view));
  const q = (firstParam(params.q) ?? "").slice(0, 80);
  // Visiting the page also tops up the SMB sheet (at most every 2 minutes).
  after(() => sweepSalesSheet(ops.store));
  return (
    <section>
      <div className="s-page-head">
        <div>
          <h1>Update status</h1>
          <p>
            Every sale since {shortDate(statusFrom())}.{" "}
            {canSet ? "Pick a status and it saves. The SMB sheet, Slack and the salespeople's page update by themselves." : "View only: switch to Inventory at the top to change a status."}
          </p>
        </div>
      </div>
      {admin ? (
        <Suspense fallback={null}>
          <AdminStrip store={ops.store} />
        </Suspense>
      ) : null}
      <Suspense key={`${view}:${q}`} fallback={<SectionSkeleton height={520} />}>
        <Board store={ops.store} view={view} q={q} canSet={canSet} />
      </Suspense>
    </section>
  );
}

async function AdminStrip({ store }: { store: OpsStore }) {
  const sheet = await salesSheetStatus(store);
  const link = publicStatusPath();
  const sheetText = sheet.on
    ? sheet.lastError
      ? `SMB sheet: last write failed (${sheet.lastError.message})`
      : `SMB sheet connected${sheet.lastOkAt ? `, last write ${shortWhen(sheet.lastOkAt)}` : ""}`
    : "SMB sheet not connected yet";
  return (
    <div className="s-card mb-3 flex flex-wrap items-center gap-2 px-4 py-3 text-[13px]">
      <span className={`mr-auto ${sheet.on && !sheet.lastError ? "text-good" : "text-warn"}`}>{sheetText}</span>
      {sheet.on ? (
        <ActionForm action={sweepSalesSheetAction}>
          <SubmitButton small tone="quiet">Write all to sheet now</SubmitButton>
        </ActionForm>
      ) : null}
      {link ? (
        <>
          <CopyLink path={link} label="Copy salespeople's link" />
          <a href={link} target="_blank" rel="noreferrer" className="btn-quiet inline-flex h-10 items-center gap-2 rounded-[12px] px-3.5 text-[13px] font-medium"><ExternalLink size={15} /> Open</a>
        </>
      ) : null}
    </div>
  );
}

const TABS: Array<{ view: BoardView; label: string }> = [
  { view: "open", label: "To do" },
  ...DELIVERY_STATUSES.filter((s) => s !== "on_hold").map((s) => ({ view: s as BoardView, label: DELIVERY_CODES[s] })),
  { view: "all", label: "All" },
];

async function Board({ store, view, q, canSet }: { store: OpsStore; view: BoardView; q: string; canSet: boolean }) {
  const { items } = await store.listOrders({ stage: "all", from: statusFromIso(), limit: 5000 });
  const all = boardOrders(items, statusFromIso()).filter((o) => matchesSearch(o, q));
  const counts = countByStatus(all);
  const list = sortForBoard(all.filter((o) => inView(o, view)), view);
  const shown = list.slice(0, 200);
  const now = requestNow();
  const href = (v: BoardView) => {
    const qs = new URLSearchParams({ ...(v !== "open" ? { view: v } : {}), ...(q ? { q } : {}) }).toString();
    return qs ? `/logistics?${qs}` : "/logistics";
  };
  return (
    <>
      <form action="/logistics" className="s-search">
        {view !== "open" ? <input type="hidden" name="view" value={view} /> : null}
        <input name="q" defaultValue={q} placeholder="Search #PIK, phone, customer, product, POC" aria-label="Search orders" />
      </form>
      <nav className="s-chips" aria-label="Status">
        {TABS.map((tab) => (
          <Link key={tab.view} href={href(tab.view)} aria-current={view === tab.view ? "page" : undefined}>
            {tab.label} <span>{counts[tab.view]}</span>
          </Link>
        ))}
      </nav>
      <div className="s-card s-rows">
        {shown.length ? (
          shown.map((order) => <Row key={order.id} order={order} now={now} canSet={canSet} />)
        ) : (
          <p className="s-empty">{q ? "No order matches that search." : view === "open" ? "All done. New sales show up here as soon as they're posted." : "No orders here."}</p>
        )}
      </div>
      {list.length > shown.length ? <p className="mt-3 text-[12px] text-faint">Showing the first {shown.length} of {list.length}. Search to find the rest.</p> : null}
    </>
  );
}

function since(iso: string, now: number): string {
  const a = age(iso, now);
  return a === "just now" ? "just now" : `${a} ago`;
}

function Row({ order, now, canSet }: { order: OrderSummary; now: number; canSet: boolean }) {
  const status = deliveryStatusOf(order.stage);
  const label = order.shopifyOrderId ?? order.id;
  const products = order.lines.filter((l) => l.status !== "cancelled" && l.status !== "rejected");
  return (
    <div className="s-row">
      <div className="s-row-main">
        <div className="s-row-title">
          <Link href={`/orders/${encodeURIComponent(order.id)}`}>{label}</Link>
          <strong className="truncate !font-medium">{order.customerName}</strong>
        </div>
        <p className="s-row-sub">
          {[(products.length ? products : order.lines).map((l) => `${l.productName}${l.qty > 1 ? ` ×${l.qty}` : ""}`).join(", "), order.poc, order.hub, inr(order.offeredTotalMinor)].filter(Boolean).join(" · ")}
        </p>
        <p className="s-row-sub">
          {[`Sold ${shortWhen(order.createdAt)}`, `status ${since(statusChangedAt(order), now)}`, order.expectedDeliveryDate ? `expected ${shortDate(order.expectedDeliveryDate)}` : null, order.driver ? `driver ${order.driver}` : null].filter(Boolean).join(" · ")}
        </p>
      </div>
      <div className="s-row-side">
        {!canSet || status === "cancelled" || usesAppStock(order.lines) ? (
          <StatusBadge stage={order.stage} />
        ) : (
          <StatusPicker key={`${order.stage}:${order.updatedAt}`} orderId={order.id} status={status} expectedDate={order.expectedDeliveryDate} driver={order.driver} label={label} />
        )}
      </div>
    </div>
  );
}

import Link from "next/link";
import { after } from "next/server";
import { Plus } from "lucide-react";
import { BlockedState } from "@/components/blocked-state";
import { ApprovalDoneHost, PaymentApproval } from "@/components/ops/payment-approval";
import { StatusBadge } from "@/components/ops/status-badge";
import { isoDateInIst } from "@/lib/format";
import { deliveryStatusOf, needsPaymentApproval } from "@/lib/ops/delivery-status";
import { isTestName } from "@/lib/ops/test-mode";
import type { OrderSummary } from "@/lib/ops/types";
import { OPEN_DELIVERY } from "@/lib/ops-ui/delivery-board";
import { inr, inrCompact, shortWhen } from "@/lib/ops-ui/format";
import { currentSession } from "@/lib/ops-ui/actor";
import { loadOps } from "@/lib/ops-ui/load";
import { firstParam } from "@/lib/query";
import { syncShopify } from "@/lib/shopify/run";
import { followSmb } from "@/lib/sheets/track-data";

export const metadata = { title: "Sales · EPIK" };

const VIEWS = [
  { id: "all", label: "All" },
  { id: "payment", label: "Payment pending" },
  { id: "open", label: "Not delivered" },
  { id: "delivered", label: "Delivered" },
  { id: "cancelled", label: "Cancelled" },
] as const;
type View = (typeof VIEWS)[number]["id"];

function inView(order: OrderSummary, view: View): boolean {
  if (view === "payment") return needsPaymentApproval(order);
  const s = deliveryStatusOf(order.stage);
  if (view === "open") return OPEN_DELIVERY.includes(s);
  if (view === "delivered") return s === "delivered";
  if (view === "cancelled") return s === "cancelled";
  return true;
}

/** Sales home: book a sale, see every sale with its status. Nothing else. */
export default async function SalesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [ops, params, session] = await Promise.all([loadOps(), searchParams, currentSession()]);
  // Sales and Admin approve payments; Inventory only sees them.
  const canApprove = session.role === "sales" || session.role === "admin";
  if (ops.kind !== "ready") return <BlockedState health={ops.workspace.health} />;
  // Opening the page also brings in new Shopify orders and payments (at most every 5 minutes).
  after(() => syncShopify(ops.store));
  after(() => followSmb());
  const q = (firstParam(params.q) ?? "").slice(0, 80);
  const view = (VIEWS.find((v) => v.id === firstParam(params.view))?.id ?? "all") as View;
  const { items } = await ops.store.listOrders({ stage: "all", q: q || undefined, limit: 150 });
  const sales = items.filter((o) => !isTestName(o.customerName)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const today = isoDateInIst(new Date());
  const todays = sales.filter((o) => o.stage !== "cancelled" && isoDateInIst(new Date(o.createdAt)) === today);
  const open = sales.filter((o) => inView(o, "open"));
  const pending = sales.filter((o) => needsPaymentApproval(o));
  const list = sales.filter((o) => inView(o, view)).slice(0, 60);
  const href = (v: View) => {
    const qs = new URLSearchParams({ ...(v !== "all" ? { view: v } : {}), ...(q ? { q } : {}) }).toString();
    return qs ? `/sales?${qs}` : "/sales";
  };

  return (
    <section>
      <div className="s-page-head">
        <div>
          <h1>Sales and payment</h1>
          <p>Book a sale here or in Slack. Approve each sale&apos;s payment: then it goes to logistics.</p>
        </div>
        <Link href="/orders/new" className="s-cta"><Plus size={17} /> New sale</Link>
      </div>

      <dl className="s-stats is-4">
        <div className="s-stat"><dt>Sales today</dt><dd>{todays.length}</dd></div>
        <div className="s-stat"><dt>Value today</dt><dd>{inrCompact(todays.reduce((n, o) => n + o.offeredTotalMinor, 0))}</dd></div>
        <div className="s-stat"><dt>Payment to approve</dt><dd className={pending.length ? "text-warn" : ""}>{pending.length}</dd></div>
        <div className="s-stat"><dt>Not delivered</dt><dd>{open.length}</dd></div>
      </dl>

      <form action="/sales" className="s-search">
        {view !== "all" ? <input type="hidden" name="view" value={view} /> : null}
        <input name="q" defaultValue={q} placeholder="Search customer, phone, #PIK or product" aria-label="Search sales" />
      </form>
      <nav className="s-chips" aria-label="Show">
        {VIEWS.map((v) => (
          <Link key={v.id} href={href(v.id)} aria-current={view === v.id ? "page" : undefined}>
            {v.label} <span>{sales.filter((o) => inView(o, v.id)).length}</span>
          </Link>
        ))}
      </nav>

      <ApprovalDoneHost />
      <div className="s-card s-rows">
        {list.length ? (
          list.map((order) => (
            <div key={order.id} className="s-row">
              <div className="s-row-main">
                <div className="s-row-title">
                  <Link href={`/orders/${encodeURIComponent(order.id)}`}>{order.customerName}</Link>
                  <span className="text-[12px] text-faint">{order.shopifyOrderId ?? order.id}</span>
                </div>
                <p className="s-row-sub">
                  {[order.lines.map((l) => l.productName).join(", ") || "No product", order.poc, shortWhen(order.createdAt)].filter(Boolean).join(" · ")}
                </p>
                <p className={`s-row-sub ${/^(full paid|shopify: paid)/i.test(order.declaredPaymentStatus ?? "") ? "!text-good" : ""}`}>
                  {order.declaredPaymentStatus ?? "Payment not stated"}{order.declaredPaymentMode ? ` · ${order.declaredPaymentMode}` : ""}
                </p>
              </div>
              <div className="s-row-side">
                <span className="s-amount">{inr(order.offeredTotalMinor)}</span>
                {needsPaymentApproval(order) ? (
                  canApprove ? (
                    <PaymentApproval
                      order={{
                        id: order.id,
                        label: order.shopifyOrderId ?? order.id,
                        customer: order.customerName,
                        totalMinor: order.offeredTotalMinor,
                        paidMinor: order.paidMinor,
                        declaredStatus: order.declaredPaymentStatus,
                        declaredMode: order.declaredPaymentMode,
                      }}
                    />
                  ) : (
                    <span className="badge tone-warn">Payment pending</span>
                  )
                ) : (
                  <StatusBadge stage={order.stage} />
                )}
              </div>
            </div>
          ))
        ) : (
          <p className="s-empty">{q ? "No sale matches that search." : "No sales here yet."}</p>
        )}
      </div>
    </section>
  );
}

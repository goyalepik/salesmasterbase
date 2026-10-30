import { Suspense } from "react";
import Link from "next/link";
import { BlockedState } from "@/components/blocked-state";
import { DownloadButton, Kpi, Panel } from "@/components/ops/bits";
import { DeliveredForm, DispatchForm } from "@/components/ops/order-actions";
import { SectionSkeleton } from "@/components/ops/overview";
import { PageHeader } from "@/components/ui";
import { isoDateInIst } from "@/lib/format";
import type { OpsStore } from "@/lib/ops/store";
import type { OrderSummary } from "@/lib/ops/types";
import { inr, plural, shortDate } from "@/lib/ops-ui/format";
import { loadOps } from "@/lib/ops-ui/load";
import { firstParam } from "@/lib/query";

export default async function DispatchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [ops, params] = await Promise.all([loadOps(), searchParams]);
  if (ops.kind !== "ready") return <BlockedState health={ops.workspace.health} />;
  const view = firstParam(params.view) === "out" ? "out" : "ready";
  return (
    <section>
      <PageHeader title="Dispatch" description="Orders with stock ready, and orders on the road. Grouped by hub. COD is the money to collect at the door." action={<DownloadButton kind="dispatch" label="Download dispatch list" />} />
      <Suspense key={view} fallback={<SectionSkeleton height={520} />}>
        <DispatchBoard store={ops.store} view={view} />
      </Suspense>
    </section>
  );
}

function groupByHub(orders: OrderSummary[]): Array<[string, OrderSummary[]]> {
  const groups = new Map<string, OrderSummary[]>();
  for (const order of orders) {
    const hub = order.hub ?? "No hub";
    groups.set(hub, [...(groups.get(hub) ?? []), order]);
  }
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
}

async function DispatchBoard({ store, view }: { store: OpsStore; view: "ready" | "out" }) {
  const [ready, out] = await Promise.all([
    store.listOrders({ stage: "ready_to_dispatch", limit: 500 }),
    store.listOrders({ stage: "out_for_delivery", limit: 500 }),
  ]);
  const cod = out.items.reduce((sum, o) => sum + o.codDueMinor, 0);
  const today = isoDateInIst(new Date());
  const late = out.items.filter((o) => o.expectedDeliveryDate && o.expectedDeliveryDate < today).length;
  const list = [...(view === "ready" ? ready.items : out.items)].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return (
    <>
      <dl className="ops-grid-4">
        <Kpi label="Ready to dispatch" value={ready.total} href="/dispatch" />
        <Kpi label="Out for delivery" value={out.total} href="/dispatch?view=out" />
        <Kpi label="COD to collect" value={inr(cod)} note="On orders out for delivery." tone={cod ? "warn" : undefined} />
        <Kpi label="Past expected date" value={late} tone={late ? "bad" : undefined} href="/dispatch?view=out" />
      </dl>
      <nav className="stage-tabs" aria-label="View">
        <Link href="/dispatch" aria-current={view === "ready" ? "page" : undefined}>Ready to dispatch <span>{ready.total}</span></Link>
        <Link href="/dispatch?view=out" aria-current={view === "out" ? "page" : undefined}>Out for delivery <span>{out.total}</span></Link>
      </nav>
      {!list.length ? (
        <p className="panel-strong px-4 py-6 text-[13px] text-muted">{view === "ready" ? "Nothing ready. Orders arrive here when every product has stock." : "Nobody is out on delivery."}</p>
      ) : (
        groupByHub(list).map(([hub, orders]) => {
          const hubCod = orders.reduce((sum, o) => sum + o.codDueMinor, 0);
          return (
            <Panel key={hub} className="mb-2.5" title={`${hub} · ${plural(orders.length, "order")}`} subtitle={hubCod ? `${inr(hubCod)} COD to collect` : "No COD"}>
              <ul className="grid gap-2 lg:grid-cols-2">
                {orders.map((order) => {
                  const lateOrder = view === "out" && !!order.expectedDeliveryDate && order.expectedDeliveryDate < today;
                  return (
                    <li key={order.id} className={`action-block !mt-0 ${lateOrder ? "!border-[rgba(255,105,120,0.55)]" : ""}`}>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="min-w-0">
                          <Link href={`/orders/${encodeURIComponent(order.id)}`} className="font-semibold text-info">{order.id}</Link>
                          <span className="ml-2 text-ink">{order.customerName}</span>
                        </span>
                        {order.codDueMinor ? <span className="badge tone-warn">COD {inr(order.codDueMinor)}</span> : <span className="badge tone-good">Paid</span>}
                      </div>
                      <p className="mt-1 text-[12px] text-muted">{order.lines.filter((l) => l.status !== "cancelled" && l.status !== "rejected").map((l) => l.productName).join(", ")}</p>
                      <p className="mt-1 text-[12px] text-faint">
                        {[order.shippingAddress, order.pincode].filter(Boolean).join(", ") || "No address"}
                        {order.phone ? <> · <a href={`tel:${order.phone}`} className="text-info">{order.phone}</a></> : null}
                      </p>
                      {view === "out" ? (
                        <p className={`mt-1 text-[12px] ${lateOrder ? "text-bad" : "text-muted"}`}>
                          {order.driver ? `With ${order.driver}` : "No driver recorded"}
                          {order.expectedDeliveryDate ? ` · expected ${shortDate(order.expectedDeliveryDate)}` : ""}
                        </p>
                      ) : null}
                      <details className="action-more mt-1">
                        <summary>{view === "ready" ? "Send out for delivery" : "Mark delivered"}</summary>
                        {view === "ready" ? <DispatchForm order={order} /> : <DeliveredForm order={order} />}
                      </details>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          );
        })
      )}
    </>
  );
}

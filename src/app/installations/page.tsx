import { Suspense } from "react";
import Link from "next/link";
import { BlockedState } from "@/components/blocked-state";
import { Kpi, Panel } from "@/components/ops/bits";
import { InstallationForm } from "@/components/ops/order-actions";
import { SectionSkeleton } from "@/components/ops/overview";
import { PageHeader, Pager } from "@/components/ui";
import { isoDateInIst } from "@/lib/format";
import type { OpsStore } from "@/lib/ops/store";
import { shortDate } from "@/lib/ops-ui/format";
import { loadOps } from "@/lib/ops-ui/load";
import { firstParam, parsePage } from "@/lib/query";

const PAGE = 50;

export default async function InstallationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [ops, params] = await Promise.all([loadOps(), searchParams]);
  if (ops.kind !== "ready") return <BlockedState health={ops.workspace.health} />;
  const page = parsePage(firstParam(params.page));
  return (
    <section>
      <PageHeader title="Installations" description="Robot vacuums and other products that need setting up. Due the day after delivery. Overdue in red." />
      <Suspense key={page} fallback={<SectionSkeleton height={520} />}>
        <InstallList store={ops.store} page={page} />
      </Suspense>
    </section>
  );
}

async function InstallList({ store, page }: { store: OpsStore; page: number }) {
  const all = (await store.listInstallations({ status: "pending" })).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const today = isoDateInIst(new Date());
  const overdue = all.filter((i) => i.dueDate < today).length;
  const dueToday = all.filter((i) => i.dueDate === today).length;
  const rows = all.slice((page - 1) * PAGE, page * PAGE);
  return (
    <>
      <dl className="ops-grid-3">
        <Kpi label="Pending" value={all.length} />
        <Kpi label="Due today" value={dueToday} tone={dueToday ? "warn" : undefined} />
        <Kpi label="Overdue" value={overdue} tone={overdue ? "bad" : undefined} />
      </dl>
      <Panel title="Pending installations" subtitle="Oldest due date first.">
        {!rows.length ? (
          <p className="text-[13px] text-muted">Nothing pending. Delivered orders that need installation appear here.</p>
        ) : (
          <ul className="grid gap-2 lg:grid-cols-2">
            {rows.map((item) => {
              const late = item.dueDate < today;
              return (
                <li key={item.id} className={`action-block !mt-0 ${late ? "!border-[rgba(255,105,120,0.55)]" : ""}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="min-w-0 text-[14px] font-medium text-ink">{item.productName}</span>
                    <span className={`badge ${late ? "tone-bad" : item.dueDate === today ? "tone-warn" : "tone-info"}`}>{late ? `Overdue · ${shortDate(item.dueDate)}` : `Due ${shortDate(item.dueDate)}`}</span>
                  </div>
                  <p className="mt-1 text-[12px] text-muted">
                    <Link href={`/orders/${encodeURIComponent(item.orderId)}`} className="text-info">{item.orderId}</Link> · {item.customerName}
                    {item.phone ? <> · <a href={`tel:${item.phone}`} className="text-info">{item.phone}</a></> : null}
                  </p>
                  {item.address ? <p className="mt-1 text-[12px] text-faint">{item.address}</p> : null}
                  <details className="action-more mt-1">
                    <summary>Mark installed</summary>
                    <InstallationForm item={item} compact />
                  </details>
                </li>
              );
            })}
          </ul>
        )}
        <Pager path="/installations" page={page} pageSize={PAGE} total={all.length} preserve={{}} />
      </Panel>
    </>
  );
}

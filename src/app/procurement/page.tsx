import { Suspense } from "react";
import Link from "next/link";
import { receivePoAction } from "@/app/actions/ops";
import { BlockedState } from "@/components/blocked-state";
import { ActionForm, SubmitButton } from "@/components/ops/action-form";
import { DownloadButton, FoldPanel, Kpi, Panel, TableWrap, inputClass } from "@/components/ops/bits";
import { InventoryTabs } from "@/components/ops/inventory-tabs";
import { SectionSkeleton } from "@/components/ops/overview";
import { FilePlus2 } from "lucide-react";
import { NewPoForm } from "@/components/ops/stock-forms";
import { PageHeader, Pager } from "@/components/ui";
import { isoDateInIst } from "@/lib/format";
import type { OpsStore } from "@/lib/ops/store";
import { shortDate } from "@/lib/ops-ui/format";
import { loadOps } from "@/lib/ops-ui/load";
import { firstParam, parsePage } from "@/lib/query";

const PO_PAGE = 50;

export default async function ProcurementPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [ops, params] = await Promise.all([loadOps(), searchParams]);
  if (ops.kind !== "ready") return <BlockedState health={ops.workspace.health} />;
  const q = firstParam(params.q).replace(/\s+/g, " ").trim().slice(0, 60);
  const page = parsePage(firstParam(params.page));
  return (
    <section>
      <PageHeader title="Purchase orders" description="Brand POs on the way. Sold products can be backordered on a PO; receiving it allocates them, oldest order first. Past the ETA shows in red." action={<DownloadButton kind="purchase-orders" label="Download POs" />} />
      <InventoryTabs store={ops.store} current="pos" />
      <FoldPanel title="New purchase order" subtitle="Record a brand PO the day it is placed. Orders can be held on it, and receiving it reserves them." icon={<FilePlus2 size={18} />}>
        <NewPoForm />
      </FoldPanel>
      <Suspense key={`${q}|${page}`} fallback={<SectionSkeleton height={500} />}>
        <PurchaseOrders store={ops.store} q={q} page={page} />
      </Suspense>
    </section>
  );
}

async function PurchaseOrders({ store, q, page }: { store: OpsStore; q: string; page: number }) {
  const [all, stocking, deciding] = await Promise.all([
    store.listPurchaseOrders({ status: "open" }),
    store.listOrders({ stage: "awaiting_stock", limit: 500 }),
    store.listOrders({ stage: "awaiting_inventory", limit: 500 }),
  ]);
  // How many sold units wait on each PO line, so the team knows which arrivals matter most.
  const sold = new Map<string, number>();
  for (const order of [...stocking.items, ...deciding.items]) for (const line of order.lines) if (line.status === "awaiting_po" && line.poId) sold.set(line.poId, (sold.get(line.poId) ?? 0) + line.qty);
  const needle = q.toLowerCase();
  const today = isoDateInIst(new Date());
  const matches = all
    .filter((po) => !needle || `${po.poNumber} ${po.vendor ?? ""} ${po.sku} ${po.productName ?? ""}`.toLowerCase().includes(needle))
    .sort((a, b) => (a.eta ?? "9999").localeCompare(b.eta ?? "9999"));
  const late = all.filter((po) => po.eta && po.eta < today).length;
  const units = all.reduce((sum, po) => sum + po.qtyOrdered - po.qtyReceived, 0);
  const rows = matches.slice((page - 1) * PO_PAGE, page * PO_PAGE);
  return (
    <Panel title={`Open PO lines (${all.length})`} subtitle="One row per product on a PO. “Sold, waiting” is how many units customers have already bought.">
      <dl className="ops-grid-3">
        <Kpi label="Open PO lines" value={all.length} />
        <Kpi label="Units on the way" value={units} />
        <Kpi label="Past ETA" value={late} tone={late ? "bad" : undefined} />
      </dl>
      <form action="/procurement" className="mb-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <label className="sr-only" htmlFor="po-q">Search purchase orders</label>
        <input id="po-q" name="q" defaultValue={q} placeholder="PO number, vendor, SKU or product" className={inputClass} />
        <button type="submit" className="glow-button h-11 rounded-[14px] px-4 text-[14px] font-medium text-white">Search</button>
      </form>
      <TableWrap minWidth={900}>
        <thead>
          <tr>
            <th>PO</th>
            <th>Product</th>
            <th>Vendor</th>
            <th className="num">Pending</th>
            <th className="num">Sold, waiting</th>
            <th>ETA</th>
            <th>Receive</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((po) => {
            const pending = po.qtyOrdered - po.qtyReceived;
            const overdue = !!po.eta && po.eta < today;
            return (
              <tr key={po.id} className={overdue ? "is-late" : undefined}>
                <td className="whitespace-nowrap font-medium">{po.poNumber}</td>
                <td className="max-w-[260px]">
                  <span className="block truncate">{po.productName ?? po.sku}</span>
                  <span className="block text-[11px] text-faint">{po.sku}</span>
                </td>
                <td className="max-w-[140px] truncate text-muted">{po.vendor ?? "—"}</td>
                <td className="num">{pending} <span className="text-faint">of {po.qtyOrdered}</span></td>
                <td className="num">{sold.get(po.id) ? <Link href="/inventory/incoming" className="font-semibold text-info">{sold.get(po.id)}</Link> : <span className="text-faint">0</span>}</td>
                <td className={`whitespace-nowrap ${overdue ? "font-medium text-bad" : ""}`}>{po.eta ? shortDate(po.eta) : "—"}</td>
                <td className="min-w-[260px]">
                  <details className="action-more">
                    <summary>Receive goods</summary>
                    <ActionForm action={receivePoAction} className="grid gap-2 pb-1">
                      <input type="hidden" name="poId" value={po.id} />
                      <div className="grid grid-cols-[80px_minmax(0,1fr)] gap-2">
                        <label className="block text-[12px] text-muted">
                          Qty
                          <input name="qty" type="number" min={1} max={pending} defaultValue={pending} required className={`mt-1 ${inputClass}`} />
                        </label>
                        <label className="block text-[12px] text-muted">
                          Cost per unit (₹)
                          <input name="cost" inputMode="decimal" placeholder="Optional" className={`mt-1 ${inputClass}`} />
                        </label>
                      </div>
                      <label className="block text-[12px] text-muted">
                        Serial numbers
                        <textarea name="serials" rows={2} placeholder="One per line, optional" className="field mt-1 w-full px-3 py-2 text-[13px] outline-none" />
                      </label>
                      <SubmitButton tone="good" small>Received</SubmitButton>
                    </ActionForm>
                  </details>
                </td>
              </tr>
            );
          })}
        </tbody>
      </TableWrap>
      <Pager path="/procurement" page={page} pageSize={PO_PAGE} total={matches.length} preserve={{ q }} />
    </Panel>
  );
}

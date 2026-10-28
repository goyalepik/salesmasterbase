import Link from "next/link";
import { EmptyState, PageHeader, Pager, ReviewText, StatusText, TextButton, fieldClassName } from "@/components/ui";
import { formatDateTime, formatInrFromMinor } from "@/lib/format";
import type { MessageQuery, PageResult, SalesRecord } from "@/lib/types";

const INTENT: Record<SalesRecord["intent"], string> = {
  payment_mention: "Payment mention",
  order_update: "Order update",
  unclassified: "Unclassified",
};

export function RecordsScreen({ result, query }: { result: PageResult<SalesRecord>; query: MessageQuery }) {
  const preserve = { q: query.q, status: query.status === "all" ? "" : query.status, from: query.from, to: query.to };
  return (
    <section>
      <PageHeader
        title="Sales records"
        description="Fields read from Slack text. They are not orders, invoices, or verified payments, and they are not added up."
      />
      <form className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,0.6fr))_auto] sm:items-end" action="/records">
        <label className="text-[12px] text-muted">Search
          <input className={`mt-1 ${fieldClassName()}`} name="q" defaultValue={query.q} />
        </label>
        <label className="text-[12px] text-muted">Status
          <select className={`mt-1 ${fieldClassName()}`} name="status" defaultValue={query.status}>
            <option value="all">Any</option>
            <option value="processed">Processed</option>
            <option value="needs_review">Needs review</option>
            <option value="failed">Failed</option>
          </select>
        </label>
        <label className="text-[12px] text-muted">From
          <input className={`mt-1 ${fieldClassName()}`} type="date" name="from" defaultValue={query.from} />
        </label>
        <label className="text-[12px] text-muted">To
          <input className={`mt-1 ${fieldClassName()}`} type="date" name="to" defaultValue={query.to} />
        </label>
        <TextButton>Apply</TextButton>
      </form>
      <p className="mb-3 text-[12px] text-muted">Amount read is a parse of the message. It is not proof that money was received.</p>
      {result.items.length === 0 ? <EmptyState title="No extracted records" detail="Messages without a payment mention or order reference stay in the inbox and are not listed here." /> : (
        <div className="panel-strong overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-left text-[13px]">
            <thead className="text-[12px] text-muted">
              <tr>
                <th className="py-2 pr-3 font-medium">Received</th>
                <th className="py-2 pr-3 font-medium">Customer</th>
                <th className="py-2 pr-3 font-medium">Order</th>
                <th className="py-2 pr-3 text-right font-medium">Amount read</th>
                <th className="py-2 pr-3 font-medium">Mode mentioned</th>
                <th className="py-2 pr-3 font-medium">Intent</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 font-medium">Review</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((row) => (
                <tr key={row.messageId} className="border-t border-line align-top">
                  <td className="py-2 pr-3 whitespace-nowrap text-muted tabular-nums"><Link href={`/inbox/${row.messageId}`}>{formatDateTime(row.eventReceivedAt)}</Link></td>
                  <td className="py-2 pr-3">{row.customerName ?? "—"}</td>
                  <td className="py-2 pr-3 tabular-nums">{row.orderReference ?? "—"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatInrFromMinor(row.amountMinor)}</td>
                  <td className="py-2 pr-3">{row.paymentModeMention ?? "—"}</td>
                  <td className="py-2 pr-3">{INTENT[row.intent]}</td>
                  <td className="py-2 pr-3"><StatusText status={row.processingStatus} /></td>
                  <td className="py-2"><ReviewText review={row.review} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager path="/records" page={result.page} pageSize={result.pageSize} total={result.total} preserve={preserve} />
    </section>
  );
}

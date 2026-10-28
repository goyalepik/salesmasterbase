import Link from "next/link";
import { RefreshOnChange } from "@/components/live-provider";
import { EmptyState, ExceptionLabel, PageHeader, Pager, SeverityText, TextButton, fieldClassName } from "@/components/ui";
import { formatDateTime, shortText } from "@/lib/format";
import { EXCEPTION_TYPES, type ExceptionQuery, type PageResult } from "@/lib/types";
import type { ExceptionListItem } from "@/lib/repository";

export function ExceptionsScreen({ result, query }: { result: PageResult<ExceptionListItem>; query: ExceptionQuery }) {
  const preserve = {
    status: query.status,
    type: query.type === "all" ? "" : query.type,
    severity: query.severity === "all" ? "" : query.severity,
  };
  return (
    <section>
      <RefreshOnChange />
      <PageHeader
        title="Exceptions"
        description="Deterministic checks against message text. Resolving an item records a note. It does not verify a payment."
      />
      <form className="mb-4 grid gap-2 sm:grid-cols-[repeat(3,minmax(0,0.7fr))_auto] sm:items-end" action="/exceptions">
        <label className="text-[12px] text-muted">Status
          <select className={`mt-1 ${fieldClassName()}`} name="status" defaultValue={query.status}>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="superseded">Superseded</option>
            <option value="all">Any</option>
          </select>
        </label>
        <label className="text-[12px] text-muted">Type
          <select className={`mt-1 ${fieldClassName()}`} name="type" defaultValue={query.type}>
            <option value="all">Any</option>
            {EXCEPTION_TYPES.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}
          </select>
        </label>
        <label className="text-[12px] text-muted">Severity
          <select className={`mt-1 ${fieldClassName()}`} name="severity" defaultValue={query.severity}>
            <option value="all">Any</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <TextButton>Apply</TextButton>
      </form>
      {result.items.length === 0 ? <EmptyState title="Nothing in this filter" detail="Open items appear here when a message is missing a field, is ambiguous, conflicts with an earlier extract, or fails to parse." /> : (
        <div className="panel-strong overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-left text-[13px]">
            <thead className="text-[12px] text-muted">
              <tr>
                <th className="py-2 pr-3 font-medium">Opened</th>
                <th className="py-2 pr-3 font-medium">Type</th>
                <th className="py-2 pr-3 font-medium">Severity</th>
                <th className="py-2 pr-3 font-medium">Reason</th>
                <th className="py-2 pr-3 font-medium">Record</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((item) => (
                <tr key={item.id} className="border-t border-line align-top">
                  <td className="py-2 pr-3 whitespace-nowrap text-muted tabular-nums">{formatDateTime(item.createdAt)}</td>
                  <td className="py-2 pr-3"><ExceptionLabel type={item.type} /></td>
                  <td className="py-2 pr-3"><SeverityText severity={item.severity} /></td>
                  <td className="max-w-[320px] py-2 pr-3">{item.reason}</td>
                  <td className="py-2 pr-3">
                    <Link href={`/inbox/${item.messageId}#exception-${item.id}`} className="text-accent">{item.orderReference ?? item.customerName ?? "Message"}</Link>
                    <p className="text-[12px] text-muted">{shortText(item.preview, 80)}</p>
                  </td>
                  <td className="py-2 capitalize">{item.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager path="/exceptions" page={result.page} pageSize={result.pageSize} total={result.total} preserve={preserve} />
    </section>
  );
}

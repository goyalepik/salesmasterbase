import { RefreshOnChange } from "@/components/live-provider";
import { EmptyState, PageHeader, Pager, TextButton, fieldClassName } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { AuditEntry, PageResult } from "@/lib/types";

export function ActivityScreen({
  result,
  action,
  outcome,
}: {
  result: PageResult<AuditEntry>;
  action: string;
  outcome: string;
}) {
  return (
    <section>
      <RefreshOnChange />
      <PageHeader
        title="Activity log"
        description="Append-only record of ingestion, processing, retries, and exception decisions. Message text is not copied here."
      />
      <form className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-end" action="/activity">
        <label className="text-[12px] text-muted">Action or summary
          <input className={`mt-1 ${fieldClassName()}`} name="action" defaultValue={action} />
        </label>
        <label className="text-[12px] text-muted">Outcome
          <select className={`mt-1 ${fieldClassName()}`} name="outcome" defaultValue={outcome}>
            <option value="all">Any</option>
            <option value="success">Success</option>
            <option value="failure">Failure</option>
          </select>
        </label>
        <TextButton>Apply</TextButton>
      </form>
      {result.items.length === 0 ? <EmptyState title="No activity entries" detail="Events appear after a message is stored, processed, retried, or an exception is resolved." /> : (
        <div className="panel-strong overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-[13px]">
            <thead className="text-[12px] text-muted">
              <tr>
                <th className="py-2 pr-3 font-medium">Time</th>
                <th className="py-2 pr-3 font-medium">Action</th>
                <th className="py-2 pr-3 font-medium">Outcome</th>
                <th className="py-2 pr-3 font-medium">Actor</th>
                <th className="py-2 font-medium">Summary</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((entry) => (
                <tr key={entry.id} className="border-t border-line align-top">
                  <td className="py-2 pr-3 whitespace-nowrap text-muted tabular-nums">{formatDateTime(entry.createdAt)}</td>
                  <td className="py-2 pr-3">{entry.action.replaceAll("_", " ")}</td>
                  <td className={`py-2 pr-3 ${entry.outcome === "failure" ? "text-bad" : "text-good"}`}>{entry.outcome === "failure" ? "Failure" : "Success"}</td>
                  <td className="py-2 pr-3">{entry.actor}</td>
                  <td className="py-2">{entry.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager path="/activity" page={result.page} pageSize={result.pageSize} total={result.total} preserve={{ action, outcome: outcome === "all" ? "" : outcome }} />
    </section>
  );
}

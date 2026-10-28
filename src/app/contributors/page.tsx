import Link from "next/link";
import { BlockedState } from "@/components/blocked-state";
import { EmptyState, PageHeader, TextButton, fieldClassName } from "@/components/ui";
import { rankContributors } from "@/lib/analytics";
import { RANKING_METRIC } from "@/lib/copy";
import { dateInputToBounds, isoDateInIst } from "@/lib/format";
import { firstParam } from "@/lib/query";
import { loadWorkspace } from "@/lib/workspace";

export default async function ContributorsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const workspace = await loadWorkspace();
  if (workspace.kind !== "ready") return <BlockedState health={workspace.health} />;
  const params = await searchParams;
  const now = new Date();
  const today = isoDateInIst(now);
  const defaultFrom = isoDateInIst(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));
  const from = /^\d{4}-\d{2}-\d{2}$/.test(firstParam(params.from)) ? firstParam(params.from) : defaultFrom;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(firstParam(params.to)) ? firstParam(params.to) : today;
  const bounds = dateInputToBounds(from, to);
  const activity = bounds.start && bounds.end
    ? await workspace.repo.listActivity(bounds.start.toISOString(), bounds.end.toISOString())
    : { points: [], truncated: false };
  const ranked = rankContributors(activity.points);
  return (
    <section>
      <PageHeader title="Most Active Slack Contributors" description={RANKING_METRIC} />
      <p className="mb-4 text-[12px] text-muted">{workspace.mode === "demo" ? "Sample senders only." : "Stored senders only."} A sender is not treated as the salesperson responsible for a sale.</p>
      <form className="mb-4 grid gap-2 sm:grid-cols-[160px_160px_auto] sm:items-end" action="/contributors">
        <label className="text-[12px] text-muted">From
          <input className={`mt-1 ${fieldClassName()}`} type="date" name="from" defaultValue={from} />
        </label>
        <label className="text-[12px] text-muted">To
          <input className={`mt-1 ${fieldClassName()}`} type="date" name="to" defaultValue={to} />
        </label>
        <TextButton>Apply</TextButton>
      </form>
      {ranked.length === 0 ? <EmptyState title="No eligible messages" detail="Skipped messages and rows without a sender are left out of this ranking." /> : (
        <div className="panel-strong overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
            <thead className="text-[12px] text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Rank</th>
                <th className="px-3 py-2 font-medium">Sender</th>
                <th className="px-3 py-2 font-medium">Distinct messages</th>
                <th className="px-3 py-2 font-medium">Examples</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((person, index) => (
                <tr key={person.key} className="border-t border-line">
                  <td className="px-3 py-2 tabular-nums">{index + 1}</td>
                  <td className="px-3 py-2">{person.label}</td>
                  <td className="px-3 py-2 tabular-nums">{person.messages}</td>
                  <td className="px-3 py-2">
                    {person.sampleIds.map((id) => <Link key={id} href={`/inbox/${id}`} className="mr-3 text-info">Message</Link>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

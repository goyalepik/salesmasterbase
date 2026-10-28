import Link from "next/link";
import { BlockedState } from "@/components/blocked-state";
import { PageHeader } from "@/components/ui";
import { countStatus, distinctOrderReferences } from "@/lib/analytics";
import { istDayBounds } from "@/lib/format";
import { loadWorkspace } from "@/lib/workspace";

export default async function BriefingPage() {
  const workspace = await loadWorkspace();
  if (workspace.kind !== "ready") return <BlockedState health={workspace.health} />;
  const now = new Date();
  const today = istDayBounds(now);
  const yesterdayStart = new Date(today.start.getTime() - 24 * 60 * 60 * 1000);
  const [todayActivity, yesterdayActivity, exceptions] = await Promise.all([
    workspace.repo.listActivity(today.start.toISOString(), today.end.toISOString()),
    workspace.repo.listActivity(yesterdayStart.toISOString(), today.start.toISOString()),
    workspace.repo.listExceptions({ status: "open", type: "all", severity: "all", page: 1, pageSize: 8 }),
  ]);
  const todayCount = todayActivity.points.length;
  const yesterdayCount = yesterdayActivity.points.length;
  const change = todayCount - yesterdayCount;
  const followUps = exceptions.items.slice(0, 5);
  return (
    <section>
      <PageHeader
        title="Daily briefing"
        description="Counts are calculated from stored records for the current IST day. This page does not send email or Slack notifications."
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Received today", todayCount],
          ["Processed today", countStatus(todayActivity.points, "processed")],
          ["Needs review today", countStatus(todayActivity.points, "needs_review")],
          ["Failed today", countStatus(todayActivity.points, "failed")],
          ["Open exceptions", exceptions.total],
          ["Order references today", distinctOrderReferences(todayActivity.points)],
          ["Change versus yesterday", change],
          ["Yesterday", yesterdayCount],
        ].map(([label, value]) => (
          <div key={String(label)} className="panel px-4 py-3">
            <p className="text-[12px] text-muted">{label}</p>
            <p className="mt-1 text-[22px] font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[12px] leading-5 text-muted">
        {yesterdayCount === 0 && todayCount === 0 ? "There is not enough history to describe a trend." : `Message count changed by ${change} compared with yesterday.`}
        {" "}Order references are extracted labels, not confirmed orders. Payment mentions are not verified.
      </p>
      <div className="panel-strong mt-6 p-4">
        <h2 className="text-[13px] font-semibold">Suggested follow-ups</h2>
        {followUps.length === 0 ? <p className="mt-2 text-[13px] text-muted">No open exceptions in the first page of the queue.</p> : (
          <ul className="mt-3 space-y-2 text-[13px]">
            {followUps.map((item) => (
              <li key={item.id}>
                <Link href={`/inbox/${item.messageId}`} className="text-info">{item.reason}</Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-[13px]">
          <Link href="/assistant?q=Summarise%20this%20week%27s%20activity." className="text-info">Ask the assistant to summarise this week</Link>
        </p>
      </div>
    </section>
  );
}

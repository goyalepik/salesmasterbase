import { BlockedState } from "@/components/blocked-state";
import { EmptyState, PageHeader, TextButton, fieldClassName } from "@/components/ui";
import { RANKING_METRIC } from "@/lib/copy";
import { formatInrFromMinor, lastDaysBounds } from "@/lib/format";
import { incentiveBySender } from "@/lib/incentive";
import { firstParam } from "@/lib/query";
import { loadWorkspace } from "@/lib/workspace";

export default async function ContributorsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const workspace = await loadWorkspace();
  if (workspace.kind !== "ready") return <BlockedState health={workspace.health} />;
  const params = await searchParams;
  const five = lastDaysBounds(new Date(), 5);
  const [rows, aliases] = await Promise.all([
    workspace.repo.listSenderActivity(five.start.toISOString(), five.end.toISOString()),
    workspace.repo.senderAliases(),
  ]);
  const ranked = incentiveBySender(rows, aliases).filter((person) => person.orders > 0);
  const saved = firstParam(params.named) === "1";
  return (
    <section>
      <PageHeader title="Salespeople" description={RANKING_METRIC} />
      {saved ? <p className="mb-3 text-[13px]">Name saved. The last 5 days now use it.</p> : null}
      <p className="mb-4 text-[13px] text-muted">A person appears after a complete order. Type a name once when Slack only has an id.</p>
      {ranked.length === 0 ? <EmptyState title="No complete orders in the last 5 days" detail="Use New order. Half-written Slack lines are left out." /> : (
        <div className="panel-strong overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
            <thead className="text-[12px] text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Rank</th>
                <th className="px-3 py-2 font-medium">Salesperson</th>
                <th className="px-3 py-2 font-medium">Orders</th>
                <th className="px-3 py-2 font-medium">Offered price</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((person, index) => (
                <tr key={person.key} className="border-t border-line align-top">
                  <td className="px-3 py-2 tabular-nums">{index + 1}</td>
                  <td className="px-3 py-2">
                    {person.name ? <span className="block">{person.name}</span> : <span className="block text-warn">Name needed</span>}
                    {person.slackId ? <span className="block text-[11px] text-faint">{person.slackId}</span> : null}
                    {person.slackId && !person.name ? (
                      <form className="mt-2 flex gap-2" action="/api/senders/name" method="post">
                        <input type="hidden" name="senderId" value={person.slackId} />
                        <input className={fieldClassName()} name="name" required minLength={2} maxLength={60} placeholder="Salesperson name" aria-label={`Name for ${person.slackId}`} />
                        <TextButton>Save</TextButton>
                      </form>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{person.orders}</td>
                  <td className="px-3 py-2 tabular-nums">{person.offeredMinor != null ? formatInrFromMinor(person.offeredMinor) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

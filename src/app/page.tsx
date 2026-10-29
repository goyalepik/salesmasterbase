import { BlockedState } from "@/components/blocked-state";
import { OverviewScreen } from "@/components/overview-screen";
import { isoDateInIst, lastDaysBounds } from "@/lib/format";
import { incentiveBySender } from "@/lib/incentive";
import { loadWorkspace } from "@/lib/workspace";

export default async function OverviewPage() {
  const workspace = await loadWorkspace();
  if (workspace.kind !== "ready") return <BlockedState health={workspace.health} />;
  const now = new Date();
  const day = isoDateInIst(now);
  const five = lastDaysBounds(now, 5);
  const [overview, today, senders, aliases] = await Promise.all([
    workspace.repo.overview(now),
    workspace.repo.listMessages({ q: "", status: "all", channel: "", from: day, to: day, page: 1, pageSize: 12, view: "orders" }),
    workspace.repo.listSenderActivity(five.start.toISOString(), five.end.toISOString()),
    workspace.repo.senderAliases(),
  ]);
  return (
    <OverviewScreen
      overview={overview}
      health={workspace.health}
      nowIso={now.toISOString()}
      todayOrders={today.items}
      incentive={incentiveBySender(senders, aliases)}
    />
  );
}

import { BlockedState } from "@/components/blocked-state";
import { OverviewScreen } from "@/components/overview-screen";
import { chartRange } from "@/lib/analytics";
import { loadWorkspace } from "@/lib/workspace";

export default async function OverviewPage() {
  const workspace = await loadWorkspace();
  if (workspace.kind !== "ready") return <BlockedState health={workspace.health} />;
  const now = new Date();
  const range = chartRange(now, 7);
  const [overview, activity] = await Promise.all([
    workspace.repo.overview(now),
    workspace.repo.listActivity(range.fromIso, range.toIso),
  ]);
  return (
    <OverviewScreen
      overview={overview}
      health={workspace.health}
      points={activity.points}
      truncated={activity.truncated}
      nowIso={now.toISOString()}
    />
  );
}

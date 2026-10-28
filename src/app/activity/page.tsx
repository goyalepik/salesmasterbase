import { ActivityScreen } from "@/components/activity-screen";
import { BlockedState } from "@/components/blocked-state";
import { firstParam } from "@/lib/query";
import { PAGE_SIZE } from "@/lib/types";
import { loadWorkspace } from "@/lib/workspace";

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const workspace = await loadWorkspace();
  if (workspace.kind !== "ready") return <BlockedState health={workspace.health} />;
  const params = await searchParams;
  const outcomeRaw = firstParam(params.outcome);
  const outcome = outcomeRaw === "success" || outcomeRaw === "failure" ? outcomeRaw : "all";
  const action = firstParam(params.action);
  const page = Number(firstParam(params.page));
  const result = await workspace.repo.listAudit({
    action,
    outcome,
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: PAGE_SIZE,
  });
  return <ActivityScreen result={result} action={action} outcome={outcome} />;
}

import { BlockedState } from "@/components/blocked-state";
import { RecordsScreen } from "@/components/records-screen";
import { messageQuery } from "@/lib/query";
import { loadWorkspace } from "@/lib/workspace";

export default async function RecordsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const workspace = await loadWorkspace();
  if (workspace.kind !== "ready") return <BlockedState health={workspace.health} />;
  const query = messageQuery(await searchParams);
  const result = await workspace.repo.listRecords(query);
  return <RecordsScreen result={result} query={query} />;
}

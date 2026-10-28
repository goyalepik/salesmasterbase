import { BlockedState } from "@/components/blocked-state";
import { ExceptionsScreen } from "@/components/exceptions-screen";
import { exceptionQuery } from "@/lib/query";
import { loadWorkspace } from "@/lib/workspace";

export default async function ExceptionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const workspace = await loadWorkspace();
  if (workspace.kind !== "ready") return <BlockedState health={workspace.health} />;
  const query = exceptionQuery(await searchParams);
  const result = await workspace.repo.listExceptions(query);
  return <ExceptionsScreen result={result} query={query} />;
}

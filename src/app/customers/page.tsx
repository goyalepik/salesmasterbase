import { BlockedState } from "@/components/blocked-state";
import { CustomersScreen } from "@/components/customers-screen";
import { RefreshOnChange } from "@/components/live-provider";
import { firstParam, sanitizeSearch } from "@/lib/query";
import { loadWorkspace } from "@/lib/workspace";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const workspace = await loadWorkspace();
  if (workspace.kind !== "ready") return <BlockedState health={workspace.health} />;
  const params = await searchParams;
  const q = sanitizeSearch(firstParam(params.q));
  const groups = await workspace.repo.lookupCustomers(q);
  return (
    <>
      <RefreshOnChange />
      <CustomersScreen query={q} groups={groups} />
    </>
  );
}

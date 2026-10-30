import { SettingsScreen } from "@/components/settings-screen";
import { TeamRoles } from "@/components/ops/team-roles";
import { getOpsStore } from "@/lib/ops";
import { firstParam } from "@/lib/query";
import { inspectHealth } from "@/lib/health";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ report }, params, store] = await Promise.all([inspectHealth(), searchParams, getOpsStore()]);
  const people = store ? await store.people() : null;
  return (
    <>
      <SettingsScreen health={report} namesStatus={firstParam(params.names)} namesCount={firstParam(params.count)} buttonStatus={firstParam(params.button)} />
      <div className="mt-8">{people ? <TeamRoles people={people} /> : <p className="text-[13px] text-muted">Team roles can be set once the database is configured.</p>}</div>
    </>
  );
}

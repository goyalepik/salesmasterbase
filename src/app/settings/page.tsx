import { SettingsScreen } from "@/components/settings-screen";
import { firstParam } from "@/lib/query";
import { loadWorkspace } from "@/lib/workspace";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const workspace = await loadWorkspace();
  const params = await searchParams;
  return <SettingsScreen health={workspace.health} namesStatus={firstParam(params.names)} namesCount={firstParam(params.count)} />;
}

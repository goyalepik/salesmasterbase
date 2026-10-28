import { SettingsScreen } from "@/components/settings-screen";
import { loadWorkspace } from "@/lib/workspace";

export default async function SettingsPage() {
  const workspace = await loadWorkspace();
  return <SettingsScreen health={workspace.health} />;
}

import { BlockedState } from "@/components/blocked-state";
import { AssistantScreen } from "@/components/assistant-screen";
import { assistantStatus } from "@/lib/ai/runtime";
import { firstParam } from "@/lib/query";
import { loadWorkspace } from "@/lib/workspace";

export default async function AssistantPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const workspace = await loadWorkspace();
  if (workspace.kind !== "ready") return <BlockedState health={workspace.health} />;
  const params = await searchParams;
  return <AssistantScreen initialQuestion={firstParam(params.q).slice(0, 500)} status={assistantStatus()} />;
}

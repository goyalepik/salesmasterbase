import "server-only";

import { getOpsStore } from "@/lib/ops";
import type { OpsStore } from "@/lib/ops/store";
import { loadWorkspace, type Workspace } from "@/lib/workspace";

export type OpsContext =
  | { kind: "ready"; workspace: Extract<Workspace, { kind: "ready" }>; store: OpsStore }
  | { kind: "blocked"; workspace: Workspace };

/** Workspace plus the operations store. Blocked when either is unavailable. */
export async function loadOps(): Promise<OpsContext> {
  const workspace = await loadWorkspace();
  if (workspace.kind !== "ready") return { kind: "blocked", workspace };
  const store = await getOpsStore();
  if (!store) return { kind: "blocked", workspace: { kind: "blocked", health: workspace.health } };
  return { kind: "ready", workspace, store };
}

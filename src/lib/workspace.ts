import "server-only";

import { cache } from "react";
import { connection } from "next/server";
import { inspectHealth, type HealthReport } from "@/lib/health";
import type { OpsRepository } from "@/lib/repository";

export type Workspace =
  | { kind: "ready"; mode: "demo" | "live"; repo: OpsRepository; health: HealthReport }
  | { kind: "blocked"; health: HealthReport };

export const loadWorkspace = cache(async (): Promise<Workspace> => {
  await connection();
  const { report, repo } = await inspectHealth();
  if (!repo || report.source === "misconfigured" || report.source === "unavailable") {
    return { kind: "blocked", health: report };
  }
  return { kind: "ready", mode: report.source === "live" ? "live" : "demo", repo, health: report };
});

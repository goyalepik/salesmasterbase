import keywords from "../config/keywords.json";
import policy from "../config/policy.json";
import queues from "../config/queues.json";
import sla from "../config/sla.json";
import taxonomy from "../config/taxonomy.json";
import users from "../config/users.json";
import type { Agent, Level, Priority, Queue, Role, TicketType } from "./types";

export type Scenario = {
  id: string;
  bucket: string;
  name: string;
  type: TicketType;
  priority: Priority;
  queue: string;
  l0?: boolean;
  level?: Level;
  excludeFromCx?: boolean;
};

export const BUCKETS: Array<{ id: string; name: string }> = taxonomy.buckets;
export const SCENARIOS = taxonomy.scenarios as Scenario[];
export const SCENARIO = new Map(SCENARIOS.map((s) => [s.id, s]));

export function scenario(id: string): Scenario {
  const found = SCENARIO.get(id);
  if (!found) throw new Error(`Unknown scenario ${id}`);
  return found;
}

export const QUEUES: Queue[] = queues.queues.map((q) => ({
  ...q,
  level: q.level as Level,
  scenarioIds: SCENARIOS.filter((s) => s.queue === q.id).map((s) => s.id),
}));
export const QUEUE = new Map(QUEUES.map((q) => [q.id, q]));
/** "L1" → "l1": rights and roles use the lower-case level. */
export function roleOfLevel(level: string): Role {
  const r = level.toLowerCase();
  return (["l1", "l2", "l3", "admin", "viewer"].includes(r) ? r : "viewer") as Role;
}

/** The roster from config. Admin overrides (Settings) are merged on the server (server/roster.ts). */
export const ROSTER: Agent[] = users.roster.map((u) => ({ id: u.id, name: u.name, role: roleOfLevel(u.level), department: u.department, queueIds: u.queues, active: u.active }));
export const AGENTS: Agent[] = ROSTER;
export const AGENT = new Map(AGENTS.map((a) => [a.id, a]));

export const KEYWORDS = keywords;
export const POLICY = policy;
export const SLA = sla as { atRiskShare: number; vipFactor: number; targets: Record<Priority, { firstResponse: number; resolution: number; callback: number }> };

export const PRIORITY_RANK: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

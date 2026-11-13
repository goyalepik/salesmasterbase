import rights from "../config/rights.json";
import type { Role, Ticket } from "./types";

// What each level may do (v5 section 4.2). Rights depend on the level only; ":own" rights apply to tickets in the
// person's own department queues or that they hold. Checked on the server for every action; the UI hides what you can't do.

export type Capability =
  | "view" | "work" | "forward" | "assign" | "send_back_l1" | "escalate_l3" | "send_down" | "classify" | "classify_category"
  | "resolve" | "merge" | "reveal_phone" | "decide" | "settings" | "import" | "label_gold" | "sync" | "simulate";

export type RightsActor = { id: string; role: Role; queueIds?: string[] };

const TABLE = rights as unknown as Record<Role, string[]>;

/** Whether this person may do `cap`, on this ticket when the right is limited to their own tickets. */
export function can(actor: RightsActor, cap: Capability, ticket?: Pick<Ticket, "queueId" | "ownerId"> | null): boolean {
  const list = TABLE[actor.role] ?? [];
  if (list.includes("*") || list.includes(cap)) return true;
  if (!list.includes(`${cap}:own`)) return false;
  if (!ticket) return true;
  return ticket.ownerId === actor.id || (actor.queueIds ?? []).includes(ticket.queueId);
}

/** Every right this person has in general (the UI uses it to hide buttons). ":own" rights count as had. */
export function rightsOf(role: Role): Capability[] {
  const list = TABLE[role] ?? [];
  if (list.includes("*")) return ["view", "work", "forward", "assign", "send_back_l1", "escalate_l3", "send_down", "classify", "classify_category", "resolve", "merge", "reveal_phone", "decide", "settings", "import", "label_gold", "sync", "simulate"];
  return [...new Set(list.map((r) => r.replace(/:own$/, "") as Capability))];
}

/** Thrown when a level tries something its rights don't allow. The API answers 403 and writes nothing. */
export class ForbiddenError extends Error {}

export function assertCan(actor: RightsActor, cap: Capability, ticket?: Pick<Ticket, "queueId" | "ownerId"> | null, what = "do this"): void {
  if (can(actor, cap, ticket)) return;
  // Allowed in general but not on this ticket: it belongs to another department.
  if (ticket && can(actor, cap)) throw new ForbiddenError("This ticket belongs to another department. You can act only on your department's tickets, or ones you hold.");
  throw new ForbiddenError(`Your level cannot ${what}.`);
}

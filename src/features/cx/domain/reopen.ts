import { POLICY } from "./config";
import type { Ticket } from "./types";

const DAY = 86_400_000;

export type ReopenDecision = { action: "reopen"; ticketId: string } | { action: "new"; relatedTicketId?: string };

/**
 * Same customer, same issue, same order, closed within 7 days → reopen that ticket.
 * A different issue, even on the same order (EMI first, then delivery), is a new ticket linked to the customer.
 */
export function decideReopen(incoming: { customerUid: string; scenarioId: string; orderRef?: string }, existing: Ticket[], now: Date): ReopenDecision {
  const mine = existing
    .filter((t) => t.customerUid === incoming.customerUid)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const match = mine.find((t) => {
    if (t.status !== "resolved" && t.status !== "closed") return false;
    const closedAt = t.closedAt ?? t.resolvedAt;
    if (!closedAt || now.getTime() - new Date(closedAt).getTime() > POLICY.reopenWindowDays * DAY) return false;
    if (t.scenarioId !== incoming.scenarioId) return false;
    // With order numbers on both sides they must agree; without them, the same scenario is the same issue.
    if (t.orderRef && incoming.orderRef) return t.orderRef === incoming.orderRef;
    return true;
  });
  if (match) return { action: "reopen", ticketId: match.id };
  const sameOrder = incoming.orderRef ? mine.find((t) => t.orderRef === incoming.orderRef) : undefined;
  return { action: "new", relatedTicketId: sameOrder?.id };
}

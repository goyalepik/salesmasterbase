import { SLA } from "./config";
import type { Channel, Priority, Ticket, TicketEvent } from "./types";

const MIN = 60_000;

/** First-response and resolution due times. Calls use the callback target for the first response. */
export function dueDates(priority: Priority, createdAt: string, channel: Channel, vip = false): { firstResponseDueAt: string; resolutionDueAt: string } {
  const t = SLA.targets[priority];
  const factor = vip ? SLA.vipFactor : 1;
  const created = new Date(createdAt).getTime();
  const first = channel === "call" || channel === "missed_call" ? t.callback : t.firstResponse;
  return {
    firstResponseDueAt: new Date(created + first * factor * MIN).toISOString(),
    resolutionDueAt: new Date(created + t.resolution * factor * MIN).toISOString(),
  };
}

/** Time spent on hold waiting on a brand or third party. The SLA clock pauses for it. */
export function pausedMs(events: TicketEvent[], now: Date): number {
  let total = 0;
  let since: number | null = null;
  for (const e of [...events].sort((a, b) => a.at.localeCompare(b.at))) {
    if (e.kind === "hold_started" && e.payload.reason === "brand" && since === null) since = new Date(e.at).getTime();
    if (e.kind === "hold_ended" && since !== null) {
      total += new Date(e.at).getTime() - since;
      since = null;
    }
  }
  if (since !== null) total += now.getTime() - since;
  return total;
}

export type SlaState = { state: "ok" | "at_risk" | "breached" | "met"; share: number; remainingMs: number; clock: "first_response" | "resolution" };

/**
 * Where the ticket stands against its SLA right now. At risk from 80% used.
 * The clock pauses while on brand hold. Pending-customer does not pause a P0.
 */
export function slaState(ticket: Pick<Ticket, "createdAt" | "slaFirstResponseDueAt" | "slaResolutionDueAt" | "firstResponseAt" | "resolvedAt" | "status" | "slaPausedMs" | "slaPausedSince">, events: TicketEvent[], now: Date): SlaState {
  const created = new Date(ticket.createdAt).getTime();
  const done = ticket.status === "resolved" || ticket.status === "closed";
  const end = done && ticket.resolvedAt ? new Date(ticket.resolvedAt).getTime() : now.getTime();
  const at = done && ticket.resolvedAt ? new Date(ticket.resolvedAt) : now;
  // The ticket keeps its own pause totals (lists have no events); events are the fallback for older tickets.
  const kept = ticket.slaPausedMs !== undefined || ticket.slaPausedSince !== undefined;
  const paused = kept ? (ticket.slaPausedMs ?? 0) + (ticket.slaPausedSince ? Math.max(0, at.getTime() - new Date(ticket.slaPausedSince).getTime()) : 0) : pausedMs(events, at);
  const measure = (due: string, stop: number) => {
    const budget = new Date(due).getTime() - created;
    const used = Math.max(0, stop - created - paused);
    return { share: budget > 0 ? used / budget : 1, remainingMs: budget - used };
  };
  const resolution = measure(ticket.slaResolutionDueAt, end);
  const first = ticket.firstResponseAt ? null : measure(ticket.slaFirstResponseDueAt, end);
  const worst = first && first.share > resolution.share ? { ...first, clock: "first_response" as const } : { ...resolution, clock: "resolution" as const };
  if (done) return { state: resolution.share <= 1 ? "met" : "breached", share: resolution.share, remainingMs: resolution.remainingMs, clock: "resolution" };
  const state = worst.share >= 1 ? "breached" : worst.share >= SLA.atRiskShare ? "at_risk" : "ok";
  return { state, share: worst.share, remainingMs: worst.remainingMs, clock: worst.clock };
}

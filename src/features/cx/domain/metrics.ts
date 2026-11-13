import { pausedMs } from "./sla";
import type { TicketEvent } from "./types";

const sorted = (events: TicketEvent[]) => [...events].sort((a, b) => a.at.localeCompare(b.at));
const ms = (at: string) => new Date(at).getTime();

/** When the customer first wrote: their first message, else ticket creation. */
function firstCustomerAt(list: TicketEvent[]): number | null {
  const msg = list.find((e) => e.kind === "message" && e.payload.author === "customer");
  const created = list.find((e) => e.kind === "created");
  const at = msg ?? created;
  return at ? ms(at.at) : null;
}

/** A person answered: a human message (Sagepilot agent or our reply), or a call that connected. The AI never counts. */
export function isHumanReply(e: TicketEvent): boolean {
  if (e.kind === "message") return e.payload.author === "agent";
  if (e.kind === "agent_replied") return e.actorId !== "ai" && !(e.actorId === "sagepilot" && /\bAI\b/.test(String(e.payload.text ?? "")));
  if (e.kind === "outbound_call_logged") return e.payload.outcome === "connected";
  return false;
}

/** First response time (v5 9): the customer's first message → the first HUMAN reply or a connected call. */
export function frtMs(events: TicketEvent[]): number | null {
  const list = sorted(events);
  const start = firstCustomerAt(list);
  const reply = list.find((e) => isHumanReply(e) && (start === null || ms(e.at) >= start));
  return start !== null && reply ? ms(reply.at) - start : null;
}

/** AI first reply time: the customer's first message → Aliya's first reply. Shown apart from FRT. */
export function aiFirstReplyMs(events: TicketEvent[]): number | null {
  const list = sorted(events);
  const start = firstCustomerAt(list);
  const reply = list.find((e) => ((e.kind === "message" && e.payload.author === "ai") || (e.kind === "agent_replied" && e.actorId === "ai")) && (start === null || ms(e.at) >= start));
  return start !== null && reply ? ms(reply.at) - start : null;
}

/** Total hold time (any reason). Counts in ART, never in AHT. */
export function holdMs(events: TicketEvent[], now: Date): number {
  let total = 0;
  let since: number | null = null;
  for (const e of sorted(events)) {
    if (e.kind === "hold_started" && since === null) since = ms(e.at);
    if (e.kind === "hold_ended" && since !== null) { total += ms(e.at) - since; since = null; }
  }
  return since !== null ? total + now.getTime() - since : total;
}

/**
 * Handling time per person: only while they are actively working (after "Start work", taking ownership or a reply),
 * until they stop, hand over, put it on hold, or resolve. Opening a ticket alone is not work.
 */
export function ahtByPerson(events: TicketEvent[], now: Date): Record<string, number> {
  const totals: Record<string, number> = {};
  const open = new Map<string, number>();
  const stop = (actor: string, at: number) => {
    const start = open.get(actor);
    if (start === undefined) return;
    totals[actor] = (totals[actor] ?? 0) + Math.max(0, at - start);
    open.delete(actor);
  };
  const stopAll = (at: number) => [...open.keys()].forEach((a) => stop(a, at));
  for (const e of sorted(events)) {
    const at = ms(e.at);
    switch (e.kind) {
      case "ownership_taken":
      case "work_started":
        if (!open.has(e.actorId)) open.set(e.actorId, at);
        break;
      case "agent_replied":
        if (e.actorId !== "ai" && e.actorId !== "sagepilot" && !open.has(e.actorId)) open.set(e.actorId, at);
        break;
      case "work_stopped":
        stop(e.actorId, at);
        break;
      case "assigned":
        // Handing over ends the current worker's time; the new owner starts when they start work.
        stopAll(at);
        break;
      case "hold_started":
      case "resolved":
      case "closed":
        stopAll(at);
        break;
    }
  }
  stopAll(now.getTime());
  return totals;
}

export function ahtMs(events: TicketEvent[], now: Date): number {
  return Object.values(ahtByPerson(events, now)).reduce((a, b) => a + b, 0);
}

/**
 * Average resolution time for one ticket: created to final close, end to end. A reopen does not restart it.
 * Null while the ticket is still open.
 */
export function artMs(events: TicketEvent[]): { total: number; excludingHold: number } | null {
  const list = sorted(events);
  const created = list.find((e) => e.kind === "created");
  const lastDone = [...list].reverse().find((e) => e.kind === "resolved" || e.kind === "closed");
  const reopenedAfter = lastDone && list.some((e) => e.kind === "reopened" && e.at > lastDone.at);
  if (!created || !lastDone || reopenedAfter) return null;
  const total = ms(lastDone.at) - ms(created.at);
  return { total, excludingHold: total - holdMs(list.filter((e) => e.at <= lastDone.at), new Date(lastDone.at)) };
}

export function reopenCount(events: TicketEvent[]): number {
  return events.filter((e) => e.kind === "reopened").length;
}

export { pausedMs };

import type { CxRepository } from "../data/repository";
import { classify } from "./classifier";
import { AGENT, QUEUE, scenario } from "./config";
import { route } from "./routing";
import { decideReopen } from "./reopen";
import { dueDates } from "./sla";
import type { Channel, Classification, EventKind, HoldReason, LeadOutcome, Priority, Role, Routing, Ticket, TicketEvent } from "./types";

// Every change to a CX ticket goes through here: it checks the role, updates the ticket and writes an event.

export class CxError extends Error {}

export type Actor = { id: string; role: Role };
export const AI: Actor = { id: "ai", role: "admin" };
const SYSTEM: Actor = { id: "system", role: "admin" };
const DAY = 86_400_000;

let counter = 0;
const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function normalisePhone(raw: string | undefined | null): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  const ten = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits.length === 11 && digits.startsWith("0") ? digits.slice(1) : digits;
  return /^[6-9]\d{9}$/.test(ten) ? `+91${ten}` : null;
}

/** "+91 98•••• 4417" for everyone except L1 and admin. */
export function maskPhone(uidOrPhone: string, role: Role): string {
  if (!uidOrPhone.startsWith("+91")) return uidOrPhone.startsWith("unidentified") ? "Unidentified" : uidOrPhone;
  const d = uidOrPhone.slice(3);
  if (role === "l1" || role === "admin") return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
  return `+91 ${d.slice(0, 2)}•••• ${d.slice(6)}`;
}

async function event(repo: CxRepository, ticketId: string, actor: Actor, kind: EventKind, at: Date, payload: Record<string, unknown> = {}) {
  const e: TicketEvent = { id: uid(), ticketId, at: at.toISOString(), actorId: actor.id, kind, payload };
  await repo.appendEvent(e);
  return e;
}

async function nextTicketId(repo: CxRepository): Promise<string> {
  const all = await repo.listTickets();
  const max = all.reduce((m, t) => Math.max(m, Number(t.id.replace(/\D/g, "")) || 0), 10000);
  return `CX-${max + 1}`;
}

export type IncomingMessage = {
  channel: Channel;
  text?: string;
  phone?: string;
  name?: string;
  handle?: string;
  orderRef?: string;
  at?: Date;
  /** A comment under a public Facebook/Instagram post: everyone can see it. */
  publicComment?: boolean;
};

export type IngestResult = { ticket: Ticket; reopened: boolean; mergedIntoCallback: boolean; classification: Classification; routing: Routing };

/**
 * Turns one inbound interaction into a ticket: identify the customer, classify, route, set the SLA, write the events.
 * Same issue on the same order within 7 days reopens the old ticket. A missed call joins an open callback ticket.
 */
export async function ingest(repo: CxRepository, msg: IncomingMessage, now: Date = msg.at ?? new Date()): Promise<IngestResult> {
  const text = (msg.text ?? "").trim() || (msg.channel === "missed_call" ? "Missed call" : "");
  const classification = classify({ text, channel: msg.channel, publicComment: msg.publicComment });
  const phone = normalisePhone(msg.phone) ?? normalisePhone(classification.entities.phone);
  const customerUid = phone ?? `unidentified:${msg.channel}:${(msg.handle || msg.name || uid()).toLowerCase().replace(/\s+/g, "_")}`;
  const at = now.toISOString();

  const existing = await repo.getCustomer(customerUid);
  const handles = [...(existing?.handles ?? [])];
  if (msg.handle && !handles.some((h) => h.channel === msg.channel && h.handle === msg.handle)) handles.push({ channel: msg.channel, handle: msg.handle });
  const flags = new Set(existing?.flags ?? []);
  if (!phone) flags.add("unidentified");
  if (classification.entities.codEligible === false && classification.entities.pincodeValid) flags.add("outside_cod_zone");
  await repo.saveCustomer({ uid: customerUid, name: existing?.name ?? msg.name, handles, firstSeenAt: existing?.firstSeenAt ?? at, flags: [...flags], csat: existing?.csat });
  await repo.addInteraction({ id: uid(), channel: msg.channel, direction: "inbound", customerUid, text: text || undefined, at, source: "manual" });

  const since = now.getTime() - 7 * DAY;
  const interactions = (await repo.listInteractions(customerUid)).filter((i) => new Date(i.at).getTime() >= since);
  if (msg.channel === "missed_call") await repo.addCall({ id: uid(), customerUid, at, direction: "inbound", outcome: "missed", durationSec: 0 });
  const missedCalls = (await repo.listCalls(customerUid)).filter((c) => c.outcome === "missed" && new Date(c.at).getTime() >= since).length;
  const mine = (await repo.listTickets()).filter((t) => t.customerUid === customerUid);
  const sameIssueCount = mine.filter((t) => t.scenarioId === classification.scenarioId && now.getTime() - new Date(t.createdAt).getTime() <= 30 * DAY).length + 1;
  const routing = route(classification, { customerFlags: [...flags], contactCount: interactions.length, sameIssueCount, missedCalls });
  const orderRef = msg.orderRef ?? classification.entities.orderRefs[0];

  // A missed call joins the open callback ticket for that number, and can push its priority up.
  if (msg.channel === "missed_call") {
    const open = mine.find((t) => t.scenarioId === "K1" && t.status !== "resolved" && t.status !== "closed");
    if (open) {
      const updated: Ticket = { ...open, priority: routing.priority, label: routing.label, contactCount: interactions.length, warnings: [...new Set([...open.warnings, ...routing.warnings, ...(routing.flags.includes("must_be_human") ? ["Called 3+ times: a person must call back now."] : [])])] };
      Object.assign(updated, dueDatesFor(updated, routing));
      await repo.saveTicket(updated);
      await event(repo, open.id, SYSTEM, "customer_replied", now, { channel: "missed_call", missedCalls });
      if (open.priority !== routing.priority) await event(repo, open.id, SYSTEM, "priority_changed", now, { from: open.priority, to: routing.priority, reason: `${missedCalls} missed calls` });
      return { ticket: updated, reopened: false, mergedIntoCallback: true, classification, routing };
    }
  }

  const decision = decideReopen({ customerUid, scenarioId: classification.scenarioId, orderRef }, mine, now);
  if (decision.action === "reopen") {
    const old = mine.find((t) => t.id === decision.ticketId)!;
    const reopened: Ticket = { ...old, status: "reopened", reopenCount: old.reopenCount + 1, resolvedAt: undefined, closedAt: undefined, body: `${old.body}\n\n— ${at.slice(0, 10)}: ${text}`, level: old.level === "L0" ? "L1" : old.level, contactCount: interactions.length };
    await repo.saveTicket(reopened);
    await event(repo, old.id, SYSTEM, "reopened", now, { reason: "Same customer raised the same issue again within 7 days." });
    await event(repo, old.id, SYSTEM, "customer_replied", now, { channel: msg.channel, text });
    return { ticket: reopened, reopened: true, mergedIntoCallback: false, classification, routing };
  }

  const s = scenario(classification.scenarioId);
  const id = await nextTicketId(repo);
  const ticket: Ticket = {
    id,
    customerUid,
    channel: msg.channel,
    createdAt: at,
    subject: subjectFor(text, s.name, msg.channel),
    body: text,
    bucket: classification.bucket,
    scenarioId: classification.scenarioId,
    secondaryScenarioIds: classification.secondaryScenarioIds,
    type: classification.type,
    priority: routing.priority,
    label: routing.label,
    level: routing.level,
    queueId: routing.queueId,
    ownerId: routing.level === "L1" ? "khadija" : routing.level === "L3" ? "ceo" : undefined,
    status: "new",
    orderRef,
    entities: classification.entities,
    confidence: classification.confidence,
    explanation: [...classification.explanation, ...routing.explanation],
    warnings: [...routing.warnings, ...(routing.flags.includes("must_be_human") ? ["Called 3+ times: a person must call back now."] : [])],
    sentiment: classification.sentiment,
    contactCount: interactions.length,
    slaFirstResponseDueAt: "",
    slaResolutionDueAt: "",
    reopenCount: 0,
    parentTicketId: decision.relatedTicketId,
  };
  Object.assign(ticket, dueDatesFor(ticket, routing));
  await repo.saveTicket(ticket);
  await event(repo, id, SYSTEM, "created", now, { channel: msg.channel });
  await event(repo, id, AI, "classified", now, { scenarioId: ticket.scenarioId, priority: ticket.priority, level: ticket.level, queueId: ticket.queueId, confidence: ticket.confidence });

  if (routing.autoResolvable) {
    // L0: the AI answers simple information requests. In the pilot this is only recorded, nothing is sent.
    const done = new Date(now.getTime() + 60_000);
    const closed: Ticket = { ...ticket, status: "closed", firstResponseAt: done.toISOString(), resolvedAt: done.toISOString(), closedAt: done.toISOString(), closeReason: "Information given (L0)" };
    await repo.saveTicket(closed);
    await event(repo, id, AI, "agent_replied", done, { text: "Information given", simulated: true });
    await event(repo, id, AI, "resolved", done, { comment: "Information given by the AI.", closeReason: "information_given", resolutionType: "informative" });
    await event(repo, id, AI, "closed", done, {});
    return { ticket: closed, reopened: false, mergedIntoCallback: false, classification, routing };
  }
  return { ticket, reopened: false, mergedIntoCallback: false, classification, routing };
}

function dueDatesFor(t: Pick<Ticket, "priority" | "createdAt" | "channel">, routing: Pick<Routing, "flags">) {
  const d = dueDates(t.priority, t.createdAt, t.channel, routing.flags.includes("vip"));
  return { slaFirstResponseDueAt: d.firstResponseDueAt, slaResolutionDueAt: d.resolutionDueAt };
}

function subjectFor(text: string, scenarioName: string, channel: Channel): string {
  if (channel === "missed_call") return "Missed call: call back";
  const first = text.split(/(?<=[.!?])\s|\n/)[0]?.trim() ?? "";
  return first.length > 4 ? (first.length > 90 ? `${first.slice(0, 87)}…` : first) : scenarioName;
}

// --- Actions -----------------------------------------------------------------------------------------

async function load(repo: CxRepository, id: string, actor: Actor): Promise<Ticket> {
  if (actor.role === "viewer") throw new CxError("Viewers can look but not change tickets.");
  const t = await repo.getTicket(id);
  if (!t) throw new CxError("Ticket not found.");
  return t;
}

const OPEN = (t: Ticket) => t.status !== "resolved" && t.status !== "closed";

export async function takeOwnership(repo: CxRepository, id: string, actor: Actor, now: Date) {
  const t = await load(repo, id, actor);
  await repo.saveTicket({ ...t, ownerId: actor.id, status: OPEN(t) ? "in_progress" : t.status });
  await event(repo, id, actor, "ownership_taken", now);
}

export async function startWork(repo: CxRepository, id: string, actor: Actor, now: Date) {
  const t = await load(repo, id, actor);
  if (!OPEN(t)) throw new CxError("This ticket is closed. Reopen it first.");
  await repo.saveTicket({ ...t, status: "in_progress", ownerId: t.ownerId ?? actor.id });
  await event(repo, id, actor, "work_started", now);
}

export async function stopWork(repo: CxRepository, id: string, actor: Actor, now: Date) {
  await load(repo, id, actor);
  await event(repo, id, actor, "work_stopped", now);
}

export async function assign(repo: CxRepository, id: string, queueId: string, actor: Actor, now: Date) {
  const t = await load(repo, id, actor);
  const q = QUEUE.get(queueId);
  if (!q) throw new CxError("Unknown queue.");
  const level = q.level;
  await repo.saveTicket({ ...t, queueId, level, ownerId: q.ownerId, status: t.status === "new" ? "open" : t.status });
  await event(repo, id, actor, "assigned", now, { queueId, ownerId: q.ownerId });
  if (level !== t.level) await event(repo, id, actor, "level_changed", now, { from: t.level, to: level });
}

export async function sendBackToL1(repo: CxRepository, id: string, actor: Actor, now: Date, reason = "") {
  const t = await load(repo, id, actor);
  await repo.saveTicket({ ...t, level: "L1", ownerId: "khadija" });
  await event(repo, id, actor, "level_changed", now, { from: t.level, to: "L1", reason });
}

export async function escalateToL3(repo: CxRepository, id: string, reason: string, actor: Actor, now: Date) {
  if (!reason.trim()) throw new CxError("Say why this needs the CEO.");
  const t = await load(repo, id, actor);
  await repo.saveTicket({ ...t, level: "L3", ownerId: "ceo" });
  await event(repo, id, actor, "level_changed", now, { from: t.level, to: "L3", reason: reason.trim() });
}

/** A person changing the AI's priority or label. Stored as a training label: who, when, old, new. */
export async function override(repo: CxRepository, id: string, change: { priority?: Priority; label?: Ticket["label"] }, actor: Actor, now: Date) {
  const t = await load(repo, id, actor);
  const next = { ...t, ...change };
  if (change.priority && change.priority !== t.priority) {
    Object.assign(next, dueDatesFor({ ...next, priority: change.priority }, { flags: t.label === "VIP" ? ["vip"] : [] }));
    await event(repo, id, actor, "priority_changed", now, { from: t.priority, to: change.priority });
  }
  await repo.saveTicket(next);
  await event(repo, id, actor, "override", now, { old: { priority: t.priority, label: t.label }, new: { priority: next.priority, label: next.label } });
}

export async function hold(repo: CxRepository, id: string, reason: HoldReason, actor: Actor, now: Date) {
  const t = await load(repo, id, actor);
  if (!OPEN(t)) throw new CxError("This ticket is closed.");
  await repo.saveTicket({ ...t, status: "on_hold", holdReason: reason });
  await event(repo, id, actor, "hold_started", now, { reason });
}

export async function resume(repo: CxRepository, id: string, actor: Actor, now: Date) {
  const t = await load(repo, id, actor);
  if (t.status !== "on_hold") throw new CxError("This ticket is not on hold.");
  await repo.saveTicket({ ...t, status: "in_progress", holdReason: undefined });
  await event(repo, id, actor, "hold_ended", now, {});
}

export async function reply(repo: CxRepository, id: string, text: string, actor: Actor, now: Date) {
  if (!text.trim()) throw new CxError("Write the reply first.");
  const t = await load(repo, id, actor);
  await repo.saveTicket({ ...t, firstResponseAt: t.firstResponseAt ?? now.toISOString(), status: OPEN(t) ? "in_progress" : t.status });
  await event(repo, id, actor, "agent_replied", now, { text: text.trim(), simulated: true });
}

export async function addNote(repo: CxRepository, id: string, text: string, actor: Actor, now: Date) {
  if (!text.trim()) throw new CxError("Write the note first.");
  await load(repo, id, actor);
  await event(repo, id, actor, "note_added", now, { text: text.trim() });
}

export const CLOSE_REASONS = ["Information given", "Action done", "Order placed", "Refund processed", "Replacement arranged", "Duplicate", "Customer unreachable", "Not a customer request"] as const;

/** Closing always needs a comment and a reason. */
export async function resolve(repo: CxRepository, id: string, input: { comment: string; closeReason: string; resolutionType: "informative" | "actionable" }, actor: Actor, now: Date) {
  if (!input.comment.trim()) throw new CxError("Add a closing comment: what was done for the customer.");
  if (!input.closeReason) throw new CxError("Pick a close reason.");
  const t = await load(repo, id, actor);
  if (!OPEN(t)) throw new CxError("Already closed.");
  const at = now.toISOString();
  await repo.saveTicket({ ...t, status: "closed", resolvedAt: at, closedAt: at, closeReason: input.closeReason, holdReason: undefined });
  if (t.status === "on_hold") await event(repo, id, actor, "hold_ended", now, {});
  await event(repo, id, actor, "resolved", now, { comment: input.comment.trim(), closeReason: input.closeReason, resolutionType: input.resolutionType });
  await event(repo, id, actor, "closed", now, {});
}

export async function reopen(repo: CxRepository, id: string, reason: string, actor: Actor, now: Date) {
  const t = await load(repo, id, actor);
  if (OPEN(t)) throw new CxError("This ticket is still open.");
  await repo.saveTicket({ ...t, status: "reopened", reopenCount: t.reopenCount + 1, resolvedAt: undefined, closedAt: undefined, level: t.level === "L0" ? "L1" : t.level });
  await event(repo, id, actor, "reopened", now, { reason: reason.trim() || "Reopened by agent" });
}

export async function logOutboundCall(repo: CxRepository, id: string, outcome: "connected" | "not_connected", actor: Actor, now: Date) {
  const t = await load(repo, id, actor);
  await repo.addCall({ id: uid(), customerUid: t.customerUid, at: now.toISOString(), direction: "outbound", outcome, durationSec: outcome === "connected" ? 120 : 0 });
  if (outcome === "connected") await repo.saveTicket({ ...t, firstResponseAt: t.firstResponseAt ?? now.toISOString() });
  await event(repo, id, actor, "outbound_call_logged", now, { outcome });
  if (outcome === "connected") await event(repo, id, actor, "agent_replied", now, { text: "Called the customer", channel: "call" });
}

export async function setLeadOutcome(repo: CxRepository, id: string, outcome: LeadOutcome, actor: Actor, now: Date) {
  const t = await load(repo, id, actor);
  await repo.saveTicket({ ...t, leadOutcome: outcome });
  await event(repo, id, actor, "lead_outcome_set", now, { outcome });
}

export function actorName(id: string): string {
  if (id === "ai") return "EPIK AI";
  if (id === "system") return "System";
  if (id === "sagepilot") return "Sagepilot";
  return AGENT.get(id)?.name ?? id;
}

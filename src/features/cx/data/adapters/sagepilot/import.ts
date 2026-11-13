import type { CxRepository } from "../../repository";
import { classify } from "../../../domain/classifier";
import { scenario } from "../../../domain/config";
import { ingest, resolve, type Actor } from "../../../domain/service";
import type { Ticket, TicketEvent } from "../../../domain/types";
import { MemoryCxRepository, type CxSnapshot } from "../mock/memory-repo";
import { channelOf, cleanMessages, sagepilotInfo, type CleanMessage, type ImportedChat } from "./map";

// Sagepilot → our tickets (v5 section 5). Read-only towards Sagepilot. The ticket key is "sp:<uuid>", shown as
// "#<ticket number>". Every message is kept with its author; only customer words are classified. Re-running adds
// nothing twice (messages are matched by their Sagepilot id).

const SAGEPILOT: Actor = { id: "sagepilot", role: "admin" };
const DAY = 86_400_000;

export type ChatInput = {
  id: string;
  code: string | null;
  status: string | null;
  created_at: string;
  closed_at: string | null;
  is_spam: boolean | null;
  subject: string | null;
  summary: string | null;
  last_message_created_at?: string | null;
  customers: { name: string | null; email: string | null; phone: string | null; instagram_username: string | null } | null;
  channels: { kind: string | null } | null;
} & Parameters<typeof sagepilotInfo>[0];

export type MessageInput = { id?: string; role: string | null; content: string | null; type: string | null; created_at: string };

export type ApplyResult = { action: "created" | "updated" | "unchanged" | "skipped"; ticketId?: string; subTicketId?: string; reopened?: boolean };

let n = 0;
const eid = () => `sp${Date.now().toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function messageEvent(ticketId: string, m: CleanMessage): TicketEvent {
  const actorId = m.author === "customer" ? "customer" : m.author === "ai" ? "ai" : "sagepilot";
  return { id: eid(), ticketId, at: m.at, actorId, kind: "message", payload: { author: m.author, text: m.text.slice(0, 4000), spId: m.spId } };
}

/** First response = a person's reply (v5 5.3); the AI's first reply is kept apart. Pure. */
export function replyTimes(msgs: CleanMessage[]): Pick<Ticket, "firstResponseAt" | "firstAiReplyAt" | "lastCustomerAt"> {
  const firstCustomer = msgs.find((m) => m.author === "customer")?.at;
  const after = (m: CleanMessage) => !firstCustomer || m.at >= firstCustomer;
  return {
    firstResponseAt: msgs.find((m) => m.author === "agent" && after(m))?.at,
    firstAiReplyAt: msgs.find((m) => m.author === "ai" && after(m))?.at,
    lastCustomerAt: [...msgs].reverse().find((m) => m.author === "customer")?.at,
  };
}

/**
 * "AI answered" (v5 5.5): Aliya replied after the customer's last message, the question is one the AI may answer,
 * and nothing says a person is needed. Pure.
 */
export function isAiAnswered(t: Pick<Ticket, "scenarioId" | "type" | "warnings" | "confidence">, msgs: CleanMessage[]): boolean {
  const lastCustomer = [...msgs].reverse().find((m) => m.author === "customer")?.at;
  const lastAi = [...msgs].reverse().find((m) => m.author === "ai")?.at;
  const lastAgent = [...msgs].reverse().find((m) => m.author === "agent")?.at;
  if (!lastAi || (lastCustomer && lastAi < lastCustomer) || (lastAgent && lastAgent > lastAi)) return false;
  const s = scenario(t.scenarioId);
  return Boolean(s.l0) && t.type === "informative" && t.confidence >= 0.7 && !t.warnings.some((w) => /person must|Do not confirm COD/.test(w));
}

/** Same issue = same scenario bucket, or a greeting/unclear follow-up, or the same order number. */
function sameIssue(t: Ticket, text: string, channel: Ticket["channel"]): { same: boolean; bucket: string } {
  const c = classify({ text, channel });
  if (["X", "K"].includes(c.bucket) || c.bucket === t.bucket) return { same: true, bucket: c.bucket };
  const orders = c.entities.orderRefs;
  if (orders.length && [t.orderRef, ...t.entities.orderRefs].some((o) => o && orders.includes(o))) return { same: true, bucket: c.bucket };
  return { same: false, bucket: c.bucket };
}

async function seenIds(repo: CxRepository, parent: Ticket): Promise<Set<string>> {
  const keys = [parent.id, ...(parent.childIds ?? [])];
  const seen = new Set<string>();
  for (const key of keys) for (const e of await repo.listEvents(key)) if (typeof e.payload.spId === "string") seen.add(e.payload.spId);
  return seen;
}

/** Adds one Sagepilot ticket with all its messages, or brings an existing one up to date. */
export async function applyChat(repo: CxRepository, chat: ChatInput, raw: MessageInput[], now: Date): Promise<ApplyResult> {
  if (chat.is_spam) return { action: "skipped" };
  const key = `sp:${chat.id}`;
  const ref = chat.code ? `#${chat.code}` : key;
  const msgs = cleanMessages(raw);
  const info = sagepilotInfo(chat);
  const channel = channelOf(chat.channels?.kind);
  const customerMsgs = msgs.filter((m) => m.author === "customer");
  const existing = await repo.getTicket(key);

  if (!existing) {
    const text = customerMsgs.map((m) => m.text).filter(Boolean).join("\n") || [chat.subject, chat.summary].filter(Boolean).join(". ");
    if (!text.trim()) return { action: "skipped" };
    const c = chat.customers;
    const created = new Date(chat.created_at);
    const isPublic = raw.some((m) => (m.role ?? "").toLowerCase() === "user" && /Customer Comment on the Post/i.test(m.content ?? ""));
    const result = await ingest(repo, {
      channel,
      text: text.slice(0, 4000),
      publicComment: isPublic || undefined,
      phone: c?.phone ?? undefined,
      name: c?.name ?? undefined,
      handle: c?.instagram_username ? `@${c.instagram_username.replace(/^@/, "")}` : c?.email ?? undefined,
      at: created,
    }, created, { key, ref, sagepilot: true });
    let t = result.ticket;
    for (const m of msgs) await repo.appendEvent(messageEvent(key, m));
    const times = replyTimes(msgs);
    const aiAnswered = t.level === "L0" && isAiAnswered(t, msgs);
    // Not answered by the AI: a person must look at it (L1), never closed by itself.
    const level = t.level === "L0" && !aiAnswered ? "L1" : t.level;
    t = { ...t, ...times, sp: info, aiAnswered, level, ownerId: level === "L1" && !t.ownerId ? "khadija" : t.ownerId, external: { system: "sagepilot", id: chat.id, code: chat.code }, explanation: [...t.explanation, `Sagepilot ticket ${ref}.`] };
    await repo.saveTicket(t);
    await closeIfClosedInSagepilot(repo, t, chat, now);
    const csat = info.csat;
    if (csat != null) {
      const customer = await repo.getCustomer(t.customerUid);
      if (customer) await repo.saveCustomer({ ...customer, csat: Math.max(1, Math.min(5, Math.round(csat))) });
    }
    return { action: "created", ticketId: key };
  }

  const seen = await seenIds(repo, existing);
  const fresh = msgs.filter((m) => !seen.has(m.spId));
  const infoChanged = JSON.stringify(existing.sp ?? {}) !== JSON.stringify(info);
  if (!fresh.length && !infoChanged) return { action: "unchanged", ticketId: key };

  let target = (existing.activeIssueId && (await repo.getTicket(existing.activeIssueId))) || existing;
  let subTicketId: string | undefined;
  let reopened = false;
  const newCustomer = fresh.filter((m) => m.author === "customer");
  if (newCustomer.length) {
    const text = newCustomer.map((m) => m.text).join("\n");
    const issue = sameIssue(target, text, channel);
    if (!issue.same) {
      // A different issue in the same Sagepilot conversation: a linked sub-ticket with its own SLA and owner.
      const seq = (existing.childIds?.length ?? 0) + 2;
      const childKey = `${key}~${seq}`;
      const at = new Date(newCustomer[0].at);
      const child = (await ingest(repo, { channel, text, phone: chat.customers?.phone ?? undefined, name: chat.customers?.name ?? undefined, at }, at, { key: childKey, ref: `${existing.ref ?? ref}-${seq}`, sagepilot: true })).ticket;
      await repo.saveTicket({ ...child, parentTicketId: key, external: { system: "sagepilot", id: chat.id, code: chat.code }, sp: info, level: child.level === "L0" ? "L1" : child.level, ownerId: child.ownerId ?? "khadija" });
      const parentNow = (await repo.getTicket(key))!;
      await repo.saveTicket({ ...parentNow, childIds: [...(parentNow.childIds ?? []), childKey], activeIssueId: childKey, sp: info });
      await repo.appendEvent({ id: eid(), ticketId: key, at: at.toISOString(), actorId: "system", kind: "sub_ticket_created", payload: { childId: childKey, ref: `${existing.ref ?? ref}-${seq}` } });
      target = (await repo.getTicket(childKey))!;
      subTicketId = childKey;
    } else if (target.status === "resolved" || target.status === "closed") {
      // Same issue again: reopen and carry on (resolution time continues across reopens).
      target = { ...target, status: "reopened", reopenCount: target.reopenCount + 1, resolvedAt: undefined, closedAt: undefined, aiAnswered: false, level: target.level === "L0" ? "L1" : target.level };
      await repo.saveTicket(target);
      await repo.appendEvent({ id: eid(), ticketId: target.id, at: newCustomer[0].at, actorId: "system", kind: "reopened", payload: { reason: "The customer wrote again in Sagepilot about the same issue." } });
      reopened = true;
    }
  }
  for (const m of fresh) await repo.appendEvent(messageEvent(target.id, m));
  const all = [...(await repo.listEvents(target.id))].filter((e) => e.kind === "message").map((e) => ({ spId: String(e.payload.spId ?? e.id), author: e.payload.author as CleanMessage["author"], text: String(e.payload.text ?? ""), at: e.at }));
  const times = replyTimes(all.sort((a, b) => a.at.localeCompare(b.at)));
  const current = (await repo.getTicket(target.id))!;
  const aiAnswered = current.level === "L0" ? isAiAnswered(current, all) : false;
  await repo.saveTicket({ ...current, firstResponseAt: current.firstResponseAt ?? times.firstResponseAt, firstAiReplyAt: current.firstAiReplyAt ?? times.firstAiReplyAt, lastCustomerAt: times.lastCustomerAt ?? current.lastCustomerAt, sp: info, aiAnswered, level: current.level === "L0" && !aiAnswered && newCustomer.length ? "L1" : current.level });
  if (target.id !== key && infoChanged) {
    const parent = (await repo.getTicket(key))!;
    await repo.saveTicket({ ...parent, sp: info });
  }
  if (!newCustomer.length) await closeIfClosedInSagepilot(repo, (await repo.getTicket(target.id))!, chat, now);
  return { action: "updated", ticketId: key, subTicketId, reopened };
}

/** Closed in Sagepilot (by a person) and nothing newer from the customer: mirror the close. */
async function closeIfClosedInSagepilot(repo: CxRepository, t: Ticket, chat: ChatInput, now: Date) {
  const closedAt = chat.closed_at ?? (chat.status === "closed" ? chat.last_message_created_at ?? chat.created_at : null);
  if (!closedAt || t.status === "closed" || t.status === "resolved" || new Date(closedAt) > now) return;
  if (t.lastCustomerAt && t.lastCustomerAt > closedAt) return;
  await resolve(repo, t.id, { comment: "Closed in Sagepilot.", closeReason: "Closed in Sagepilot", resolutionType: t.type }, SAGEPILOT, new Date(Math.max(new Date(closedAt).getTime(), new Date(t.createdAt).getTime())));
}

/**
 * "AI answered" tickets close by themselves after 24 hours without a customer message (v5 5.5). Nothing is sent to
 * anyone: an event is written. A new message reopens or makes a sub-ticket.
 */
export async function autoCloseAiAnswered(repo: CxRepository, now: Date): Promise<string[]> {
  const closed: string[] = [];
  for (const t of await repo.listTickets()) {
    if (!t.aiAnswered || t.status === "closed" || t.status === "resolved") continue;
    const last = t.lastCustomerAt ?? t.createdAt;
    if (now.getTime() - new Date(last).getTime() < DAY) continue;
    const at = now.toISOString();
    await repo.saveTicket({ ...t, status: "closed", resolvedAt: at, closedAt: at, closeReason: "AI answered, no reply in 24 hours" });
    await repo.appendEvent({ id: eid(), ticketId: t.id, at, actorId: "system", kind: "auto_closed_no_response", payload: {} });
    closed.push(t.id);
  }
  return closed;
}

/** Older path (tests and the replay check): tickets from mapped chats, keyed and numbered the v5 way. */
export async function importSagepilot(repo: CxRepository, items: ImportedChat[], now: Date): Promise<{ added: number; skipped: number }> {
  let added = 0;
  for (const item of [...items].sort((a, b) => a.msg.at.localeCompare(b.msg.at))) {
    const sp = item.sagepilot;
    const chat: ChatInput = {
      id: sp.id, code: sp.code, status: sp.status, created_at: item.msg.at, closed_at: sp.closedAt, is_spam: false, subject: null, summary: null,
      customers: { name: item.msg.name ?? null, email: null, phone: item.msg.phone ?? null, instagram_username: item.msg.handle?.startsWith("@") ? item.msg.handle.slice(1) : null },
      channels: { kind: item.msg.channel }, chat_escalated_at: sp.escalatedAt, user_csat_score: sp.csat,
    };
    // A public comment keeps its marker so it is still treated as public.
    const content = item.msg.publicComment ? `Customer Comment on the Post\n${item.msg.text ?? ""}` : item.msg.text ?? "";
    const messages: MessageInput[] = [{ id: `${sp.id}:1`, role: "user", content, type: "text", created_at: item.msg.at }];
    if (sp.firstResponseAt && sp.firstReplyBy) messages.push({ id: `${sp.id}:2`, role: sp.firstReplyBy === "ai" ? "pilot" : "agent", content: sp.firstReplyBy === "ai" ? "Answered by the AI in Sagepilot" : "Replied in Sagepilot", type: "message", created_at: sp.firstResponseAt });
    const r = await applyChat(repo, chat, messages, now);
    if (r.action === "created") added++;
  }
  return { added, skipped: items.length - added };
}

/** A fresh in-memory copy built from Sagepilot items (used by tests and the replay check). */
export async function buildFromSagepilot(items: ImportedChat[], now: Date): Promise<CxSnapshot> {
  const repo = new MemoryCxRepository();
  await importSagepilot(repo, items, now);
  return repo.snapshot();
}

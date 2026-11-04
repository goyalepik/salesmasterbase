import { todayIst } from "./insights";
import { statusLabel, type OrgNode, type Status, type Ticket } from "./model";
import { isAdmin } from "./org";

// Every change to a ticket goes through here: it checks who may change it and writes the history line.

export class TrackerError extends Error {}

/** Admins (founders and anyone marked admin) change anything; others change what they raised or were given. */
export function canEdit(org: OrgNode[], me: string, ticket: Ticket): boolean {
  return isAdmin(org, me) || ticket.assignee === me || ticket.createdBy === me;
}

const uid = () => Math.random().toString(36).slice(2, 10);
const nameOf = (org: OrgNode[], id: string | null) => (id ? org.find((n) => n.id === id)?.name ?? "someone" : "nobody");
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

export type NewTicket = { title: string; note?: string; assignee: string | null; due: string | null };

export function createTicket(tickets: Ticket[], input: NewTicket, me: string, org: OrgNode[], now = new Date()): Ticket {
  const title = input.title.trim();
  if (!title) throw new TrackerError("Write what needs doing.");
  if (input.due && input.due < todayIst(now)) throw new TrackerError("The date is in the past.");
  const at = now.toISOString();
  const number = tickets.reduce((m, t) => Math.max(m, t.number), 100) + 1;
  return {
    id: uid(),
    number,
    title,
    note: input.note?.trim() ?? "",
    assignee: input.assignee,
    due: input.due,
    status: "todo",
    blocked: null,
    createdBy: me,
    createdAt: at,
    updatedAt: at,
    doneAt: null,
    comments: [],
    history: [{ at, by: me, text: input.assignee && input.assignee !== me ? `Created for ${nameOf(org, input.assignee)}` : "Created" }],
  };
}

export type Change =
  | { kind: "status"; status: Status }
  | { kind: "assignee"; assignee: string | null }
  | { kind: "due"; due: string | null }
  | { kind: "edit"; title: string; note: string }
  | { kind: "block"; by: string; reason: string }
  | { kind: "unblock" }
  | { kind: "comment"; text: string };

export function applyChange(t: Ticket, c: Change, me: string, org: OrgNode[], now = new Date()): Ticket {
  const at = now.toISOString();
  // Anyone may comment; everything else needs the right to edit.
  if (c.kind !== "comment" && !canEdit(org, me, t)) throw new TrackerError("Only the person it is for, the person who created it, or an admin can change this.");
  const line = (text: string) => [...t.history, { at, by: me, text }];
  const base = { ...t, updatedAt: at };
  switch (c.kind) {
    case "status":
      if (c.status === t.status) return t;
      return { ...base, status: c.status, doneAt: c.status === "done" ? at : null, blocked: c.status === "done" ? null : t.blocked, history: line(`Moved to ${statusLabel(c.status)}`) };
    case "assignee":
      return { ...base, assignee: c.assignee, history: line(c.assignee ? `Given to ${nameOf(org, c.assignee)}` : "Unassigned") };
    case "due":
      if (c.due && c.due < todayIst(now)) throw new TrackerError("The date is in the past.");
      return { ...base, due: c.due, history: line(c.due ? `Due ${day(c.due)}` : "Due date removed") };
    case "edit":
      if (!c.title.trim()) throw new TrackerError("Write what needs doing.");
      return { ...base, title: c.title.trim(), note: c.note.trim(), history: line("Edited") };
    case "block":
      if (!c.reason.trim()) throw new TrackerError("Say what you are waiting for.");
      if (t.status === "done") throw new TrackerError("This is already done.");
      return { ...base, blocked: { by: c.by, reason: c.reason.trim(), since: at }, history: line(`Blocked by ${nameOf(org, c.by)}: ${c.reason.trim()}`) };
    case "unblock":
      return { ...base, blocked: null, history: line("No longer blocked") };
    case "comment":
      if (!c.text.trim()) throw new TrackerError("Write something first.");
      return { ...base, comments: [...t.comments, { id: uid(), by: me, at, text: c.text.trim() }] };
  }
}

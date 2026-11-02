import { addDays, todayIst } from "./insights";
import { PRIORITIES, ROLES, statusLabel, teamOf, priorityLabel, type Kind, type Person, type Priority, type Status, type TeamId, type Ticket } from "./model";

// Every change to a ticket goes through here: it checks the role and writes the history line.

export class TrackerError extends Error {}

export function canEdit(me: Person, ticket: Ticket): boolean {
  if (me.role === "founder" || me.role === "admin") return true;
  if (me.role === "viewer") return false;
  if (ticket.assignee === me.id || ticket.requestedBy === me.id) return true;
  if (me.role === "lead") return ticket.team === me.team || ticket.requestingTeam === me.team;
  // Members can pick up their team's unassigned work.
  return ticket.team === me.team && ticket.assignee === null;
}

export function canCreate(me: Person): boolean {
  return me.role !== "viewer";
}

export function canManagePeople(me: Person): boolean {
  return me.role === "founder" || me.role === "admin";
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function nameOf(people: Person[], id: string | null): string {
  if (!id) return "nobody";
  return people.find((p) => p.id === id)?.name ?? "someone";
}

function shortDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

export type NewTicket = {
  title: string;
  description: string;
  kind: Kind;
  team: TeamId;
  assignee: string | null;
  priority: Priority;
  due: string | null;
};

export function dueFor(priority: Priority, today: string = todayIst()): string {
  return addDays(today, PRIORITIES.find((p) => p.id === priority)?.days ?? 7);
}

export function createTicket(existing: Ticket[], input: NewTicket, me: Person, now: Date = new Date()): Ticket {
  if (!canCreate(me)) throw new TrackerError("Viewers cannot raise tickets.");
  const title = input.title.replace(/\s+/g, " ").trim().slice(0, 140);
  if (title.length < 3) throw new TrackerError("Give the ticket a short title.");
  const at = now.toISOString();
  const number = existing.reduce((max, t) => Math.max(max, t.number), 100) + 1;
  return {
    id: uid(),
    number,
    title,
    description: input.description.trim().slice(0, 4000),
    kind: input.kind,
    team: input.team,
    assignee: input.assignee,
    requestedBy: me.id,
    requestingTeam: me.team,
    status: input.assignee ? "todo" : "new",
    priority: input.priority,
    due: input.due ?? dueFor(input.priority, todayIst(now)),
    waiting: null,
    dropped: false,
    comments: [],
    events: [{ at, by: me.id, text: me.team === input.team ? "raised this" : `raised this for ${teamOf(input.team).name}` }],
    createdAt: at,
    updatedAt: at,
    statusSince: at,
    doneAt: null,
    version: 1,
    sample: false,
  };
}

export type Change =
  | { kind: "status"; status: Status; waiting?: { team: TeamId; person: string | null; reason: string }; dropped?: boolean }
  | { kind: "assign"; assignee: string | null }
  | { kind: "priority"; priority: Priority }
  | { kind: "due"; due: string | null }
  | { kind: "team"; team: TeamId }
  | { kind: "text"; title: string; description: string }
  | { kind: "comment"; text: string };

/** Applies one change and returns the new ticket. Throws a plain message when it is not allowed. */
export function applyChange(ticket: Ticket, change: Change, me: Person, people: Person[], now: Date = new Date()): Ticket {
  const at = now.toISOString();
  if (change.kind === "comment") {
    const text = change.text.trim().slice(0, 2000);
    if (!text) throw new TrackerError("Write something first.");
    return { ...ticket, comments: [...ticket.comments, { id: uid(), by: me.id, at, text }], updatedAt: at, version: ticket.version + 1 };
  }
  if (!canEdit(me, ticket)) throw new TrackerError(`As ${ROLES[me.role].label.toLowerCase()} you can't change this ticket. Leave a comment instead.`);

  const next: Ticket = { ...ticket, updatedAt: at, version: ticket.version + 1 };
  let line: string;
  switch (change.kind) {
    case "status": {
      if (change.status === "waiting") {
        const reason = change.waiting?.reason.trim() ?? "";
        if (!change.waiting || !reason) throw new TrackerError("Say who it is waiting on and why.");
        next.waiting = { team: change.waiting.team, person: change.waiting.person, reason: reason.slice(0, 300), since: at };
        line = `is waiting on ${change.waiting.person ? nameOf(people, change.waiting.person) : teamOf(change.waiting.team).name}: ${reason}`;
      } else {
        next.waiting = null;
        line = change.status === "done" && change.dropped ? "dropped this" : `moved this to ${statusLabel(change.status)}`;
      }
      if (change.status === ticket.status && change.status !== "waiting") return ticket;
      next.status = change.status;
      next.statusSince = at;
      next.dropped = change.status === "done" && !!change.dropped;
      next.doneAt = change.status === "done" ? at : null;
      // Starting work on an unassigned ticket makes it yours.
      if (change.status === "doing" && !next.assignee) next.assignee = me.id;
      break;
    }
    case "assign":
      if (me.role === "member" && change.assignee && change.assignee !== me.id) throw new TrackerError("Members can only take a ticket themselves. Ask a team lead to assign others.");
      if (change.assignee === ticket.assignee) return ticket;
      next.assignee = change.assignee;
      if (change.assignee && next.status === "new") {
        next.status = "todo";
        next.statusSince = at;
      }
      line = change.assignee === me.id ? "took this" : change.assignee ? `gave this to ${nameOf(people, change.assignee)}` : "unassigned this";
      break;
    case "priority":
      if (change.priority === ticket.priority) return ticket;
      next.priority = change.priority;
      line = `set priority to ${priorityLabel(change.priority)}`;
      break;
    case "due":
      if (change.due === ticket.due) return ticket;
      next.due = change.due;
      line = change.due ? `set the due date to ${shortDay(change.due)}${ticket.due ? ` (was ${shortDay(ticket.due)})` : ""}` : "removed the due date";
      break;
    case "team":
      if (change.team === ticket.team) return ticket;
      next.team = change.team;
      next.assignee = null;
      line = `handed this to ${teamOf(change.team).name}`;
      break;
    case "text": {
      const title = change.title.replace(/\s+/g, " ").trim().slice(0, 140);
      if (title.length < 3) throw new TrackerError("The title is too short.");
      if (title === ticket.title && change.description.trim() === ticket.description) return ticket;
      next.title = title;
      next.description = change.description.trim().slice(0, 4000);
      line = "edited the details";
      break;
    }
  }
  next.events = [...ticket.events, { at, by: me.id, text: line }];
  return next;
}

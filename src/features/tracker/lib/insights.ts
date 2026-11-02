import { TEAMS, type Person, type TeamId, type Ticket } from "./model";

const DAY = 24 * 60 * 60 * 1000;

/** Today's date in IST as YYYY-MM-DD. */
export function todayIst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days since a timestamp (0 for today). */
export function daysSince(at: string, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(at).getTime()) / DAY));
}

/** Days late: positive when the due date has passed. */
export function daysLate(ticket: Pick<Ticket, "due" | "status">, today: string): number {
  if (!ticket.due || ticket.status === "done") return 0;
  return Math.max(0, Math.round((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${ticket.due}T00:00:00Z`).getTime()) / DAY));
}

export type Flag = { tone: "bad" | "warn" | "info"; text: string };

/** The one thing worth shouting about on a card, worst first. */
export function flagFor(ticket: Ticket, today: string, now: Date = new Date()): Flag | null {
  if (ticket.status === "done") return null;
  const late = daysLate(ticket, today);
  if (late > 0) return { tone: "bad", text: late === 1 ? "1 day late" : `${late} days late` };
  if (ticket.status === "waiting" && ticket.waiting) {
    const d = daysSince(ticket.waiting.since, now);
    if (d >= 2) return { tone: "warn", text: `Waiting ${d} days` };
  }
  if (ticket.status === "new" && daysSince(ticket.createdAt, now) >= 1) return { tone: "warn", text: "Not picked up" };
  if (daysSince(ticket.updatedAt, now) >= 3) return { tone: "warn", text: `No update ${daysSince(ticket.updatedAt, now)}d` };
  if (ticket.due === today) return { tone: "info", text: "Due today" };
  return null;
}

export type Summary = {
  open: number;
  late: number;
  waiting: number;
  unpicked: number;
  doneThisWeek: number;
  /** Average days from raised to done, over the last 30 days. Null when nothing finished. */
  avgDaysToDone: number | null;
};

export function summarise(tickets: Ticket[], today: string, now: Date = new Date()): Summary {
  const open = tickets.filter((t) => t.status !== "done");
  const finished = tickets.filter((t) => t.status === "done" && !t.dropped && t.doneAt && daysSince(t.doneAt, now) < 30);
  const spans = finished.map((t) => (new Date(t.doneAt!).getTime() - new Date(t.createdAt).getTime()) / DAY);
  return {
    open: open.length,
    late: open.filter((t) => daysLate(t, today) > 0).length,
    waiting: open.filter((t) => t.status === "waiting").length,
    unpicked: open.filter((t) => t.status === "new" && daysSince(t.createdAt, now) >= 1).length,
    doneThisWeek: tickets.filter((t) => t.status === "done" && !t.dropped && t.doneAt && daysSince(t.doneAt, now) < 7).length,
    avgDaysToDone: spans.length ? Math.round((spans.reduce((a, b) => a + b, 0) / spans.length) * 10) / 10 : null,
  };
}

export type TeamHealth = {
  team: TeamId;
  open: number;
  late: number;
  /** Their own tickets stuck on someone else. */
  waitingOnOthers: number;
  /** Other teams' tickets stuck on them: the number that shows who is holding things up. */
  blockingOthers: number;
  oldestLate: Ticket | null;
  doneThisWeek: number;
  load: Array<{ person: Person; open: number; late: number }>;
};

export function teamHealth(tickets: Ticket[], people: Person[], today: string, now: Date = new Date()): TeamHealth[] {
  const open = tickets.filter((t) => t.status !== "done");
  return TEAMS.map((team) => {
    const mine = open.filter((t) => t.team === team.id);
    const late = mine.filter((t) => daysLate(t, today) > 0).sort((a, b) => daysLate(b, today) - daysLate(a, today));
    return {
      team: team.id,
      open: mine.length,
      late: late.length,
      waitingOnOthers: mine.filter((t) => t.status === "waiting" && t.waiting && t.waiting.team !== team.id).length,
      blockingOthers: open.filter((t) => t.status === "waiting" && t.waiting?.team === team.id && t.team !== team.id).length,
      oldestLate: late[0] ?? null,
      doneThisWeek: tickets.filter((t) => t.team === team.id && t.status === "done" && !t.dropped && t.doneAt && daysSince(t.doneAt, now) < 7).length,
      load: people
        .filter((p) => p.active && p.team === team.id)
        .map((person) => {
          const theirs = open.filter((t) => t.assignee === person.id);
          return { person, open: theirs.length, late: theirs.filter((t) => daysLate(t, today) > 0).length };
        }),
    };
  });
}

export type Handoff = { from: TeamId; to: TeamId; count: number; oldestDays: number };

/** "Sales is waiting on RevOps for 3 tickets, the oldest 4 days." Longest wait first. */
export function handoffs(tickets: Ticket[], now: Date = new Date()): Handoff[] {
  const map = new Map<string, Handoff>();
  for (const t of tickets) {
    if (t.status !== "waiting" || !t.waiting || t.waiting.team === t.team) continue;
    const key = `${t.team}>${t.waiting.team}`;
    const days = daysSince(t.waiting.since, now);
    const row = map.get(key) ?? { from: t.team, to: t.waiting.team, count: 0, oldestDays: 0 };
    row.count += 1;
    row.oldestDays = Math.max(row.oldestDays, days);
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.oldestDays - a.oldestDays || b.count - a.count);
}

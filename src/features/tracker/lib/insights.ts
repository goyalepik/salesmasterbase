import type { OrgNode, Ticket } from "./model";
import { branchMembers, branches, FOUNDERS, type Branch } from "./org";

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

/** The coming Saturday (or today if it is Saturday): "this week" for a team that works six days. */
export function endOfWeek(today: string): string {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addDays(today, (6 - dow + 7) % 7);
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

/** The one thing worth showing on a card, worst first. */
export function flagFor(ticket: Ticket, today: string, now: Date = new Date()): Flag | null {
  if (ticket.status === "done") return null;
  const late = daysLate(ticket, today);
  if (late > 0) return { tone: "bad", text: late === 1 ? "1 day late" : `${late} days late` };
  if (ticket.blocked && daysSince(ticket.blocked.since, now) >= 2) return { tone: "warn", text: `Blocked ${daysSince(ticket.blocked.since, now)} days` };
  if (ticket.due === today) return { tone: "info", text: "Due today" };
  return null;
}

export type Summary = { open: number; late: number; dueToday: number; blocked: number; doneThisWeek: number };

export function summarise(tickets: Ticket[], today: string, now: Date = new Date()): Summary {
  const open = tickets.filter((t) => t.status !== "done");
  return {
    open: open.length,
    late: open.filter((t) => daysLate(t, today) > 0).length,
    dueToday: open.filter((t) => t.due === today).length,
    blocked: open.filter((t) => t.blocked).length,
    doneThisWeek: tickets.filter((t) => t.status === "done" && t.doneAt && daysSince(t.doneAt, now) < 7).length,
  };
}

export type Load = { open: number; late: number; blocked: number };

/** Open, late and blocked work for one person: shown on their card in the team chart. */
export function loadOf(tickets: Ticket[], personId: string, today: string): Load {
  const mine = tickets.filter((t) => t.assignee === personId && t.status !== "done");
  return { open: mine.length, late: mine.filter((t) => daysLate(t, today) > 0).length, blocked: mine.filter((t) => t.blocked).length };
}

/** The founder's one-line view: each branch's late and blocked work, and who is holding up whom. */
export function branchHealth(org: OrgNode[], tickets: Ticket[], today: string): Array<Branch & Load & { waitingOn: Array<{ name: string; count: number }> }> {
  const all = [FOUNDERS, ...branches(org)];
  return all.map((b) => {
    const members = new Set(branchMembers(org, b.id));
    const open = tickets.filter((t) => t.status !== "done" && t.assignee && members.has(t.assignee));
    const waiting = new Map<string, number>();
    for (const t of open) {
      if (!t.blocked || members.has(t.blocked.by)) continue;
      const name = org.find((n) => n.id === t.blocked!.by)?.name ?? "someone";
      waiting.set(name, (waiting.get(name) ?? 0) + 1);
    }
    return {
      ...b,
      open: open.length,
      late: open.filter((t) => daysLate(t, today) > 0).length,
      blocked: open.filter((t) => t.blocked).length,
      waitingOn: [...waiting.entries()].map(([name, count]) => ({ name, count })).sort((a, c) => c.count - a.count),
    };
  });
}

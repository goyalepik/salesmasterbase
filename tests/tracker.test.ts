import assert from "node:assert/strict";
import { test } from "node:test";
import { applyChange, canEdit, createTicket, TrackerError } from "../src/features/tracker/lib/actions";
import { daysLate, flagFor, handoffs, summarise, teamHealth } from "../src/features/tracker/lib/insights";
import { DEFAULT_PEOPLE, type Person } from "../src/features/tracker/lib/model";
import { sampleTickets } from "../src/features/tracker/lib/samples";

const NOW = new Date("2026-11-02T06:30:00Z");
const TODAY = "2026-11-02";
const person = (id: string) => DEFAULT_PEOPLE.find((p) => p.id === id)!;
const member: Person = { id: "riya", name: "Riya", title: "Support", team: "support", role: "member", active: true };
const viewer: Person = { id: "v", name: "Viewer", title: "", team: "sales", role: "viewer", active: true };
const people = [...DEFAULT_PEOPLE, member, viewer];

test("a new ticket gets the next number, a due date from its priority and a history line", () => {
  const t = createTicket(sampleTickets(NOW), { title: "  Call back  customer ", description: "", kind: "task", team: "support", assignee: null, priority: "high", due: null }, person("piyush"), NOW);
  assert.equal(t.number, 116);
  assert.equal(t.title, "Call back customer");
  assert.equal(t.status, "new");
  assert.equal(t.due, "2026-11-05");
  assert.equal(t.requestingTeam, "operations");
  assert.match(t.events[0].text, /for Customer support/);
  assert.throws(() => createTicket([], { title: "Hi there", description: "", kind: "task", team: "sales", assignee: null, priority: "low", due: null }, viewer, NOW), TrackerError);
});

test("waiting needs a team and a reason, and shows up as a hand-off between teams", () => {
  const t = createTicket([], { title: "Refund for PIK1", description: "", kind: "issue", team: "support", assignee: "riya", priority: "urgent", due: null }, person("bhavya"), NOW);
  assert.throws(() => applyChange(t, { kind: "status", status: "waiting", waiting: { team: "revops", person: null, reason: " " } }, member, people, NOW), /who it is waiting on/);
  const waiting = applyChange(t, { kind: "status", status: "waiting", waiting: { team: "revops", person: null, reason: "Needs UTR" } }, member, people, NOW);
  assert.equal(waiting.status, "waiting");
  assert.match(waiting.events.at(-1)!.text, /waiting on RevOps: Needs UTR/);
  const later = new Date(NOW.getTime() + 3 * 86_400_000);
  assert.deepEqual(handoffs([waiting], later), [{ from: "support", to: "revops", count: 1, oldestDays: 3 }]);
  const health = teamHealth([waiting], people, TODAY, later);
  assert.equal(health.find((h) => h.team === "revops")!.blockingOthers, 1);
  const back = applyChange(waiting, { kind: "status", status: "doing" }, member, people, later);
  assert.equal(back.waiting, null);
});

test("roles: viewers only comment, members take their own or unassigned team work, leads run their team", () => {
  const t = createTicket([], { title: "Price list update", description: "", kind: "task", team: "marketing", assignee: null, priority: "normal", due: null }, person("saurav"), NOW);
  assert.equal(canEdit(viewer, t), false);
  assert.throws(() => applyChange(t, { kind: "priority", priority: "high" }, viewer, people, NOW), /comment instead/);
  assert.equal(applyChange(t, { kind: "comment", text: "Any update?" }, viewer, people, NOW).comments.length, 1);
  assert.equal(canEdit(person("abhiman"), t), true, "lead of the owning team");
  assert.equal(canEdit(person("saurav"), t), true, "the person who raised it");
  assert.equal(canEdit(member, t), false, "member of another team");
  const ownTeam = { ...t, team: "support" as const };
  assert.equal(canEdit(member, ownTeam), true, "unassigned work in their own team");
  assert.throws(() => applyChange(ownTeam, { kind: "assign", assignee: "piyush" }, member, people, NOW), /only take a ticket themselves/);
  const taken = applyChange(ownTeam, { kind: "assign", assignee: "riya" }, member, people, NOW);
  assert.equal(taken.status, "todo");
  assert.equal(taken.events.at(-1)!.text, "took this");
});

test("late and stuck flags, and the summary, from the sample week", () => {
  const tickets = sampleTickets(NOW);
  const refund = tickets.find((t) => t.title.startsWith("Refund"))!;
  assert.equal(daysLate(refund, TODAY), 2);
  assert.deepEqual(flagFor(refund, TODAY, NOW), { tone: "bad", text: "2 days late" });
  const fresh = tickets.find((t) => t.title.startsWith("Festive bundle"))!;
  assert.equal(flagFor(fresh, TODAY, NOW), null);
  const s = summarise(tickets, TODAY, NOW);
  assert.equal(s.open, 13);
  assert.equal(s.late, 2);
  assert.equal(s.waiting, 4);
  assert.equal(s.doneThisWeek, 2);
});

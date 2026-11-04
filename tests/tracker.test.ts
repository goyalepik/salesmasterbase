import assert from "node:assert/strict";
import { test } from "node:test";
import { applyChange, canEdit, createTicket, TrackerError } from "../src/features/tracker/lib/actions";
import { branchHealth, daysLate, endOfWeek, flagFor, loadOf, summarise } from "../src/features/tracker/lib/insights";
import { DEFAULT_ORG, type OrgNode } from "../src/features/tracker/lib/model";
import { addPerson, branchOf, branches, isAdmin, levelOf, movePerson, OrgError, removePerson, updatePerson } from "../src/features/tracker/lib/org";
import { sampleTickets } from "../src/features/tracker/lib/samples";

const NOW = new Date("2026-11-04T06:30:00Z"); // Wed 4 Nov, IST
const TODAY = "2026-11-04";

function team(): OrgNode[] {
  let org = DEFAULT_ORG;
  org = addPerson(org, { name: "Ravi K", title: "Warehouse", parentId: "piyush" });
  return org;
}

test("the team chart: founder, branch heads, their people", () => {
  const org = team();
  assert.equal(levelOf(org, "gautama"), 1);
  assert.equal(levelOf(org, "piyush"), 2);
  assert.equal(levelOf(org, "ravi_k"), 3);
  assert.deepEqual(branches(org).map((b) => b.name), ["Founder's office", "Product", "Marketing & category", "Operations"]);
  assert.equal(branchOf(org, "ravi_k")?.name, "Operations", "people sit in their head's branch");
  assert.equal(branchOf(org, "gautama")?.name, "Founders");
});

test("never deeper than three levels", () => {
  const org = team();
  assert.throws(() => addPerson(org, { name: "Too Deep", title: "", parentId: "ravi_k" }), (e: unknown) => e instanceof OrgError && /3 levels/.test((e as Error).message));
  // Piyush has someone under him, so he cannot move under another branch head.
  assert.throws(() => movePerson(org, "piyush", "saurav"), /deeper than 3/);
  assert.throws(() => movePerson(org, "gautama", "ravi_k"), /under them/);
  assert.throws(() => movePerson(org, "saurav", "saurav"), /themselves/);
});

test("moving and editing people keeps branches right", () => {
  let org = team();
  org = movePerson(org, "ravi_k", "abhiman");
  assert.equal(branchOf(org, "ravi_k")?.name, "Marketing & category");
  org = movePerson(org, "saurav", "piyush");
  assert.equal(levelOf(org, "saurav"), 3);
  assert.equal(org.find((n) => n.id === "saurav")?.branch, undefined, "no longer heads a branch");
  org = movePerson(org, "saurav", "gautama");
  assert.equal(org.find((n) => n.id === "saurav")?.branch, "Product manager", "a new head gets a branch name");
  org = updatePerson(org, "saurav", { branch: "Product" });
  assert.equal(branchOf(org, "saurav")?.name, "Product");
  assert.throws(() => updatePerson(org, "saurav", { name: "  " }), /empty/);
});

test("removing: only people with nobody under them, and never the last founder", () => {
  const org = team();
  assert.throws(() => removePerson(org, "piyush"), /under them first/);
  assert.throws(() => removePerson(org, "gautama"), /under them first/);
  assert.equal(removePerson(org, "ravi_k").some((n) => n.id === "ravi_k"), false);
  assert.throws(() => removePerson([{ id: "solo", name: "Solo", title: "Founder", parentId: null }], "solo"), /at least one founder/);
});

test("a ticket is what, who and by when", () => {
  const org = team();
  const t = createTicket([], { title: "  Send the Dreame PO  ", assignee: "piyush", due: "2026-11-07" }, "bhavya", org, NOW);
  assert.equal(t.title, "Send the Dreame PO");
  assert.equal(t.number, 101);
  assert.equal(t.status, "todo");
  assert.equal(t.createdBy, "bhavya");
  assert.match(t.history[0].text, /Created for Piyush/);
  assert.throws(() => createTicket([], { title: " ", assignee: null, due: null }, "bhavya", org, NOW), TrackerError);
  assert.throws(() => createTicket([], { title: "x", assignee: null, due: "2026-11-01" }, "bhavya", org, NOW), /past/);
  assert.equal(createTicket([t], { title: "Next", assignee: null, due: null }, "bhavya", org, NOW).number, 102);
});

test("who can change a ticket: admins, the person on it, and who created it", () => {
  const org = team();
  const t = createTicket([], { title: "Stock check", assignee: "piyush", due: null }, "abhiman", org, NOW);
  assert.ok(isAdmin(org, "gautama") && isAdmin(org, "bhavya"));
  assert.ok(canEdit(org, "piyush", t) && canEdit(org, "abhiman", t) && canEdit(org, "gautama", t));
  assert.equal(canEdit(org, "ravi_k", t), false);
  assert.throws(() => applyChange(t, { kind: "status", status: "doing" }, "ravi_k", org, NOW), TrackerError);
  const commented = applyChange(t, { kind: "comment", text: "Can I help?" }, "ravi_k", org, NOW);
  assert.equal(commented.comments.length, 1, "anyone can comment");
});

test("blocked: by whom and why; done clears it", () => {
  const org = team();
  let t = createTicket([], { title: "PO approval", assignee: "piyush", due: TODAY }, "piyush", org, NOW);
  assert.throws(() => applyChange(t, { kind: "block", by: "gautama", reason: " " }, "piyush", org, NOW), /waiting for/);
  t = applyChange(t, { kind: "block", by: "gautama", reason: "Over ₹10 lakh" }, "piyush", org, NOW);
  assert.equal(t.blocked?.by, "gautama");
  assert.match(t.history.at(-1)!.text, /Blocked by Gautama/);
  t = applyChange(t, { kind: "status", status: "done" }, "piyush", org, NOW);
  assert.equal(t.blocked, null);
  assert.ok(t.doneAt);
});

test("late, due today and blocked flags, and the summary", () => {
  const tickets = sampleTickets(NOW);
  const late = tickets.find((t) => t.title.startsWith("Samsung TV"))!;
  assert.equal(daysLate(late, TODAY), 1);
  assert.deepEqual(flagFor(late, TODAY, NOW), { tone: "bad", text: "1 day late" });
  const po = tickets.find((t) => t.title.startsWith("Raise PO"))!;
  assert.deepEqual(flagFor(po, TODAY, NOW), { tone: "warn", text: "Blocked 3 days" });
  const s = summarise(tickets, TODAY, NOW);
  assert.equal(s.open, 9);
  assert.equal(s.late, 2);
  assert.equal(s.blocked, 2);
  assert.equal(s.doneThisWeek, 2);
  assert.deepEqual(loadOf(tickets, "piyush", TODAY), { open: 3, late: 1, blocked: 1 });
});

test("branch health: late work per branch and who it is waiting on", () => {
  const org = team();
  const tickets = sampleTickets(NOW);
  const ops = branchHealth(org, tickets, TODAY).find((b) => b.name === "Operations")!;
  assert.equal(ops.late, 1);
  assert.deepEqual(ops.waitingOn, [{ name: "Gautama", count: 1 }]);
});

test("this week ends on Saturday", () => {
  assert.equal(endOfWeek("2026-11-04"), "2026-11-07");
  assert.equal(endOfWeek("2026-11-07"), "2026-11-07");
  assert.equal(endOfWeek("2026-11-08"), "2026-11-14");
});

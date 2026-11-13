import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { guardRequest, POST_READ_ALLOWLIST } from "../src/features/cx/data/adapters/sagepilot/guard";
import { importSagepilot } from "../src/features/cx/data/adapters/sagepilot/import";
import { ROSTER } from "../src/features/cx/domain/config";
import { can, ForbiddenError } from "../src/features/cx/domain/rights";
import { ConflictError, runAction, simulate } from "../src/features/cx/server/actions";
import { createLevelPass, createSession, levelForCode, readLevelPass, readSession, userFromSession } from "../src/features/cx/server/auth";
import { MemoryKv, UpstashKv } from "../src/features/cx/server/kv";
import { customerRef, maskPhonesInText } from "../src/features/cx/server/redact";
import { CxStore, getCxStore, memoryStore } from "../src/features/cx/server/store";
import { StoreRepository } from "../src/features/cx/server/store-repo";
import { filterTickets, redactTicket } from "../src/features/cx/server/views";
import { BusyError, dropIndex, mutate, ticketIndex } from "../src/features/cx/server/workspace";

// v5 Phase 1: shared store, level-based access, rights on the server, audit fields, masking, Sagepilot write guard.
// Synthetic data only (phones in the 90000 range).

const khadija = { id: "khadija", role: "l1" as const, queueIds: ["others", "callbacks", "cx_lead"], dept: "CX lead & escalations" };
const logistics = { id: "logistics_owner", role: "l2" as const, queueIds: ["logistics"], dept: "Logistics & orders" };
const sales = { id: "sales_owner", role: "l2" as const, queueIds: ["sales"], dept: "Sales & pre-sales" };
const ceo = { id: "ceo", role: "l3" as const, queueIds: [], dept: "CEO office" };
const viewer = { id: "viewer", role: "viewer" as const, queueIds: [] };
const admin = { id: "admin", role: "admin" as const, queueIds: [] };
const SECRET = "test-secret-123456";

let store: CxStore;
beforeEach(() => {
  dropIndex();
  store = memoryStore();
});

async function newTicket(text = "Where is my order PIK4123, it is late", phone = "+91 90000 11111") {
  const { ticketId } = await simulate(store, { kind: "message", channel: "whatsapp", text, phone }, khadija);
  return ticketId;
}

/** A second server: forgets its copy and reads the store again. */
async function freshRead(id: string) {
  dropIndex();
  const { tickets } = await ticketIndex(store);
  return { ticket: tickets.get(id)!, events: await store.getEvents(id) };
}

test("an action by one person is in the shared store for the next reader, with name, level and department", async () => {
  const id = await newTicket();
  await runAction(store, { action: "assign", ticketId: id, payload: { queueId: "logistics" } }, khadija);
  const { ticket, events } = await freshRead(id);
  assert.equal(ticket.queueId, "logistics");
  const assigned = events.filter((e) => e.kind === "assigned");
  assert.equal(assigned.length, 1);
  assert.equal(assigned[0].actorId, "khadija");
  assert.equal(assigned[0].actorLevel, "l1");
  assert.equal(assigned[0].actorDept, "CX lead & escalations");
});

test("the version goes up on every change, and each server refreshes only what changed", async () => {
  const v0 = await store.version();
  const id = await newTicket();
  const v1 = await store.version();
  await ticketIndex(store);
  await runAction(store, { action: "take", ticketId: id }, khadija);
  assert.ok(v1 > v0 && (await store.version()) > v1);
  // The same server's copy catches up through the change log, without a full reload.
  const { tickets } = await ticketIndex(store);
  assert.equal(tickets.get(id)!.ownerId, "khadija");
});

test("a stale screen is refused with who changed the ticket", async () => {
  const id = await newTicket();
  const seen = (await freshRead(id)).ticket.rev!;
  await runAction(store, { action: "take", ticketId: id, expectedVersion: seen }, khadija);
  await assert.rejects(runAction(store, { action: "take", ticketId: id, expectedVersion: seen }, khadija), (e: unknown) => e instanceof ConflictError && /Updated by N Khadija/.test((e as Error).message));
});

test("viewers cannot change tickets, and bad input is refused", async () => {
  const id = await newTicket();
  await assert.rejects(runAction(store, { action: "take", ticketId: id }, viewer), /Viewers/);
  await assert.rejects(runAction(store, { action: "hold", ticketId: id, payload: { reason: "lunch" } }, khadija), /missing or wrong/);
  await assert.rejects(runAction(store, { action: "drop_table", ticketId: id }, khadija), /Unknown action/);
  await assert.rejects(simulate(store, { kind: "message", text: "hi" }, viewer), ForbiddenError);
});

test("rights by level, on the server: a refused action returns forbidden and writes nothing", async () => {
  const id = await newTicket(); // Logistics question; starts at L1 in triage.
  await runAction(store, { action: "assign", ticketId: id, payload: { queueId: "logistics" } }, khadija);
  const before = (await store.getEvents(id)).length;
  // L2 Sales may not work a Logistics ticket; L2 may not assign; L1 may not "send back to L1"; L3 may not escalate to L3.
  await assert.rejects(runAction(store, { action: "take", ticketId: id }, sales), ForbiddenError);
  await assert.rejects(runAction(store, { action: "assign", ticketId: id, payload: { queueId: "finance" } }, logistics), ForbiddenError);
  await assert.rejects(runAction(store, { action: "back_to_l1", ticketId: id }, khadija), ForbiddenError);
  await assert.rejects(runAction(store, { action: "escalate", ticketId: id, payload: { reason: "Needs CEO" } }, ceo), ForbiddenError);
  await assert.rejects(runAction(store, { action: "override", ticketId: id, payload: { priority: "P0" } }, logistics), ForbiddenError);
  assert.equal((await store.getEvents(id)).length, before, "nothing written");
  // Allowed: L2 Logistics works its own ticket, escalates; L3 sends back to L1; admin can do anything.
  await runAction(store, { action: "take", ticketId: id }, logistics);
  await runAction(store, { action: "escalate", ticketId: id, payload: { reason: "Customer threatens to post publicly" } }, logistics);
  await runAction(store, { action: "back_to_l1", ticketId: id, payload: { reason: "CEO approved refund" } }, ceo);
  await runAction(store, { action: "override", ticketId: id, payload: { priority: "P1" } }, admin);
  const kinds = (await store.getEvents(id)).map((e) => e.kind);
  assert.ok(kinds.includes("ownership_taken") && kinds.includes("override"));
});

test("the rights table: every level's allowed and forbidden capabilities", () => {
  const own = { queueId: "logistics", ownerId: undefined };
  const other = { queueId: "finance", ownerId: undefined };
  assert.equal(can(viewer, "view"), true);
  for (const cap of ["work", "forward", "assign", "resolve", "reveal_phone", "settings"] as const) assert.equal(can(viewer, cap, own), false, `viewer ${cap}`);
  assert.equal(can(logistics, "work", own), true);
  assert.equal(can(logistics, "work", other), false, "L2 only in its own department");
  assert.equal(can(logistics, "work", { queueId: "finance", ownerId: "logistics_owner" }), true, "or tickets they hold");
  assert.equal(can(logistics, "forward"), true);
  assert.equal(can(logistics, "send_back_l1"), true);
  assert.equal(can(logistics, "assign"), false);
  assert.equal(can(logistics, "send_down"), false);
  assert.equal(can(logistics, "classify"), false);
  assert.equal(can(logistics, "classify_category"), true);
  assert.equal(can(khadija, "assign"), true);
  assert.equal(can(khadija, "send_back_l1"), false);
  assert.equal(can(khadija, "merge"), true);
  assert.equal(can(khadija, "settings"), false);
  assert.equal(can(ceo, "send_down"), true);
  assert.equal(can(ceo, "escalate_l3"), false);
  assert.equal(can(ceo, "decide"), true);
  for (const cap of ["settings", "import", "send_down", "merge", "sync"] as const) assert.equal(can(admin, cap), true, `admin ${cap}`);
});

test("events are append-only: an action never rewrites earlier events", async () => {
  const id = await newTicket();
  const first = await store.getEvents(id);
  await runAction(store, { action: "note", ticketId: id, payload: { text: "Called the courier" } }, khadija);
  const after = await store.getEvents(id);
  assert.deepEqual(after.slice(0, first.length), first);
  assert.equal(after.length, first.length + 1);
});

test("a second writer on the same ticket waits for the first", async () => {
  const id = await newTicket();
  assert.ok(await store.lock(`t:${id}`, 5_000));
  await assert.rejects(runAction(store, { action: "take", ticketId: id }, khadija), BusyError);
  await store.unlock(`t:${id}`);
  await runAction(store, { action: "take", ticketId: id }, khadija);
});

test("importing the same Sagepilot ticket twice adds it once", async () => {
  const item = { msg: { channel: "whatsapp" as const, text: "When will my order PIK4555 arrive?", phone: "+919000022222", at: "2026-11-10T05:00:00.000Z" }, sagepilot: { id: "sp-uuid-1", code: "20028", status: "open", closedAt: null, escalatedAt: null, firstResponseAt: null, firstReplyBy: null, csat: null } };
  for (let i = 0; i < 2; i++) await mutate(store, "ingest", (repo) => importSagepilot(repo, [item], new Date("2026-11-10T06:00:00.000Z")));
  const { tickets } = await ticketIndex(store);
  assert.equal([...tickets.values()].filter((t) => t.external?.id === "sp-uuid-1").length, 1);
  assert.equal(await store.keyForCode("20028"), [...tickets.values()][0].id, "the Sagepilot number is indexed");
});

test("list rows never carry a full phone number, for any level", async () => {
  await newTicket("My number is 9000033333, call me about PIK4123", "+91 90000 44444");
  const { tickets } = await ticketIndex(store);
  for (const user of [khadija, logistics, ceo, viewer, admin]) {
    const rows = filterTickets(tickets.values(), { view: "all", range: "all" }, { ...user, email: "", name: "", department: "" }, new Date()).map((t) => redactTicket(t, SECRET));
    const text = JSON.stringify(rows);
    assert.ok(!/9000033333|9000044444|\+919000044444/.test(text), `full number leaked for ${user.role}`);
  }
});

test("phone masking in text, and refs that do not reveal the number", () => {
  assert.equal(maskPhonesInText("call 9000012345 now"), "call +91 90•••• 2345 now");
  const ref = customerRef("+919000012345", SECRET);
  assert.ok(ref.startsWith("c_") && !ref.includes("9000012345"));
  assert.equal(customerRef("+919000012345", SECRET), ref, "stable");
});

test("level codes: each code opens its level; the old single code works as admin until switched off", () => {
  const env = { CX_ACCESS_CODE_L1: "l1-code-111", CX_ACCESS_CODE_L2: "l2-code-222", CX_ACCESS_CODE_L3: "l3-code-333", CX_ACCESS_CODE_ADMIN: "admin-code-444", CX_ACCESS_CODE_VIEWER: "viewer-code-555", DASHBOARD_ACCESS_CODE: "dashboard-999" };
  assert.equal(levelForCode("l1-code-111", env), "l1");
  assert.equal(levelForCode("l2-code-222", env), "l2");
  assert.equal(levelForCode(" l3-code-333 ", env), "l3");
  assert.equal(levelForCode("admin-code-444", env), "admin");
  assert.equal(levelForCode("viewer-code-555", env), "viewer");
  assert.equal(levelForCode("wrong-code", env), null);
  assert.equal(levelForCode("dashboard-999", env), "admin", "legacy code, default admin");
  assert.equal(levelForCode("dashboard-999", { ...env, CX_LEGACY_CODE_AS: "l1" }), "l1");
  assert.equal(levelForCode("dashboard-999", { ...env, CX_LEGACY_CODE_AS: "off" }), null);
});

test("sessions and level passes: signed, expiring, tamper-proof", () => {
  const now = Date.now();
  const s = createSession({ userId: "khadija", level: "l1" }, SECRET, now);
  assert.equal(readSession(s, SECRET, now)?.userId, "khadija");
  assert.equal(readSession(s, "other-secret-123456", now), null, "wrong secret");
  assert.equal(readSession(`${s}x`, SECRET, now), null, "tampered");
  assert.equal(readSession(s, SECRET, now + 13 * 3_600_000), null, "expires after 12 hours");
  const pass = createLevelPass("l2", SECRET, now);
  assert.equal(readLevelPass(pass, SECRET, now), "l2");
  assert.equal(readLevelPass(pass, SECRET, now + 11 * 60_000), null, "pass lasts 10 minutes");
});

test("who am I: the person must be on the roster, active, and at the level whose code was used", () => {
  const session = (userId: string, level: "l1" | "l2") => readSession(createSession({ userId, level }, SECRET), SECRET);
  assert.equal(userFromSession(session("khadija", "l1"), ROSTER)?.name, "N Khadija");
  assert.equal(userFromSession(session("logistics_owner", "l2"), ROSTER)?.department, "Logistics & orders");
  assert.equal(userFromSession(session("khadija", "l2"), ROSTER), null, "level mismatch");
  assert.equal(userFromSession(session("nobody", "l1"), ROSTER), null, "not on the roster");
  assert.equal(userFromSession(session("khadija", "l1"), ROSTER.map((p) => (p.id === "khadija" ? { ...p, active: false } : p))), null, "inactive");
});

test("store choice: KV when configured, memory otherwise, refused only when KV is required", () => {
  assert.equal(getCxStore({ CX_DATA_ADAPTER: "mock" }).kind, "mock");
  assert.equal(getCxStore({ KV_REST_API_URL: "https://kv.example", KV_REST_API_TOKEN: "t" }).kind, "kv");
  assert.equal(getCxStore({}).kind, "mock");
  assert.throws(() => getCxStore({ CX_REQUIRE_KV: "true" }), /not set up/);
});

test("KV layout: per-ticket keys, indexes, change log; Upstash speaks the REST pipeline", async () => {
  const sent: unknown[][] = [];
  const fake: typeof fetch = async (_url, init) => {
    const commands = JSON.parse(String(init?.body)) as unknown[][];
    sent.push(...commands);
    const mem = memKv;
    return new Response(JSON.stringify((await mem.run(commands as Array<Array<string | number>>)).map((result) => ({ result }))));
  };
  const memKv = new MemoryKv();
  const kvStore = new CxStore(new UpstashKv({ url: "https://kv.example", token: "t" }, fake));
  dropIndex();
  const { ticketId } = await simulate(kvStore, { kind: "message", channel: "whatsapp", text: "Refund not received for PIK4019", phone: "+919000055555" }, khadija);
  const keys = sent.map((c) => String(c[1]));
  assert.ok(keys.includes(`cx:t:${ticketId}`) && keys.includes(`cx:t:${ticketId}:ev`), "per-ticket keys");
  assert.ok(keys.includes("cx:idx:activity") && keys.includes("cx:chg") && keys.includes("cx:idx:phone:+919000055555"), "indexes and change log");
  assert.equal((await kvStore.getTicket(ticketId))?.id, ticketId);
});

test("migration from the old single-hash layout keeps everything and renames, never deletes", async () => {
  const kv = new MemoryKv();
  const ticket = { id: "CX-10001", customerUid: "+919000066666", channel: "whatsapp", createdAt: "2026-11-01T00:00:00.000Z", subject: "x", body: "x", bucket: "D", scenarioId: "D2", secondaryScenarioIds: [], type: "actionable", priority: "P2", label: "Medium", level: "L1", queueId: "logistics", status: "open", entities: { orderRefs: [], brands: [] }, confidence: 0.8, explanation: [], warnings: [], sentiment: { tone: "neu", score: 0, signals: [] }, contactCount: 1, slaFirstResponseDueAt: "2026-11-01T01:00:00.000Z", slaResolutionDueAt: "2026-11-03T00:00:00.000Z", reopenCount: 0 };
  await kv.run([["HSET", "cx:t", "CX-10001", JSON.stringify(ticket)], ["RPUSH", "cx:ev", JSON.stringify({ id: "e1", ticketId: "CX-10001", at: ticket.createdAt, actorId: "system", kind: "created", payload: {} })]]);
  const s = new CxStore(kv);
  const result = await s.migrateLegacy();
  assert.deepEqual(result, { migrated: true, tickets: 1 });
  assert.equal((await s.getTicket("CX-10001"))?.queueId, "logistics");
  assert.equal((await s.getEvents("CX-10001")).length, 1);
  const [oldExists] = await kv.run([["EXISTS", "cx:t"]]);
  assert.equal(oldExists, 0);
  assert.deepEqual(await s.migrateLegacy(), { migrated: false, tickets: 0 }, "runs once");
});

test("the store-backed repository writes back only what changed", async () => {
  const id = await newTicket();
  const { tickets } = await ticketIndex(store);
  const repo = new StoreRepository(store, tickets);
  await repo.appendEvent({ id: "n1", ticketId: id, at: new Date().toISOString(), actorId: "khadija", kind: "note_added", payload: { text: "x" } });
  const changes = repo.changes();
  assert.equal(changes.tickets.length, 0);
  assert.equal(changes.events.length, 1);
});

test("Sagepilot is read-only: GET and allow-listed read POSTs pass, anything else throws", () => {
  assert.doesNotThrow(() => guardRequest("GET", "/platform-api/v1/anything"));
  for (const path of POST_READ_ALLOWLIST) assert.doesNotThrow(() => guardRequest("POST", path));
  assert.throws(() => guardRequest("POST", "/platform-api/v1/chats/update"), /would change Sagepilot/);
  assert.throws(() => guardRequest("POST", "/platform-api/v1/webhooks/create"), /would change Sagepilot/);
  assert.throws(() => guardRequest("PUT", "/platform-api/v1/chats/list"), /would change Sagepilot/);
  assert.throws(() => guardRequest("DELETE", "/platform-api/v1/chats/list"), /would change Sagepilot/);
  assert.throws(() => guardRequest("PATCH", "/platform-api/v1/messages/list"), /would change Sagepilot/);
});

test("sign-in attempts are counted per window", async () => {
  const first = await store.hit("code:abc", 60_000);
  const second = await store.hit("code:abc", 60_000);
  assert.equal(first, 1);
  assert.equal(second, 2);
});

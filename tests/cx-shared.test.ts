import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { importSagepilot } from "../src/features/cx/data/adapters/sagepilot/import";
import { ConflictError, runAction, simulate } from "../src/features/cx/server/actions";
import { createSession, devUser, readSession, resolveUser, sessionSecret, userFromCookie } from "../src/features/cx/server/auth";
import { customerRef, maskPhonesInText, redactSnapshot, resolveRef } from "../src/features/cx/server/redact";
import { KvStore, MemoryStore, getCxStore } from "../src/features/cx/server/store";
import { loadWorkspace, mutate } from "../src/features/cx/server/workspace";

// Phase 1: one shared store, signed-in people as actors, phones masked on the server. Synthetic data only.

const khadija = { id: "khadija", role: "l1" as const };
const sales = { id: "sales_owner", role: "l2" as const };
const viewer = { id: "viewer", role: "viewer" as const };
const SECRET = "test-secret-123456";

let store: MemoryStore;
beforeEach(async () => {
  store = new MemoryStore();
  await store.replaceAll({ tickets: [], events: [], customers: [], interactions: [], orders: [], demos: [], calls: [] }, { source: "empty" });
});

async function newTicket(text = "Where is my order PIK4123, it is late", phone = "+91 90000 11111") {
  const { ticketId } = await simulate(store, { kind: "message", channel: "whatsapp", text, phone }, khadija);
  return ticketId;
}

test("an action by one person is in the shared store for the next reader", async () => {
  const id = await newTicket();
  await runAction(store, { action: "assign", ticketId: id, payload: { queueId: "logistics" } }, khadija);
  // A second "browser": a fresh load from the store.
  const { snapshot } = await store.load();
  const t = snapshot.tickets.find((x) => x.id === id)!;
  assert.equal(t.queueId, "logistics");
  const e = snapshot.events.filter((x) => x.ticketId === id && x.kind === "assigned");
  assert.equal(e.length, 1);
  assert.equal(e[0].actorId, "khadija", "the signed-in person is the actor");
});

test("the version goes up on every change, so polls know when to reload", async () => {
  const v0 = await store.version();
  const id = await newTicket();
  const v1 = await store.version();
  await runAction(store, { action: "take", ticketId: id }, sales);
  assert.ok(v1 > v0 && (await store.version()) > v1);
});

test("a stale screen is refused with who changed the ticket", async () => {
  const id = await newTicket();
  const seen = (await store.load()).snapshot.events.filter((e) => e.ticketId === id).length;
  await runAction(store, { action: "take", ticketId: id, expect: seen }, khadija);
  await assert.rejects(runAction(store, { action: "take", ticketId: id, expect: seen }, sales), (e: unknown) => e instanceof ConflictError && /Updated by N Khadija/.test((e as Error).message));
});

test("viewers cannot change tickets, and bad input is refused", async () => {
  const id = await newTicket();
  await assert.rejects(runAction(store, { action: "take", ticketId: id }, viewer), /Viewers/);
  await assert.rejects(runAction(store, { action: "hold", ticketId: id, payload: { reason: "lunch" } }, khadija), /missing or wrong/);
  await assert.rejects(runAction(store, { action: "drop_table", ticketId: id }, khadija), /Unknown action/);
  await assert.rejects(simulate(store, { kind: "message", text: "hi" }, viewer), /Viewers/);
});

test("events are append-only: an action never rewrites earlier events", async () => {
  const id = await newTicket();
  const before = (await store.load()).snapshot.events.map((e) => JSON.stringify(e));
  await runAction(store, { action: "note", ticketId: id, payload: { text: "Called the courier" } }, khadija);
  const after = (await store.load()).snapshot.events.map((e) => JSON.stringify(e));
  assert.deepEqual(after.slice(0, before.length), before);
  assert.equal(after.length, before.length + 1);
});

test("a second writer on the same ticket waits for the first", async () => {
  const id = await newTicket();
  assert.equal(await store.lock(`t:${id}`, 5000), true);
  await assert.rejects(mutate(store, `t:${id}`, async () => undefined), /Someone else/);
  await store.unlock(`t:${id}`);
});

test("importing the same Sagepilot ticket twice adds it once", async () => {
  const item = { msg: { channel: "whatsapp" as const, text: "price of dreame x50", phone: "+91 90000 22222", at: "2026-11-03T04:00:00.000Z" }, sagepilot: { id: "sp-1", code: "19012", status: "open", closedAt: null, escalatedAt: null, firstResponseAt: null, firstReplyBy: null, csat: null } };
  const first = await mutate(store, "ingest", (repo) => importSagepilot(repo, [item], new Date("2026-11-03T05:00:00Z")));
  const second = await mutate(store, "ingest", (repo) => importSagepilot(repo, [item], new Date("2026-11-03T05:00:00Z")));
  assert.equal(first.result.added, 1);
  assert.equal(second.result.added, 0);
  const tickets = (await store.load()).snapshot.tickets.filter((t) => t.external?.id === "sp-1");
  assert.equal(tickets.length, 1);
  assert.equal(tickets[0].external?.code, "19012");
});

test("the browser copy never holds a full phone number, for any role", async () => {
  await newTicket("My number is 9000033333, call me about PIK4123", "+91 90000 44444");
  const { snapshot } = await loadWorkspace(store);
  const out = JSON.stringify(redactSnapshot(snapshot, SECRET));
  assert.doesNotMatch(out, /9000044444|90000 44444|9000033333/);
  assert.match(out, /\+91 90•••• 4444/);
  const red = redactSnapshot(snapshot, SECRET);
  assert.ok(red.customers.every((c) => !c.uid.startsWith("+91")));
  assert.equal(red.tickets[0].customerUid, red.customers.find((c) => c.uid === red.tickets[0].customerUid)?.uid, "tickets still join to customers");
  assert.equal(resolveRef(snapshot, red.customers[0].uid, SECRET), "+919000044444", "L1/Admin can look up one number on the server");
});

test("phone masking in text, and refs that do not reveal the number", () => {
  assert.equal(maskPhonesInText("call 98765 43210 or +91-9876543210"), "call +91 98•••• 3210 or +91 98•••• 3210");
  assert.equal(maskPhonesInText("order PIK4905 for ₹6175 on 2026-11-03"), "order PIK4905 for ₹6175 on 2026-11-03");
  const ref = customerRef("+919000011111", SECRET);
  assert.match(ref, /^c_/);
  assert.doesNotMatch(ref, /9000011111/);
  assert.equal(customerRef("+919000011111", SECRET), ref, "stable");
  assert.notEqual(customerRef("+919000011111", "another-secret-xyz"), ref, "depends on the server secret");
});

test("sessions: signed, expiring, and tamper-proof", () => {
  const cookie = createSession({ email: "someone@getepik.in" }, SECRET, 1_000);
  assert.equal(readSession(cookie, SECRET, 2_000)?.email, "someone@getepik.in");
  assert.equal(readSession(cookie, SECRET, 1_000 + 8 * 86_400_000), null, "expires after a week");
  assert.equal(readSession(cookie, "wrong-secret-0000", 2_000), null);
  const [body, mac] = cookie.split(".");
  const forged = Buffer.from(JSON.stringify({ email: "boss@getepik.in", exp: 9e15 })).toString("base64url");
  assert.equal(readSession(`${forged}.${mac}`, SECRET, 2_000), null);
  assert.ok(body);
});

test("roles come from config: known people, admins by env, everyone else a viewer", () => {
  const env = { CX_USERS: "khadija.test@getepik.in=khadija", CX_ADMIN_EMAILS: "boss.test@getepik.in" };
  assert.deepEqual([resolveUser("Khadija.Test@getepik.in", undefined, env).id, resolveUser("khadija.test@getepik.in", undefined, env).role], ["khadija", "l1"]);
  assert.equal(resolveUser("boss.test@getepik.in", "Boss", env).role, "admin");
  const stranger = resolveUser("new.person@getepik.in", "New Person", env);
  assert.deepEqual([stranger.role, stranger.name, stranger.id], ["viewer", "New Person", "u:new.person"]);
});

test("pick-a-person sign-in: on locally, on live only until Google sign-in is set up", () => {
  const cookie = createSession({ email: "khadija@local.test", dev: "khadija" }, SECRET);
  const google = { CX_GOOGLE_CLIENT_ID: "id", CX_GOOGLE_CLIENT_SECRET: "secret" };
  assert.equal(userFromCookie(cookie, { NODE_ENV: "development", CX_SESSION_SECRET: SECRET })?.id, "khadija");
  assert.equal(userFromCookie(cookie, { NODE_ENV: "production", CX_SESSION_SECRET: SECRET })?.id, "khadija", "pilot before Google is set up");
  assert.equal(userFromCookie(cookie, { NODE_ENV: "production", CX_SESSION_SECRET: SECRET, ...google }), null, "off once Google is set up");
  assert.equal(userFromCookie(cookie, { NODE_ENV: "production", CX_SESSION_SECRET: SECRET, CX_DEV_SIGNIN: "false" }), null);
  assert.equal(userFromCookie(cookie, { NODE_ENV: "production" }), null, "production needs a secret: the session key or the dashboard code");
  assert.equal(sessionSecret({ NODE_ENV: "production", DASHBOARD_ACCESS_CODE: "short" }), null);
  const derived = sessionSecret({ NODE_ENV: "production", DASHBOARD_ACCESS_CODE: "a-long-dashboard-code" });
  assert.ok(derived && !derived.includes("a-long-dashboard-code"), "derived, never the code itself");
  assert.equal(devUser("nobody"), null);
});

test("store choice: KV when configured, memory otherwise, refused only when KV is required", () => {
  assert.equal(getCxStore({ KV_REST_API_URL: "https://kv.example", KV_REST_API_TOKEN: "t" }).kind, "kv");
  assert.equal(getCxStore({ NODE_ENV: "development" }).kind, "mock");
  assert.equal(getCxStore({ CX_DATA_ADAPTER: "mock", NODE_ENV: "production" }).kind, "mock");
  assert.equal(getCxStore({ NODE_ENV: "production" }).kind, "mock", "the pilot runs before KV is added");
  assert.throws(() => getCxStore({ NODE_ENV: "production", CX_REQUIRE_KV: "true" }), /shared store is not set up/);
});

test("KV store speaks the Upstash REST pipeline and keeps lists append-only", async () => {
  const calls: unknown[][] = [];
  const db = new Map<string, unknown>();
  const fake = (async (_url: string, init: RequestInit) => {
    const cmds = JSON.parse(String(init.body)) as unknown[][];
    calls.push(...cmds);
    const results = cmds.map(([cmd, key, ...rest]) => {
      const k = String(key);
      if (cmd === "INCR") { const v = Number(db.get(k) ?? 0) + 1; db.set(k, v); return { result: v }; }
      if (cmd === "GET") return { result: db.get(k) ?? null };
      if (cmd === "HSET") { const h = (db.get(k) as Map<string, string>) ?? new Map(); for (let i = 0; i < rest.length; i += 2) h.set(String(rest[i]), String(rest[i + 1])); db.set(k, h); return { result: 1 }; }
      if (cmd === "HVALS") return { result: [...((db.get(k) as Map<string, string>) ?? new Map()).values()] };
      if (cmd === "HGETALL") return { result: [...((db.get(k) as Map<string, string>) ?? new Map()).entries()].flat() };
      if (cmd === "RPUSH") { const l = (db.get(k) as string[]) ?? []; l.push(...rest.map(String)); db.set(k, l); return { result: l.length }; }
      if (cmd === "LRANGE") return { result: (db.get(k) as string[]) ?? [] };
      if (cmd === "DEL") { for (const x of [key, ...rest]) db.delete(String(x)); return { result: 1 }; }
      if (cmd === "SET") { if (db.has(k)) return { result: null }; db.set(k, "1"); return { result: "OK" }; }
      return { error: "unknown" };
    });
    return new Response(JSON.stringify(results), { status: 200 });
  }) as typeof fetch;
  const kv = new KvStore({ url: "https://kv.example", token: "t" }, fake);
  await kv.replaceAll({ tickets: [], events: [], customers: [], interactions: [], orders: [], demos: [], calls: [] }, { source: "empty" });
  const { ticketId } = await simulate(kv, { kind: "message", channel: "whatsapp", text: "price of iphone 16", phone: "+91 90000 55555" }, khadija);
  await runAction(kv, { action: "take", ticketId }, sales);
  const loaded = await kv.load();
  assert.equal(loaded.snapshot.tickets.find((t) => t.id === ticketId)?.ownerId, "sales_owner");
  assert.ok(loaded.snapshot.events.some((e) => e.kind === "ownership_taken" && e.actorId === "sales_owner"));
  assert.equal(await kv.lock("x", 1000), true);
  assert.equal(await kv.lock("x", 1000), false, "a second lock waits");
  assert.ok(!calls.some(([c]) => c === "LSET" || c === "LREM"), "events are never rewritten");
});

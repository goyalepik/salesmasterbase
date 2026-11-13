import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { applyChat, autoCloseAiAnswered, isAiAnswered, replyTimes } from "../src/features/cx/data/adapters/sagepilot/import";
import { cleanMessages, normaliseTag, sagepilotInfo } from "../src/features/cx/data/adapters/sagepilot/map";
import { MemoryCxRepository } from "../src/features/cx/data/adapters/mock/memory-repo";
import { aiFirstReplyMs, frtMs } from "../src/features/cx/domain/metrics";
import { simulate } from "../src/features/cx/server/actions";
import { migrateTicketIds } from "../src/features/cx/server/migrate-ids";
import { syncStep } from "../src/features/cx/server/sagepilot-sync";
import { memoryStore, type CxStore } from "../src/features/cx/server/store";
import { filterTickets } from "../src/features/cx/server/views";
import { verifyWebhook } from "../src/features/cx/server/webhook";
import { dropIndex, ticketIndex } from "../src/features/cx/server/workspace";

// v5 Phase 2: Sagepilot sync by last activity (no cap, idempotent), ticket identity, authorship, FRT, L0 handling.
// A fake Sagepilot answers the two read endpoints; synthetic data only (phones in the 90000 range).

const config = { token: "t", baseUrl: "https://sp.test", workspaceId: null };
const khadija = { id: "khadija", role: "l1" as const, queueIds: ["others"], dept: "CX lead & escalations" };

type FakeChat = { id: string; code: string; created_at: string; last_message_created_at: string; status: string; messages: Array<{ id: string; role: string; content: string; created_at: string }> };

function chatRecord(c: FakeChat) {
  return {
    id: c.id, code: c.code, status: c.status, sub_status: null, priority: "medium", created_at: c.created_at, updated_at: c.last_message_created_at, last_message_created_at: c.last_message_created_at,
    closed_at: null, chat_escalated_at: null, first_agent_response_at: null, assignee_type: "pilot", subject: null, summary: null, is_spam: false, user_csat_score: null, inferred_csat_score: null,
    team_name: "Sales Team", agent_profile: null, has_outbound_human_reply_after_last_user: false, chat_tags: [{ tags: { name: "demo missed" } }], chat_custom_fields: [],
    customers: { id: `cu-${c.id}`, name: "Test Customer", email: null, phone: `+9190000${c.id.replace(/\D/g, "").padStart(5, "0").slice(-5)}`, instagram_username: null },
    channels: { kind: "whatsapp", name: "WhatsApp" }, messages: null,
  };
}

let chats: FakeChat[] = [];
const calls: Array<{ path: string; body: Record<string, unknown>; method: string }> = [];
const realFetch = globalThis.fetch;

function fakeSagepilot() {
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ path, body, method: init?.method ?? "GET" });
    if (path === "/platform-api/v1/chats/list") {
      const sorted = [...chats].sort((a, b) => b.last_message_created_at.localeCompare(a.last_message_created_at));
      const start = Number(body.cursor ?? 0);
      const size = Number(body.page_size ?? 100);
      const page = sorted.slice(start, start + size);
      return new Response(JSON.stringify({ records: page.map(chatRecord), cursor: start + size < sorted.length ? String(start + size) : null }));
    }
    if (path === "/platform-api/v1/messages/list") {
      const c = chats.find((x) => x.id === body.chat_id)!;
      return new Response(JSON.stringify({ records: c.messages.map((m) => ({ ...m, type: "text", chat_id: c.id })), cursor: null }));
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
}

let store: CxStore;
beforeEach(() => {
  dropIndex();
  store = memoryStore();
  chats = [];
  calls.length = 0;
  fakeSagepilot();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const iso = (h: number) => new Date(Date.UTC(2026, 10, 12, h, 0, 0)).toISOString();

function makeChats(count: number) {
  for (let i = 0; i < count; i++) {
    chats.push({ id: `c${i}`, code: String(30000 + i), created_at: iso(1), last_message_created_at: iso(2), status: "open", messages: [
      { id: `c${i}-m1`, role: "user", content: `Where is my order PIK${4000 + i}?<br />It is late`, created_at: iso(1) },
      { id: `c${i}-m2`, role: "pilot", content: "Let me check that for you.", created_at: iso(1) },
    ] });
  }
}

test("sync pages through every ticket by last activity, with no cap, and says when the range is complete", async () => {
  makeChats(250);
  const report = await syncStep(store, config, { now: new Date(iso(3)), budgetMs: 60_000 });
  assert.equal(report.complete, true);
  assert.equal(report.created, 250, "no 200 cap");
  const { tickets } = await ticketIndex(store);
  assert.equal(tickets.size, 250);
  const t = tickets.get("sp:c7")!;
  assert.equal(t.ref, "#30007");
  assert.ok(![...tickets.keys()].some((k) => k.startsWith("CX-")));
  const list = calls.filter((c) => c.path === "/platform-api/v1/chats/list");
  assert.equal(list.length, 3, "pages of 100");
  assert.ok(list.every((c) => c.body.date_filter_field === "last_message_created_at" && c.body.sort_by_field === "last_message_created_at"));
  assert.ok(calls.every((c) => c.method === "POST" && ["/platform-api/v1/chats/list", "/platform-api/v1/messages/list"].includes(c.path)), "only allow-listed reads");
  const meta = await store.meta();
  assert.equal(meta.syncComplete, "true");
});

test("re-running a sync never duplicates; an old ticket with a new message is picked up", async () => {
  makeChats(3);
  await syncStep(store, config, { now: new Date(iso(3)) });
  const before = (await store.getEvents("sp:c1")).length;
  calls.length = 0;
  await syncStep(store, config, { now: new Date(iso(3)) });
  assert.equal((await store.getEvents("sp:c1")).length, before, "nothing twice");
  assert.equal(calls.filter((c) => c.path === "/platform-api/v1/messages/list").length, 0, "unchanged tickets are not re-read");
  // Created long ago, new message today.
  const c = chats[1];
  c.messages.push({ id: "c1-m3", role: "user", content: "Still waiting for PIK4001", created_at: iso(5) });
  c.last_message_created_at = iso(5);
  await syncStep(store, config, { now: new Date(iso(6)) });
  const events = await store.getEvents("sp:c1");
  assert.equal(events.filter((e) => e.kind === "message").length, 3);
});

test("a different issue in the same Sagepilot ticket becomes a linked sub-ticket; the same issue reopens", async () => {
  const repo = new MemoryCxRepository();
  const base = { id: "u1", code: "20028", status: "open", created_at: iso(1), closed_at: null, is_spam: false, subject: null, summary: null, last_message_created_at: iso(1), customers: { name: "A", email: null, phone: "+919000012345", instagram_username: null }, channels: { kind: "whatsapp" } };
  const m1 = [{ id: "m1", role: "user", content: "Where is my order PIK4905?", type: "text", created_at: iso(1) }];
  await applyChat(repo, base, m1, new Date(iso(2)));
  const parent = (await repo.getTicket("sp:u1"))!;
  await repo.saveTicket({ ...parent, status: "closed", closedAt: iso(2), resolvedAt: iso(2) });
  // Same issue again: reopen.
  const m2 = [...m1, { id: "m2", role: "user", content: "Still no update on my order PIK4905", type: "text", created_at: iso(3) }];
  const r2 = await applyChat(repo, { ...base, last_message_created_at: iso(3) }, m2, new Date(iso(3)));
  assert.equal(r2.reopened, true);
  assert.equal((await repo.getTicket("sp:u1"))!.status, "reopened");
  // A different issue: a sub-ticket #20028-2 with its own SLA.
  const m3 = [...m2, { id: "m3", role: "user", content: "Also I want to book a demo of the Dreame L50 at home", type: "text", created_at: iso(4) }];
  const r3 = await applyChat(repo, { ...base, last_message_created_at: iso(4) }, m3, new Date(iso(4)));
  assert.equal(r3.subTicketId, "sp:u1~2");
  const child = (await repo.getTicket("sp:u1~2"))!;
  assert.equal(child.ref, "#20028-2");
  assert.equal(child.parentTicketId, "sp:u1");
  assert.deepEqual((await repo.getTicket("sp:u1"))!.childIds, ["sp:u1~2"]);
});

test("website-only tickets are numbered W-1001, W-1002…; no CX- numbers", async () => {
  const a = await simulate(store, { kind: "message", channel: "whatsapp", text: "What is the price of iPhone 16?", phone: "+91 90000 22222" }, khadija);
  const b = await simulate(store, { kind: "message", channel: "whatsapp", text: "Do you have stock of Dreame L50?", phone: "+91 90000 33333" }, khadija);
  assert.equal(a.ticketId, "W-1001");
  assert.equal(b.ticketId, "W-1002");
  const { tickets } = await ticketIndex(store);
  assert.equal(tickets.get("W-1001")!.simulated, true);
});

test("search finds a ticket by Sagepilot number, #number, sub-number, W-, order number and phone (phones for L1/Admin)", async () => {
  makeChats(2);
  await syncStep(store, config, { now: new Date(iso(3)) });
  await simulate(store, { kind: "message", channel: "whatsapp", text: "price of air fryer", phone: "+91 90000 44444" }, khadija);
  const { tickets } = await ticketIndex(store);
  const user = (role: "l1" | "l2") => ({ id: "x", email: "", name: "", role, queueIds: [], department: "" });
  const find = (q: string, role: "l1" | "l2" = "l1") => filterTickets(tickets.values(), { view: "all", range: "all", q }, user(role), new Date(iso(3))).map((t) => t.id);
  assert.deepEqual(find("30001"), ["sp:c1"]);
  assert.deepEqual(find("#30001"), ["sp:c1"]);
  assert.deepEqual(find("W-1001"), ["W-1001"]);
  assert.deepEqual(find("PIK4001"), ["sp:c1"]);
  assert.deepEqual(find("#PIK4001"), ["sp:c1"]);
  assert.deepEqual(find("44444"), ["W-1001"], "last digits of the phone, for L1");
  assert.deepEqual(find("44444", "l2"), [], "not for L2");
});

test("first response counts people only; the AI's reply time is kept apart", () => {
  const msgs = cleanMessages([
    { id: "1", role: "user", content: "hi, refund status?", type: "text", created_at: "2026-11-12T10:00:00.000Z" },
    { id: "2", role: "pilot", content: "Checking…", type: "ai_generated", created_at: "2026-11-12T10:00:30.000Z" },
    { id: "3", role: "agent", content: "Refund done today", type: "message", created_at: "2026-11-12T10:40:00.000Z" },
  ]);
  const times = replyTimes(msgs);
  assert.equal(times.firstResponseAt, "2026-11-12T10:40:00.000Z");
  assert.equal(times.firstAiReplyAt, "2026-11-12T10:00:30.000Z");
  const events = msgs.map((m, i) => ({ id: String(i), ticketId: "t", at: m.at, actorId: m.author, kind: "message" as const, payload: { author: m.author, text: m.text } }));
  assert.equal(frtMs(events), 40 * 60_000);
  assert.equal(aiFirstReplyMs(events), 30_000);
});

test("HTML never reaches the subject; authors are mapped; tags are normalised", async () => {
  const msgs = cleanMessages([{ id: "1", role: "user", content: "It's 11.40<br />Where is my demo?&amp;", type: "text", created_at: "2026-11-12T10:00:00.000Z" }, { id: "2", role: "private", content: "<b>note</b>", type: "message", created_at: "2026-11-12T10:01:00.000Z" }]);
  assert.equal(msgs[0].text, "It's 11.40\nWhere is my demo?&");
  assert.equal(msgs[1].author, "note");
  assert.equal(normaliseTag(" demo  MISSED "), "Demo Missed");
  assert.equal(sagepilotInfo({ created_at: "x", chat_tags: [{ tags: { name: "demo missed" } }] }).demoMissed, true);
  const repo = new MemoryCxRepository();
  await applyChat(repo, { id: "h", code: "20100", status: "open", created_at: iso(1), closed_at: null, is_spam: false, subject: null, summary: null, customers: null, channels: { kind: "whatsapp" } }, [{ id: "1", role: "user", content: "It's 11.40<br />", type: "text", created_at: iso(1) }], new Date(iso(2)));
  assert.ok(!(await repo.getTicket("sp:h"))!.subject.includes("<br"));
});

test("L0: never closed without a verified AI reply; 'AI answered' closes after 24 hours of silence", async () => {
  const repo = new MemoryCxRepository();
  const chat = (id: string) => ({ id, code: id, status: "open", created_at: iso(1), closed_at: null, is_spam: false, subject: null, summary: null, customers: { name: "B", email: null, phone: "+919000055555", instagram_username: null }, channels: { kind: "whatsapp" } });
  // Store hours question, Aliya answered after the customer: AI answered, stays open at L0.
  await applyChat(repo, chat("a1"), [
    { id: "1", role: "user", content: "What are your store timings?", type: "text", created_at: iso(1) },
    { id: "2", role: "pilot", content: "10 am to 7 pm.", type: "ai_generated", created_at: iso(1) },
  ], new Date(iso(1)));
  // Same question, no AI reply yet: a person must look (L1), not closed.
  await applyChat(repo, chat("a2"), [{ id: "1", role: "user", content: "What are your store timings?", type: "text", created_at: iso(1) }], new Date(iso(1)));
  const answered = (await repo.getTicket("sp:a1"))!;
  const waiting = (await repo.getTicket("sp:a2"))!;
  assert.equal(answered.aiAnswered, true);
  assert.equal(answered.status !== "closed", true, "not closed at once");
  assert.equal(waiting.aiAnswered, false);
  assert.equal(waiting.level, "L1");
  assert.equal(await autoCloseAiAnswered(repo, new Date(iso(10))).then((x) => x.length), 0, "not before 24 hours");
  const closed = await autoCloseAiAnswered(repo, new Date(Date.UTC(2026, 10, 13, 2)));
  assert.deepEqual(closed, ["sp:a1"]);
  assert.equal((await repo.listEvents("sp:a1")).some((e) => e.kind === "auto_closed_no_response"), true);
  assert.equal(isAiAnswered({ scenarioId: "D2", type: "actionable", warnings: [], confidence: 0.9 }, cleanMessages([{ id: "1", role: "user", content: "x", type: "text", created_at: iso(1) }, { id: "2", role: "pilot", content: "y", type: "ai_generated", created_at: iso(2) }])), false, "an order question is never AI answered");
});

test("webhook: valid signature passes; wrong, missing secret or old ones are refused", () => {
  const secret = "whsec-test-1234567890";
  const now = Date.UTC(2026, 10, 12, 10);
  const ts = String(Math.floor(now / 1000));
  const body = JSON.stringify({ event: "chat.updated" });
  const sig = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  assert.deepEqual(verifyWebhook({ secret, timestamp: ts, signature: sig, body, now }), { ok: true });
  assert.equal(verifyWebhook({ secret, timestamp: ts, signature: `sha256=${sig}`, body, now }).ok, true);
  assert.equal(verifyWebhook({ secret, timestamp: ts, signature: sig, body: `${body} `, now }).ok, false);
  assert.equal(verifyWebhook({ secret, timestamp: ts, signature: sig, body, now: now + 6 * 60_000 }).ok, false);
  assert.equal(verifyWebhook({ secret: "", timestamp: ts, signature: sig, body, now }).ok, false);
});

test("old CX- tickets move to their Sagepilot key (or a W- number), keeping their events; old records are renamed", async () => {
  const t = (id: string, external?: { system: "sagepilot"; id: string; code: string | null }) => ({
    id, customerUid: "+919000077777", channel: "whatsapp" as const, createdAt: iso(1), subject: "x", body: "x", bucket: "D", scenarioId: "D2", secondaryScenarioIds: [], type: "actionable" as const,
    priority: "P2" as const, label: "Medium" as const, level: "L1" as const, queueId: "logistics", status: "open" as const, entities: { orderRefs: [], brands: [] }, confidence: 0.8, explanation: [], warnings: [],
    sentiment: { tone: "neu" as const, score: 0, signals: [] }, contactCount: 1, slaFirstResponseDueAt: iso(2), slaResolutionDueAt: iso(20), reopenCount: 0, firstResponseAt: iso(1), external,
  });
  await store.commit({ tickets: [t("CX-10001", { system: "sagepilot", id: "uuid-9", code: "20028" }), t("CX-10002")], events: [{ id: "e1", ticketId: "CX-10001", at: iso(1), actorId: "sagepilot", kind: "agent_replied", payload: { text: "Answered by the AI in Sagepilot" } }], customers: [], interactions: [], calls: [] });
  const moved = await migrateTicketIds(store, await store.getTickets(["CX-10001", "CX-10002"]));
  assert.equal(moved, 2);
  const keys = await store.allKeys();
  assert.ok(keys.includes("sp:uuid-9") && keys.some((k) => k.startsWith("W-")) && !keys.some((k) => k.startsWith("CX-")));
  const sp = (await store.getTicket("sp:uuid-9"))!;
  assert.equal(sp.ref, "#20028");
  assert.equal(sp.firstResponseAt, undefined, "an AI reply is not a first response");
  assert.equal(sp.firstAiReplyAt, iso(1));
  assert.equal((await store.getEvents("sp:uuid-9")).length, 1);
  const [legacy] = await store.kv.run([["EXISTS", "cx:legacy:t:CX-10001"]]);
  assert.equal(legacy, 1, "kept, not deleted");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryCxRepository } from "../src/features/cx/data/adapters/mock/memory-repo";
import { classify } from "../src/features/cx/domain/classifier";
import { SCENARIOS } from "../src/features/cx/domain/config";
import { extractEntities, pincodeInfo } from "../src/features/cx/domain/entities";
import { ahtByPerson, ahtMs, artMs, frtMs, holdMs } from "../src/features/cx/domain/metrics";
import { route } from "../src/features/cx/domain/routing";
import { assign, hold, ingest, maskPhone, resolve, resume, startWork, takeOwnership, CxError } from "../src/features/cx/domain/service";
import { dueDates, slaState } from "../src/features/cx/domain/sla";
import { customerText, normalise } from "../src/features/cx/domain/text";
import type { TicketEvent } from "../src/features/cx/domain/types";

const T0 = new Date("2026-11-03T05:00:00Z");
const min = (n: number) => new Date(T0.getTime() + n * 60_000);
const run = (text: string, channel: "whatsapp" | "instagram" | "call" = "whatsapp") => {
  const c = classify({ text, channel });
  return { c, r: route(c) };
};

test("entities: PIK numbers, pincodes and COD zone", () => {
  const e = extractEntities("Order #PIK4905 and pik 3871, pin 743370, ₹26,000 COD");
  assert.deepEqual(e.orderRefs, ["PIK4905", "PIK3871"]);
  assert.equal(e.pincode, "743370");
  assert.equal(e.codEligible, false);
  assert.equal(e.amountRupees, 26000);
  assert.equal(e.paymentMethod, "cod");
  assert.equal(pincodeInfo("56001").valid, false);
  assert.deepEqual(pincodeInfo("560300"), { valid: true, inBangalore: true, codEligible: true });
  assert.equal(pincodeInfo("743370").codEligible, false);
  assert.equal(extractEntities("pin 56001").pincodeValid, false);
});

test("normalise maps Hinglish to plain English and customerText drops the AI's sentences", () => {
  assert.match(normalise("Mera order kab aayega?").text, /delivery eta/);
  assert.match(normalise("paisa kat gaya").text, /money deducted/);
  assert.match(normalise("agent se baat karni hai").text, /talk to human/);
  assert.equal(customerText("Aliya confirmed the order for COD. My product is broken."), "My product is broken.");
});

test("hard rules win and set the level", () => {
  assert.deepEqual([run("The appliance sparked and caught fire").c.scenarioId, run("The appliance sparked and caught fire").r.level], ["I4", "L3"]);
  assert.equal(run("I will go to the consumer forum, this is fraud").r.level, "L3");
  assert.equal(run("paisa kat gaya but order nahi aaya").c.scenarioId, "D5");
  assert.equal(run("paisa kat gaya but order nahi aaya").r.priority, "P0");
  assert.equal(run("Product arrived damaged, box was crushed").c.scenarioId, "E5");
  assert.equal(run("I want a refund").c.scenarioId, "D9");
  assert.equal(run("You sent the wrong product").c.scenarioId, "G3");
});

test("named case PIK4905: COD outside the zone is flagged and never auto-resolved", () => {
  const { c, r } = run("Epson L8050 order confirm koriye. Payment COD. pin 743370 #PIK4905");
  assert.ok(["D1", "D7"].includes(c.scenarioId), c.scenarioId);
  assert.equal(c.type, "actionable");
  assert.equal(r.level, "L1");
  assert.ok(r.flags.includes("cod_not_eligible"));
  assert.match(r.warnings.join(" "), /Do not confirm COD/);
  assert.equal(r.autoResolvable, false);
});

test("named cases from the brief", () => {
  const demo = run("Nobody came for my demo, waited all day");
  assert.deepEqual([demo.c.scenarioId, demo.r.priority, demo.r.label, demo.r.level, demo.r.queueId], ["B10", "P0", "High", "L1", "demo_ops"]);
  const hi = run("hi");
  assert.deepEqual([hi.c.scenarioId, hi.r.priority, hi.r.label, hi.r.level, hi.r.autoResolvable], ["X1", "P3", "Low", "L0", true]);
  const job = run("Applying for video editor role");
  assert.deepEqual([job.c.scenarioId, job.r.queueId], ["X2", "hr"]);
  assert.equal(SCENARIOS.find((s) => s.id === "X2")?.excludeFromCx, true);
  const human = run("agent agent talk to human");
  assert.deepEqual([human.c.scenarioId, human.r.priority, human.r.level], ["J2", "P0", "L1"]);
  const unknown = run("asdf qwerty");
  assert.deepEqual([unknown.r.queueId, unknown.r.level, unknown.c.needsReview], ["others", "L1", true]);
});

test("every scenario in the taxonomy has a working default route", () => {
  for (const s of SCENARIOS) {
    const c = { ...classify({ text: "hi", channel: "whatsapp" }), scenarioId: s.id, bucket: s.bucket, basePriority: s.priority, type: s.type, forcedLevel: s.level ?? null, needsReview: false };
    const r = route(c);
    assert.ok(r.queueId, s.id);
    assert.ok(["L0", "L1", "L3"].includes(r.level), s.id);
  }
});

test("upset customers and repeat contacts move the label up", () => {
  const angry = run("WORST service ever!!! where is my order");
  assert.equal(angry.c.sentiment.tone, "neg");
  assert.equal(angry.r.label, "High");
  const c = classify({ text: "where is my order", channel: "whatsapp" });
  assert.equal(route(c, { sameIssueCount: 3 }).priority, "P1");
});

test("SLA: at risk at 80%, paused on brand hold, breached after", () => {
  const d = dueDates("P1", T0.toISOString(), "whatsapp");
  const t = { createdAt: T0.toISOString(), slaFirstResponseDueAt: d.firstResponseDueAt, slaResolutionDueAt: d.resolutionDueAt, firstResponseAt: min(5).toISOString(), status: "open" as const };
  assert.equal(slaState(t, [], min(60)).state, "ok");
  assert.equal(slaState(t, [], min(1200)).state, "at_risk");
  assert.equal(slaState(t, [], min(1500)).state, "breached");
  const holdEvents: TicketEvent[] = [
    { id: "1", ticketId: "x", at: min(100).toISOString(), actorId: "a", kind: "hold_started", payload: { reason: "brand" } },
    { id: "2", ticketId: "x", at: min(700).toISOString(), actorId: "a", kind: "hold_ended", payload: {} },
  ];
  assert.equal(slaState(t, holdEvents, min(1500)).state, "ok", "600 minutes on brand hold do not count");
  assert.equal(slaState({ ...t, firstResponseAt: undefined }, [], min(13)).state, "at_risk", "first response clock");
  assert.equal(dueDates("P0", T0.toISOString(), "whatsapp", true).resolutionDueAt, min(120).toISOString(), "VIP halves the target");
});

test("AHT, ART and FRT come from events, with a brand hold and a reopen", () => {
  const e = (n: number, kind: TicketEvent["kind"], actorId = "khadija", payload = {}): TicketEvent => ({ id: `${n}-${kind}`, ticketId: "t", at: min(n).toISOString(), actorId, kind, payload });
  const events = [
    e(0, "created", "system"),
    e(10, "work_started"),
    e(20, "agent_replied"),
    e(30, "hold_started", "khadija", { reason: "brand" }),
    e(90, "hold_ended"),
    e(95, "work_started"),
    e(105, "resolved"),
    e(105, "closed"),
    e(200, "reopened", "system"),
    e(210, "work_started", "sales_owner"),
    e(230, "resolved", "sales_owner"),
    e(230, "closed", "sales_owner"),
  ];
  assert.equal(frtMs(events), 20 * 60_000);
  assert.deepEqual(ahtByPerson(events, min(300)), { khadija: 30 * 60_000, sales_owner: 20 * 60_000 });
  assert.equal(ahtMs(events, min(300)), 50 * 60_000);
  assert.deepEqual(artMs(events), { total: 230 * 60_000, excludingHold: 170 * 60_000 });
  assert.equal(holdMs(events, min(300)), 60 * 60_000);
  assert.ok(ahtMs(events, min(300)) <= artMs(events)!.total);
  assert.equal(artMs(events.slice(0, 9)), null, "reopened and not closed again: ART still running");
});

test("missed calls: third call from the same number is P0 and must go to a person", async () => {
  const repo = new MemoryCxRepository();
  const phone = "+919000012345";
  const first = await ingest(repo, { channel: "missed_call", phone }, min(0));
  assert.equal(first.ticket.queueId, "callbacks");
  await ingest(repo, { channel: "missed_call", phone }, min(5));
  const third = await ingest(repo, { channel: "missed_call", phone }, min(9));
  assert.equal(third.mergedIntoCallback, true);
  assert.equal(third.ticket.id, first.ticket.id);
  assert.equal(third.ticket.priority, "P0");
  assert.match(third.ticket.warnings.join(" "), /person must call back/);
  assert.equal((await repo.listTickets()).length, 1);
});

test("reopen: same issue on the same order reopens; a different issue is a new ticket", async () => {
  const repo = new MemoryCxRepository();
  const phone = "9000054321";
  const emi = await ingest(repo, { channel: "whatsapp", phone, text: "EMI not approved for PIK5001, payment rejected" }, min(0));
  assert.equal(emi.ticket.scenarioId, "D10");
  const actor = { id: "khadija", role: "l1" as const };
  await resolve(repo, emi.ticket.id, { comment: "Explained EMI options", closeReason: "Action done", resolutionType: "actionable" }, actor, min(30));
  const again = await ingest(repo, { channel: "whatsapp", phone, text: "EMI failed again for PIK5001" }, min(600));
  assert.equal(again.reopened, true);
  assert.equal(again.ticket.id, emi.ticket.id);
  assert.equal(again.ticket.reopenCount, 1);
  const delivery = await ingest(repo, { channel: "whatsapp", phone, text: "PIK5001 delivery delayed, still waiting" }, min(700));
  assert.equal(delivery.reopened, false);
  assert.notEqual(delivery.ticket.id, emi.ticket.id);
  assert.equal(delivery.ticket.customerUid, emi.ticket.customerUid);
  assert.equal(delivery.ticket.parentTicketId, emi.ticket.id);
});

test("social message with no phone: unidentified customer, raw text kept", async () => {
  const repo = new MemoryCxRepository();
  const r = await ingest(repo, { channel: "instagram", handle: "@riya.decor", text: "Your robot vacuum stopped working in 2 weeks" }, min(0));
  assert.match(r.ticket.customerUid, /^unidentified:instagram:@riya\.decor$/);
  assert.equal(r.ticket.body, "Your robot vacuum stopped working in 2 weeks");
  assert.ok((await repo.getCustomer(r.ticket.customerUid))!.flags.includes("unidentified"));
});

test("actions write events; closing needs a comment; viewers cannot act; phones are masked", async () => {
  const repo = new MemoryCxRepository();
  const { ticket } = await ingest(repo, { channel: "whatsapp", phone: "9000011111", text: "My Dreame stopped working" }, min(0));
  const l1 = { id: "khadija", role: "l1" as const };
  await takeOwnership(repo, ticket.id, l1, min(1));
  await startWork(repo, ticket.id, l1, min(2));
  await assign(repo, ticket.id, "after_sales", l1, min(10));
  await hold(repo, ticket.id, "brand", l1, min(11));
  await resume(repo, ticket.id, l1, min(40));
  await assert.rejects(resolve(repo, ticket.id, { comment: " ", closeReason: "Action done", resolutionType: "actionable" }, l1, min(50)), CxError);
  await assert.rejects(startWork(repo, ticket.id, { id: "v", role: "viewer" }, min(50)), /Viewers/);
  await resolve(repo, ticket.id, { comment: "Engineer visit done", closeReason: "Action done", resolutionType: "actionable" }, l1, min(60));
  const kinds = (await repo.listEvents(ticket.id)).map((e) => e.kind);
  assert.deepEqual(kinds, ["created", "classified", "ownership_taken", "work_started", "assigned", "level_changed", "hold_started", "hold_ended", "resolved", "closed"]);
  assert.equal(maskPhone("+919876544417", "l2"), "+91 98•••• 4417");
  assert.equal(maskPhone("+919876544417", "l1"), "+91 98765 44417");
});

test("praise that mentions a demo is feedback, not a demo booking", () => {
  assert.equal(run("Thanks for the great service, the demo guy was very helpful").c.scenarioId, "J3");
  assert.equal(run("Hi, I want to book a free home demo of Dreame L50").c.scenarioId, "B1");
  assert.equal(run("mujhe demo chahiye").c.scenarioId, "B1");
});

test("real Sagepilot patterns: ad clicks, Hinglish prices, HTML and product-only messages", () => {
  const ad = run("Hi! I'd like to know more.");
  assert.deepEqual([ad.c.scenarioId, ad.r.queueId, ad.r.level, ad.r.autoResolvable], ["X4", "sales", "L1", false]);
  assert.equal(run("Hi! I'd like to know more.").c.scenarioId, "X4", "same answer twice (no regex state)");
  assert.equal(run("Hi! I'd like to know more. I phone 15 kinte ka h").c.scenarioId, "C2");
  assert.match(run("Hi! I'd like to know more. I phone 15 kinte ka h").c.explanation[0], /ad/);
  assert.equal(run("Humko iPhone milega").c.scenarioId, "C5");
  assert.equal(run("Send photos and quote iPhone 16").c.scenarioId, "C2");
  assert.equal(run("T30<br /> N50...demo").c.scenarioId, "B1");
  assert.equal(run('Check out Apple iPhone 15 (128 GB) - Blue <a href="https://x">link</a>').c.scenarioId, "C1");
});

test("an ad lead asking the price goes to Sales, not an automatic answer", () => {
  const lead = run("Hi! I'd like to know more. iPhone 15 price?");
  assert.deepEqual([lead.c.scenarioId, lead.r.level, lead.r.queueId, lead.r.autoResolvable], ["C2", "L1", "sales", false]);
  assert.equal(run("iPhone 15 price?").r.level, "L0", "without the ad it is still a quick AI answer");
});

test("no false alarms: a buyer's question is not a damage report, price 'cheating' is not a legal threat", () => {
  assert.notEqual(run("Before placing the order, please confirm it is genuine and not damaged").c.scenarioId, "E5");
  assert.equal(run("Product arrived damaged, box was crushed").c.scenarioId, "E5");
  assert.equal(run("mera product toot gaya").c.scenarioId, "E5");
  const price = run("Advertised rs 33900 but showing more, that's cheating");
  assert.notEqual(price.c.scenarioId, "I2");
  assert.equal(price.c.sentiment.tone, "neg");
  assert.equal(run("I will go to the consumer forum").c.scenarioId, "I2");
});

test("a what-if question about damage is a pre-sales question, not a damage report", () => {
  assert.notEqual(run("Will I get a replacement if the product arrives damaged?").c.scenarioId, "E5");
});

test("asking about the refund policy before buying is not a refund request", () => {
  assert.notEqual(run("Before I order, what is your refund policy? Am I eligible for a refund if it is defective?").c.scenarioId, "D9");
  assert.equal(run("Refund not received for PIK4019, it's been 10 days").c.scenarioId, "D9");
});

test("a buyer asking 'is it a scam?' is a trust question, not a legal threat", () => {
  assert.notEqual(run("I want to buy iphone 15. Is it some kind of scam or something? How can I trust").c.scenarioId, "I2");
  assert.equal(run("This is a scam, I will file a police complaint").c.scenarioId, "I2");
});

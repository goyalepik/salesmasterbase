import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { AI_SALE_ASK, AI_SALE_DONE, AI_SALE_MORE, asksForPaymentLink, mightBeSale, snap, snapPoc, type AiSaleRead, type SaleModel, type ThreadMessage } from "../src/lib/ai/sale-reader";
import { MemoryRepository } from "../src/lib/memory-repository";
import { AI_PICK_ACTION, handleAiSaleMessage, handleAiSalePick, readPickValue, type AiSaleDeps } from "../src/lib/slack/ai-sale";
import { handleSlackEvent } from "../src/lib/slack/handle-event";
import { HUBS, SALE_FORM_MARKER } from "../src/lib/slack/sale-form";
import { NOW, SALES_CHANNEL, SALESPERSON, setup } from "./slack-ops-helpers";

const ROOT = "1761799000.000100";

function fullRead(extra: Partial<AiSaleRead> = {}): AiSaleRead {
  return {
    isNewSale: true,
    customer: "Asha Rao",
    phone: "+91 98450 12345",
    email: null,
    address: "12 MG Road, Indiranagar",
    city: "Bangalore",
    state: null,
    pincode: "560038",
    billingAddress: null,
    gst: null,
    products: [{ name: "l50s pro ultra", model: "Dreame L50s", offeredPrice: 65000, qty: 1 }],
    hub: "hsr",
    poc: "ibrahim",
    cxType: "new",
    saleSource: "home demo",
    saleType: "same day",
    paymentStatus: "Full paid",
    paymentMode: "gpay",
    amountReceived: null,
    utr: "431298765432",
    expectedDelivery: null,
    accessories: null,
    extendedWarranty: null,
    installation: null,
    notes: null,
    ...extra,
  };
}

/** A fake AI: the sale read for "sale", "not sure" for the product chooser. */
function fakeModel(read: AiSaleRead) {
  const seen: string[] = [];
  const model: SaleModel = async (request) => {
    seen.push(request.user);
    if (request.name === "pick_product") return { sku: null, sure: false };
    return read;
  };
  return { model, seen };
}

async function reader(read: AiSaleRead, thread: ThreadMessage[] = []) {
  const ctx = await setup();
  const { model, seen } = fakeModel(read);
  const afterOrders: string[] = [];
  const client = { ...ctx.slack.client, replies: async () => ({ ok: true, messages: thread }) };
  const deps: AiSaleDeps = {
    ops: { ...ctx.deps, slack: client },
    model,
    now: () => NOW,
    catalogue: () => ctx.store.searchProducts("", 5000),
    displayName: async (id) => (id === SALESPERSON ? "Ibrahim" : "Someone"),
    afterOrder: async (order) => void afterOrders.push(order.id),
  };
  return { ...ctx, deps, seen, afterOrders };
}

const message = "asha rao 9845012345 l50s pro ultra 65k full paid gpay utr 431298765432 hsr hub home demo same day new cx 12 MG road indiranagar blr 560038";

test("snap reads loose words onto the form's choices", () => {
  assert.equal(snap("hsr", HUBS, { hsr: "HSR HQ" }), "HSR HQ");
  assert.equal(snap("JAYANAGAR", HUBS), "Jayanagar");
  assert.equal(snap("somewhere", HUBS), null);
  assert.equal(snapPoc("ibrahim"), "Ibrahim");
  assert.equal(snapPoc("Abdul"), "Abdul Rehman");
  assert.equal(snapPoc("New Person"), "New Person");
  assert.equal(mightBeSale("good morning team"), false);
  assert.equal(mightBeSale(message), true);
});

test("a complete message in plain words becomes the order at once, like the form", async () => {
  const ctx = await reader(fullRead());
  const outcome = await handleAiSaleMessage(ctx.deps, { channel: SALES_CHANNEL, ts: ROOT, threadTs: null, text: message, userId: SALESPERSON });
  assert.equal(outcome, "order");
  const posts = ctx.slack.of("postMessage");
  const card = posts.find((p) => !p.thread_ts)!;
  assert.match(String(card.text), new RegExp(SALE_FORM_MARKER));
  assert.match(String(card.text), /Name - Asha Rao/);
  const done = posts.find((p) => p.thread_ts === ROOT)!;
  assert.match(String(done.text), /Done: \*EPK-/);
  assert.ok(String(done.text).includes(AI_SALE_DONE));
  assert.equal(ctx.afterOrders.length, 1);
  const order = (await ctx.store.getOrder(ctx.afterOrders[0]!))!;
  assert.equal(order.customerName, "Asha Rao");
  assert.equal(order.phone, "9845012345");
  assert.equal(order.hub, "HSR HQ");
  assert.equal(order.poc, "Ibrahim");
  assert.equal(order.lines[0]!.sku, "ep-dr-l50s-pu");
  assert.equal(order.lines[0]!.offeredPriceMinor, 6_500_000);
  assert.match(order.declaredPaymentStatus ?? "", /^Full paid, ₹65,000 received/);
  assert.match(order.declaredPaymentMode ?? "", /^UPI, UTR 431298765432/);
});

test("missing details are asked in the thread, and no order is made", async () => {
  const ctx = await reader(fullRead({ phone: null, hub: null, poc: null }));
  const outcome = await handleAiSaleMessage(ctx.deps, { channel: SALES_CHANNEL, ts: ROOT, threadTs: null, text: message, userId: SALESPERSON });
  assert.equal(outcome, "asked");
  const posts = ctx.slack.of("postMessage");
  assert.equal(posts.length, 1);
  assert.equal(posts[0]!.thread_ts, ROOT);
  const text = String(posts[0]!.text);
  assert.ok(text.includes(AI_SALE_ASK));
  assert.match(text, /Customer phone/);
  // The hub is a small thing: mentioned, but not what holds the order back.
  assert.doesNotMatch(text, /Hub/);
  assert.match(JSON.stringify(posts[0]!.blocks), /Also useful if you have them: Hub/);
  // The person who posted is on the team list, so they are the POC: not asked.
  assert.doesNotMatch(JSON.stringify(posts[0]!.blocks), /POC/);
  assert.equal(ctx.afterOrders.length, 0);
});

test("only small things missing: the order is made at once and the bot asks for them after", async () => {
  const thread: ThreadMessage[] = [{ ts: ROOT, user: SALESPERSON, text: message }];
  const ctx = await reader(fullRead({ saleSource: "walk in", saleType: null, hub: null, pincode: null, paymentMode: "online" }), thread);
  assert.equal(await handleAiSaleMessage(ctx.deps, { channel: SALES_CHANNEL, ts: ROOT, threadTs: null, text: message, userId: SALESPERSON }), "order");
  const done = ctx.slack.of("postMessage").find((p) => p.thread_ts === ROOT)!;
  const text = String(done.text);
  assert.match(text, /If you can, reply here with: .*Pincode.*Hub.*Home Demo or Virtual Demo.*Follow up or same day.*Paid by/);
  assert.ok(text.includes(AI_SALE_MORE));
  const order = (await ctx.store.getOrder(ctx.afterOrders[0]!))!;
  assert.equal(order.hub, null);
  assert.equal(order.saleSource, null);
  assert.equal(order.pincode, null);
  assert.equal(order.shippingAddress, "12 MG Road, Indiranagar, Bangalore, Karnataka");
  assert.match(order.declaredPaymentStatus ?? "", /^Full paid/);
  assert.equal(order.declaredPaymentMode, "UTR 431298765432");

  // A reply with the details goes into the order's notes.
  thread.push({ ts: "1761799000.000200", bot_id: "B1", text });
  const reply = { channel: SALES_CHANNEL, ts: "1761799000.000300", threadTs: ROOT, text: "hebbal, home demo, follow up, gpay", userId: SALESPERSON };
  await handleAiSaleMessage(ctx.deps, reply);
  const events = (await ctx.store.getOrder(order.id))!.events;
  assert.ok(events.some((e) => e.summary.includes("From the Slack thread: hebbal, home demo, follow up, gpay")));
  assert.match(String(ctx.slack.last("postMessage")?.text), /Added to EPK-\d+'s notes/);
});

test("payment words: a payment link is not paid, and unpaid is not paid", () => {
  assert.equal(snap("payment link", ["Full paid", "Partial", "To be collected"], { paymentlink: "To be collected", paid: "Full paid" }), "To be collected");
  assert.equal(snap("unpaid", ["Full paid", "Partial", "To be collected"], { paid: "Full paid" }), null);
  assert.equal(snap("onspot", ["Follow up", "Same day"], { onspot: "Same day" }), "Same day");
});

test("a reply in the thread completes the sale, and only once", async () => {
  const thread: ThreadMessage[] = [
    { ts: ROOT, user: SALESPERSON, text: "asha rao l50s 65k full paid gpay" },
    { ts: "1761799000.000200", bot_id: "B1", text: `To make the order I still need: Customer phone. ${AI_SALE_ASK}` },
    { ts: "1761799000.000300", user: SALESPERSON, text: "9845012345" },
  ];
  const ctx = await reader(fullRead(), thread);
  const reply = { channel: SALES_CHANNEL, ts: "1761799000.000300", threadTs: ROOT, text: "9845012345", userId: SALESPERSON };
  assert.equal(await handleAiSaleMessage(ctx.deps, reply), "order");
  // The AI read the whole thread, the bot's question included.
  assert.match(ctx.seen[0]!, /Bot: To make the order/);
  assert.match(ctx.seen[0]!, /Reply from Ibrahim: 9845012345/);
  assert.equal(await handleAiSaleMessage(ctx.deps, reply), "ignored");
  assert.equal(ctx.afterOrders.length, 1);
});

test("a reply in a thread the bot is not asking in is left alone", async () => {
  const ctx = await reader(fullRead(), [{ ts: ROOT, user: SALESPERSON, text: message }]);
  assert.equal(await handleAiSaleMessage(ctx.deps, { channel: SALES_CHANNEL, ts: "1761799000.000300", threadTs: ROOT, text: "paid", userId: SALESPERSON }), "ignored");
  assert.equal(ctx.seen.length, 0);
});

test("a message that is not a new sale goes to the old rules", async () => {
  const ctx = await reader(fullRead({ isNewSale: false }));
  assert.equal(await handleAiSaleMessage(ctx.deps, { channel: SALES_CHANNEL, ts: ROOT, threadTs: null, text: "PIK3918 balance 20000 received via upi today", userId: SALESPERSON }), "not_sale");
  assert.equal(ctx.slack.of("postMessage").length, 0);
});

test("a product that could be several items gets buttons; a tap makes the order", async () => {
  const read = fullRead({ products: [{ name: "dreame ultra", model: "Dreame Ultra", offeredPrice: 65000, qty: 1 }] });
  const thread: ThreadMessage[] = [{ ts: ROOT, user: SALESPERSON, text: message }];
  const ctx = await reader(read, thread);
  assert.equal(await handleAiSaleMessage(ctx.deps, { channel: SALES_CHANNEL, ts: ROOT, threadTs: null, text: message, userId: SALESPERSON }), "asked");
  const ask = ctx.slack.last("postMessage") as { text: string; blocks: Array<{ type: string; elements?: Array<{ action_id: string; value: string; text: { text: string } }> }> };
  thread.push({ ts: "1761799000.000200", bot_id: "B1", text: ask.text });
  const buttons = ask.blocks.find((b) => b.type === "actions")!.elements!;
  assert.ok(buttons.length >= 3, "two Dreame Ultras and None of these");
  const l50 = buttons.find((b) => /L50s/.test(b.text.text))!;
  assert.ok(l50.action_id.startsWith(AI_PICK_ACTION));
  const value = readPickValue(l50.value)!;
  assert.equal(value.s, "ep-dr-l50s-pu");

  // The bot's pick note lands in the thread; the fake thread grows as Slack's would.
  const post = ctx.deps.ops.slack.postMessage;
  ctx.deps.ops.slack.postMessage = async (args) => {
    const result = await post(args);
    if (args.thread_ts === ROOT) thread.push({ ts: result.ts!, bot_id: "B1", text: args.text });
    return result;
  };
  const outcome = await handleAiSalePick(ctx.deps, { value, userId: SALESPERSON, question: { ts: "1761799000.000200", text: ask.text, blocks: ask.blocks } });
  assert.equal(outcome, "order");
  const order = (await ctx.store.getOrder(ctx.afterOrders[0]!))!;
  assert.equal(order.lines[0]!.sku, "ep-dr-l50s-pu");
  // The question lost its buttons.
  const updated = ctx.slack.of("update").find((u) => u.ts === "1761799000.000200") as { blocks: Array<{ type: string }> };
  assert.equal(updated.blocks.some((b) => b.type === "actions"), false);
});

// ── Events: who the reader sees ──────────────────────────────────────────────

const secret = "test-signing-secret";
const nowSeconds = 1_761_800_000;
const sign = (raw: string) => `v0=${createHmac("sha256", secret).update(`v0:${nowSeconds}:${raw}`).digest("hex")}`;

async function deliver(repo: MemoryRepository, event: Record<string, unknown>, aiSale: (m: { text: string }) => Promise<"order" | "asked" | "not_sale" | "ignored">) {
  const rawBody = JSON.stringify({ type: "event_callback", event_id: `Ev-${String(event.ts)}`, event_time: nowSeconds, event: { type: "message", channel: SALES_CHANNEL, ...event } });
  const tasks: Array<() => Promise<void>> = [];
  await handleSlackEvent({
    rawBody,
    timestamp: String(nowSeconds),
    signature: sign(rawBody),
    retryNum: null,
    retryReason: null,
    env: { mode: "live", signingSecret: secret, monitoredChannelId: SALES_CHANNEL, channelName: "#epik_cd-payment-updates" },
    repo,
    schedule: (task) => void tasks.push(task),
    nowSeconds,
    aiSale,
  });
  for (const task of tasks) await task();
}

test("events: a person's sale post goes to the reader and is not read twice; the form's text and bots never do", async () => {
  const repo = new MemoryRepository({ messages: [], extractions: [], exceptions: [], attempts: [], audit: [], channels: [] });
  const seen: string[] = [];
  const ai = async (m: { text: string }) => {
    seen.push(m.text);
    return m.text.startsWith("sale") ? ("order" as const) : ("not_sale" as const);
  };
  await deliver(repo, { user: SALESPERSON, text: "sale asha 9845012345 l50s 65k", ts: "1761800000.000001" }, ai);
  await deliver(repo, { user: SALESPERSON, text: "PIK3918 balance received 20000", ts: "1761800000.000002" }, ai);
  await deliver(repo, { bot_id: "B1", text: `Name - Asha\nSalesperson: <@${SALESPERSON}>\n${SALE_FORM_MARKER}`, ts: "1761800000.000003" }, ai);
  await deliver(repo, { bot_id: "B1", text: "Done: EPK-000001", ts: "1761800000.000004", thread_ts: "1761800000.000001" }, ai);
  assert.deepEqual(seen, ["sale asha 9845012345 l50s 65k", "PIK3918 balance received 20000"]);
  const messages = repo.snapshot().messages;
  const sale = messages.find((m) => m.slackMessageTs === "1761800000.000001")!;
  assert.equal(sale.processingStatus, "skipped");
  assert.match(sale.skipReason ?? "", /AI sale reader/);
  const payment = messages.find((m) => m.slackMessageTs === "1761800000.000002")!;
  assert.notEqual(payment.processingStatus, "skipped");
});

test("a request to make or send a payment link means the money has not come in", () => {
  assert.equal(asksForPaymentLink("First message, posted by Tushar:\nPayment status - Full\nPls generate payment link asap"), true);
  assert.equal(asksForPaymentLink("First message, posted by Asha:\nsend link pls"), true);
  assert.equal(asksForPaymentLink("First message, posted by Asha:\nfull paid via upi"), false);
  // The bot's own question mentions a payment link; that is not the salesperson asking.
  assert.equal(asksForPaymentLink("First message:\nasha 65k\n\nBot: How it will be collected: cash on delivery, payment link"), false);
});

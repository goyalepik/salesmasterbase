import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { MemoryRepository } from "../src/lib/memory-repository";
import type { OpsStore } from "../src/lib/ops/store";
import { createOpsOrderFromSale, handleOpsBlockActions, handleOpsViewSubmission } from "../src/lib/slack/ops-actions";
import { handleSlackEvent } from "../src/lib/slack/handle-event";
import { formatSale, legacySaleFields, readOpsSaleSubmission, saleModal, SALE_FORM_MARKER } from "../src/lib/slack/sale-form";
import { run, SALES_CHANNEL, SALESPERSON, setup, stateFor, submission, tap, type Answer } from "./slack-ops-helpers";

const L50 = { value: "ep-dr-l50s-pu", text: "DREAME L50s Pro Ultra Robot Vacuum & Mop · ep-dr-l50s-pu" };
const D30 = { value: "ep-dr-d30u-wh", text: "DREAME D30 Ultra Robot Vacuum and Mop · ep-dr-d30u-wh" };
const POST_TS = "1761800000.000001";

type Ctx = Awaited<ReturnType<typeof setup>>;

function saleAnswers(extra: Record<string, Answer> = {}): Record<string, Answer> {
  return {
    customer: "Asha Rao",
    phone: "98450 12345",
    product: L50,
    shipping_address: "12, 2nd Main, Hebbal, Bengaluru",
    pincode: "560024",
    hub: "Hebbal",
    cx_type: "New",
    poc: "Ibrahim",
    sale_source: "Walk-in",
    sale_type: "Same day",
    list_price: "89999",
    offered_price: "80000",
    payment_status: "Advance payment realized",
    payment_mode: "UPI",
    ...extra,
  };
}

/** The sale modal submit as the route runs it: post the legacy text, then create the order card. */
async function postSale(ctx: Ctx, extra: Record<string, Answer> = {}) {
  const read = readOpsSaleSubmission(stateFor(saleModal(SALES_CHANNEL), saleAnswers(extra)), SALESPERSON);
  assert.ok(read.ok, JSON.stringify(read));
  if (!read.ok) throw new Error("invalid sale");
  const posted = await ctx.slack.client.postMessage({ channel: SALES_CHANNEL, text: formatSale(legacySaleFields(read.sale)) });
  const order = await createOpsOrderFromSale(ctx.deps, { sale: read.sale, channel: SALES_CHANNEL, ts: posted.ts!, user: { id: SALESPERSON, name: "ibrahim" } });
  assert.ok(order);
  return order!;
}

function card(ctx: Ctx) {
  const update = ctx.slack.last("update");
  assert.ok(update, "card was updated");
  return update as { channel: string; ts: string; text: string; blocks: unknown[] };
}

async function press(ctx: Ctx, actionId: string, opts: Parameters<typeof tap>[2] = {}) {
  const handled = await handleOpsBlockActions(ctx.deps, tap(card(ctx).blocks, actionId, opts) as never);
  assert.equal(handled.body, null);
  await run(handled);
  return handled;
}

async function openForm(ctx: Ctx, actionId: string, opts: Parameters<typeof tap>[2] = {}) {
  const before = ctx.slack.of("viewsOpen").length;
  await press(ctx, actionId, opts);
  const opened = ctx.slack.of("viewsOpen");
  assert.equal(opened.length, before + 1, `${actionId} opened a form (ephemeral: ${JSON.stringify(ctx.slack.last("postEphemeral"))})`);
  return opened.at(-1)!.view as Record<string, unknown>;
}

async function submit(ctx: Ctx, view: Record<string, unknown>, answers: Record<string, Answer>, opts: Parameters<typeof submission>[2] = {}) {
  const handled = await handleOpsViewSubmission(ctx.deps, submission(view, answers, opts) as never);
  await run(handled);
  return handled;
}

async function order(store: OpsStore, id: string) {
  return (await store.getOrder(id))!;
}

test("a new sale becomes an order and the posted message becomes its card", async () => {
  const ctx = await setup();
  const created = await postSale(ctx);
  assert.equal(created.stage, "awaiting_payment");
  assert.equal(created.phone, "9845012345");
  assert.equal(created.source, "slack");
  assert.equal(created.slackChannelId, SALES_CHANNEL);
  assert.equal(created.slackMessageTs, POST_TS);
  assert.equal(created.createdBy, SALESPERSON);
  assert.equal(created.lines[0]!.sku, "ep-dr-l50s-pu");
  const update = card(ctx);
  assert.equal(update.ts, POST_TS);
  assert.ok(update.text.includes(SALE_FORM_MARKER), "legacy text kept as the message text");
  assert.equal(update.text, ctx.slack.of("postMessage")[0]!.text, "legacy text unchanged by the update");
  const ping = ctx.slack.of("postMessage").find((m) => m.channel === "CREVOPS01");
  assert.ok(ping, "RevOps pinged");
  assert.equal(ping!.text, `${created.id} needs you: <https://epik.slack.com/archives/${SALES_CHANNEL}/p${POST_TS.replace(".", "")}|open card> · Payment check`);
});

test("team pings are skipped when the channels are not set", async () => {
  const ctx = await setup();
  ctx.deps.teamChannels = {};
  await postSale(ctx);
  assert.equal(ctx.slack.of("postMessage").length, 1, "only the sale itself");
  assert.equal(ctx.slack.of("getPermalink").length, 0);
});

test("full journey: verify → reserve → dispatch → delivered, with thread notes and pings", async () => {
  const ctx = await setup([
    { slackUserId: "UOPS00001", name: "Riya", roles: ["admin"], hub: null },
  ]);
  const created = await postSale(ctx);

  const verify = await openForm(ctx, "ops:verify");
  assert.equal(verify.callback_id, "ops:verify");
  await submit(ctx, verify, { amount: "25,000", mode: "UPI", kind: "advance", reference: "1234" });
  let o = await order(ctx.store, created.id);
  assert.equal(o.stage, "awaiting_inventory");
  assert.equal(o.paidMinor, 2_500_000);
  assert.equal(o.codDueMinor, 5_500_000);
  const note = ctx.slack.of("postMessage").find((m) => m.thread_ts === POST_TS);
  assert.equal(note?.text, "Riya verified ₹25,000 UPI (UTR 1234). Sent to inventory. Balance ₹55,000.");
  assert.ok(ctx.slack.of("postMessage").some((m) => m.channel === "CINVENT01"), "inventory pinged");
  assert.match(JSON.stringify(card(ctx).blocks), /Available \d+ · Reserved \d+ · Incoming 0/);

  await press(ctx, "ops:reserve", { blockId: "line_actions:1" });
  o = await order(ctx.store, created.id);
  assert.equal(o.lines[0]!.status, "reserved");
  assert.equal(o.stage, "ready_to_dispatch");
  assert.ok(ctx.slack.of("postMessage").some((m) => m.thread_ts === POST_TS && String(m.text).startsWith("Riya reserved DREAME")));
  assert.ok(ctx.slack.of("postMessage").some((m) => m.channel === "CLOGIST01"), "logistics pinged");

  const dispatch = await openForm(ctx, "ops:dispatch");
  const serialBlock = (dispatch.blocks as Array<{ block_id?: string }>).find((b) => b.block_id?.startsWith("serial:"));
  assert.ok(serialBlock, "one serial box per reserved line");
  await submit(ctx, dispatch, { driver: "Manju", [serialBlock!.block_id!]: "SN-123", expected: "2026-10-31" });
  o = await order(ctx.store, created.id);
  assert.equal(o.stage, "out_for_delivery");
  assert.equal(o.lines[0]!.serialNo, "SN-123");
  assert.equal(o.driver, "Manju");

  const delivered = await openForm(ctx, "ops:delivered");
  const collected = (delivered.blocks as Array<{ block_id?: string; element?: { initial_value?: string } }>).find((b) => b.block_id === "collected");
  assert.equal(collected?.element?.initial_value, "55000", "prefilled with COD due");
  await submit(ctx, delivered, { mode: "Cash" });
  o = await order(ctx.store, created.id);
  assert.equal(o.stage, "delivered");
  assert.equal(o.codDueMinor, 0);
  assert.equal(o.installations.length, 1, "robot vacuum needs installation");
  assert.ok(ctx.slack.of("postMessage").some((m) => m.text === "Riya marked the order delivered and collected ₹55,000 Cash. Installation is due."));
});

test("clear without payment, then hold on an open PO", async () => {
  const ctx = await setup();
  const created = await postSale(ctx, { product: D30 });
  await submit(ctx, await openForm(ctx, "ops:clear"), { reason: "Finance approved by Bajaj" });
  assert.equal((await order(ctx.store, created.id)).stage, "awaiting_inventory");

  const hold = await openForm(ctx, "ops:hold_po", { blockId: "line_actions:1" });
  const select = (hold.blocks as Array<{ block_id?: string; element?: { options?: Array<{ value: string; text: { text: string } }> } }>).find((b) => b.block_id === "po")!;
  assert.equal(select.element!.options!.length, 1);
  assert.match(select.element!.options![0]!.text.text, /^PO-DEMO-0001 · Value-One Retail · ETA \d+ \w+ · 10 due$/);
  await submit(ctx, hold, { po: select.element!.options![0]!.value });
  const o = await order(ctx.store, created.id);
  assert.equal(o.lines[0]!.status, "awaiting_po");
  assert.equal(o.stage, "awaiting_stock");
  assert.ok(ctx.slack.of("postMessage").some((m) => String(m.text).includes("on PO-DEMO-0001")));
});

test("procure for the customer, mark ordered, receive", async () => {
  const ctx = await setup();
  const created = await postSale(ctx, { product: D30 });
  await submit(ctx, await openForm(ctx, "ops:clear"), { reason: "Repeat customer" });
  await submit(ctx, await openForm(ctx, "ops:procure", { blockId: "line_actions:1" }), { vendor: "Value-One", cost: "48,000", eta: "2026-11-03" });
  let o = await order(ctx.store, created.id);
  assert.equal(o.lines[0]!.status, "procuring");
  assert.equal(o.procurement[0]!.costMinor, 4_800_000);

  await submit(ctx, await openForm(ctx, "ops:proc_ordered", { blockId: "line_actions:1" }), { po_number: "VO-77" });
  o = await order(ctx.store, created.id);
  assert.equal(o.procurement[0]!.status, "ordered");
  assert.equal(o.procurement[0]!.eta, "2026-11-03", "ETA prefilled");

  await submit(ctx, await openForm(ctx, "ops:proc_received", { blockId: "line_actions:1" }), { serial: "IMEI-1" });
  o = await order(ctx.store, created.id);
  assert.equal(o.lines[0]!.status, "reserved");
  assert.equal(o.stage, "ready_to_dispatch");
});

test("reject puts a single-product order on hold; brand direct and Map SKU work on free-text products", async () => {
  const ctx = await setup();
  const rejected = await postSale(ctx);
  await submit(ctx, await openForm(ctx, "ops:clear"), { reason: "Trusted" });
  await submit(ctx, await openForm(ctx, "ops:reject", { blockId: "line_actions:1" }), { reason: "Discontinued colour" });
  assert.equal((await order(ctx.store, rejected.id)).stage, "on_hold");

  const typed = await postSale(ctx, { product: undefined as unknown as Answer, product_other: "Dyson V8 vacuum" });
  assert.equal(typed.lines[0]!.sku, null);
  await submit(ctx, await openForm(ctx, "ops:clear"), { reason: "Trusted" });
  const map = await openForm(ctx, "ops:map_sku", { blockId: "line_actions:1" });
  await submit(ctx, map, { sku: { value: "ep-dy-v8", text: "Dyson V8 Absolute Vacuum Cleaner · ep-dy-v8" } });
  let o = await order(ctx.store, typed.id);
  assert.equal(o.lines[0]!.sku, "ep-dy-v8");
  await press(ctx, "ops:brand_direct", { blockId: "line_actions:1" });
  o = await order(ctx.store, typed.id);
  assert.equal(o.lines[0]!.status, "brand_direct");
  assert.equal(o.stage, "ready_to_dispatch");
});

test("overflow: link Shopify and cancel", async () => {
  const ctx = await setup();
  const created = await postSale(ctx);
  await submit(ctx, await openForm(ctx, "ops:more", { option: "Link Shopify #PIK" }), { shopify: "pik3918" });
  assert.equal((await order(ctx.store, created.id)).shopifyOrderId, "#PIK3918");
  await submit(ctx, await openForm(ctx, "ops:more", { option: "Cancel order" }), { reason: "Customer changed mind" });
  const o = await order(ctx.store, created.id);
  assert.equal(o.stage, "cancelled");
  assert.match(card(ctx).blocks.length ? JSON.stringify(card(ctx).blocks) : "", /Cancelled/);
});

test("a direct button tapped twice acts once", async () => {
  const ctx = await setup();
  await postSale(ctx);
  await submit(ctx, await openForm(ctx, "ops:clear"), { reason: "Trusted" });
  const payload = tap(card(ctx).blocks, "ops:reserve", { blockId: "line_actions:1", actionTs: "1761800200.000100" });
  const first = await handleOpsBlockActions(ctx.deps, payload as never);
  const second = await handleOpsBlockActions(ctx.deps, payload as never);
  assert.equal(first.later.length, 1);
  assert.equal(second.later.length, 0);
});

test("a form submitted twice with the same answers acts once", async () => {
  const ctx = await setup();
  const created = await postSale(ctx);
  const view = await openForm(ctx, "ops:verify");
  const first = await submit(ctx, view, { amount: "10000", mode: "UPI", kind: "advance", send: [] }, { viewId: "VSAME" });
  assert.equal(first.body, null);
  const second = await submit(ctx, view, { amount: "10000", mode: "UPI", kind: "advance", send: [] }, { viewId: "VSAME" });
  assert.equal((second.body as { response_action: string }).response_action, "errors");
  const o = await order(ctx.store, created.id);
  assert.equal(o.payments.length, 1);
  assert.equal(o.paidMinor, 1_000_000);
  assert.equal(o.stage, "awaiting_payment", "unticked Send to inventory keeps it at payment check");
});

test("bad input and service refusals come back as form errors", async () => {
  const ctx = await setup();
  const created = await postSale(ctx);
  const view = await openForm(ctx, "ops:verify");
  const bad = await submit(ctx, view, { amount: "soon", mode: "UPI", kind: "advance" });
  assert.deepEqual(Object.keys((bad.body as { errors: Record<string, string> }).errors), ["amount"]);

  const clear = await openForm(ctx, "ops:clear");
  await submit(ctx, clear, { reason: "Trusted" });
  // The same form again (opened earlier, card now stale): the service refuses.
  const again = await submit(ctx, clear, { reason: "Trusted again" });
  const errors = (again.body as { response_action: string; errors: Record<string, string> }).errors;
  assert.match(errors.reason!, /not payment check/);
  assert.equal((await order(ctx.store, created.id)).stage, "awaiting_inventory");
});

test("people without the role get a private message instead of a form", async () => {
  const ctx = await setup([
    { slackUserId: "USALES0001", name: "Ibrahim", roles: ["sales"], hub: "Hebbal" },
    { slackUserId: "UREVOPS01", name: "Riya", roles: ["revops"], hub: null },
  ]);
  const created = await postSale(ctx);
  await press(ctx, "ops:verify", { user: "USALES0001" });
  assert.equal(ctx.slack.of("viewsOpen").length, 0);
  const ephemeral = ctx.slack.last("postEphemeral");
  assert.equal(ephemeral?.user, "USALES0001");
  assert.equal(ephemeral?.channel, SALES_CHANNEL);
  assert.equal(ephemeral?.text, "Only RevOps can verify payments.");

  // RevOps can, and the thread note uses the people-table name.
  const view = await openForm(ctx, "ops:verify", { user: "UREVOPS01" });
  await submit(ctx, view, { amount: "1000", mode: "Cash", kind: "advance" }, { user: "UREVOPS01" });
  assert.ok(ctx.slack.of("postMessage").some((m) => m.text === "Riya verified ₹1,000 Cash. Sent to inventory. Balance ₹79,000."));

  // Direct inventory buttons are refused by the service and reported privately.
  await press(ctx, "ops:reserve", { blockId: "line_actions:1", user: "UREVOPS01" });
  assert.equal(ctx.slack.last("postEphemeral")?.text, "Only the inventory team can decide stock.");
  assert.equal((await order(ctx.store, created.id)).lines[0]!.status, "pending");
});

// ── Events: the card edits must not create a second legacy sale ──────────────

const secret = "test-signing-secret";
const nowSeconds = 1_761_800_000;

function sign(rawBody: string) {
  return `v0=${createHmac("sha256", secret).update(`v0:${nowSeconds}:${rawBody}`).digest("hex")}`;
}

async function deliver(repo: MemoryRepository, payload: unknown) {
  const rawBody = JSON.stringify(payload);
  const tasks: Array<() => Promise<void>> = [];
  const response = await handleSlackEvent({
    rawBody,
    timestamp: String(nowSeconds),
    signature: sign(rawBody),
    retryNum: null,
    retryReason: null,
    env: { mode: "live", signingSecret: secret, monitoredChannelId: SALES_CHANNEL, channelName: "#epik_cd-payment-updates" },
    repo,
    schedule: (task) => void tasks.push(task),
    nowSeconds,
  });
  for (const task of tasks) await task();
  return response;
}

test("the card update (message_changed) does not store a second sale", async () => {
  const repo = new MemoryRepository({ messages: [], extractions: [], exceptions: [], attempts: [], audit: [], channels: [] });
  const text = `Name - Asha Rao\nProduct - DREAME\nOffered price - 80000\nSalesperson: <@${SALESPERSON}>\n${SALE_FORM_MARKER}`;
  await deliver(repo, { type: "event_callback", event_id: "Ev1", event_time: nowSeconds, event: { type: "message", channel: SALES_CHANNEL, bot_id: "B1", text, ts: POST_TS } });
  assert.equal(repo.snapshot().messages.length, 1);
  const response = await deliver(repo, {
    type: "event_callback",
    event_id: "Ev2",
    event_time: nowSeconds,
    event: { type: "message", subtype: "message_changed", channel: SALES_CHANNEL, ts: "1761800050.000200", hidden: true, message: { type: "message", bot_id: "B1", text, ts: POST_TS }, previous_message: { text, ts: POST_TS } },
  });
  assert.equal(response.status, 200);
  assert.equal(repo.snapshot().messages.length, 1, "edit ignored");
  assert.equal(repo.snapshot().messages[0]!.slackMessageTs, POST_TS);
});

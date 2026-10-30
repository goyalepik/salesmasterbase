import assert from "node:assert/strict";
import { test } from "node:test";
import { planFor, rulesAnswer, rulesBriefing } from "../src/lib/ai/fallback";
import { parseMarkdown } from "../src/lib/ai/markdown";
import { runTool, TOOLS, ToolError, type ToolContext } from "../src/lib/ai/tools";
import { inr, maskPhone, maskPhonesInText, shiftIstDate, todayIst } from "../src/lib/ai/util";
import { getDemoRepository } from "../src/lib/demo/repository";
import { buildDemoSeed } from "../src/lib/ops/demo-seed";
import { MemoryOpsStore } from "../src/lib/ops/memory-store";
import { loadSeed } from "../src/lib/ops/snapshot";

// Seed "now" is 12:00 IST; the tools run one hour later so 1-day-old orders are past 24h.
const SEED_NOW = new Date("2026-10-30T06:30:00Z");
const NOW = new Date(SEED_NOW.getTime() + 60 * 60 * 1000);

async function context(withRepo = false): Promise<ToolContext> {
  const store = new MemoryOpsStore();
  await loadSeed(store, buildDemoSeed(SEED_NOW));
  return { store, repo: withRepo ? getDemoRepository() : null, now: () => NOW };
}

const PHONE = /\b\d{10}\b/;

test("the registry has the expected read-only tools with object schemas", () => {
  const names = TOOLS.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "dispatch_queue", "get_order", "installations_due", "low_stock", "open_procurement", "open_purchase_orders",
    "pipeline_summary", "recent_activity", "sales_summary", "search_orders", "search_slack_messages", "stock_lookup", "stuck_orders",
  ]);
  for (const tool of TOOLS) {
    assert.equal(tool.inputSchema.type, "object");
    assert.ok(tool.description.length > 60, `${tool.name} needs a real description`);
  }
});

test("util formats rupees with Indian grouping and masks phones", () => {
  assert.equal(inr(12_345_600), "₹1,23,456");
  assert.equal(inr(-50_000), "-₹500");
  assert.equal(maskPhone("+91 98450 12345"), "******2345");
  assert.equal(maskPhonesInText("Call 9845012345 now"), "Call ******2345 now");
  assert.equal(shiftIstDate("2026-10-01", -1), "2026-09-30");
  assert.equal(todayIst(new Date("2026-10-30T19:00:00Z")), "2026-10-31");
});

test("search_orders filters by stage, masks phones and stamps today's IST date", async () => {
  const ctx = await context();
  const out = await runTool(ctx, "search_orders", { stage: "awaiting_payment" });
  assert.equal(out.data.total, 3);
  assert.equal(out.data.today_ist, "2026-10-30");
  const text = JSON.stringify(out.data);
  assert.doesNotMatch(text, PHONE);
  const first = (out.data.orders as Array<{ phone: string; id: string }>)[0];
  assert.match(first.phone, /^\*{6}\d{4}$/);
  assert.match(first.id, /^EPK-\d{6}$/);

  const capped = await runTool(ctx, "search_orders", { stage: "delivered", limit: 5 });
  assert.equal(capped.data.total, 40);
  assert.equal(capped.data.shown, 5);
});

test("get_order resolves EPK ids (padded) and Shopify numbers, and reports misses", async () => {
  const ctx = await context();
  const list = await ctx.store.listOrders({ stage: "delivered", limit: 1 });
  const target = list.items[0];
  const byId = await runTool(ctx, "get_order", { id: target.id.replace(/^EPK-0+/, "EPK-") });
  assert.equal(byId.data.found, true);
  assert.equal((byId.data.order as { id: string }).id, target.id);
  assert.match(String(byId.data.next_step), /\S/);
  const byShopify = await runTool(ctx, "get_order", { id: target.shopifyOrderId!.replace("#", "") });
  assert.equal((byShopify.data.order as { id: string }).id, target.id);
  const miss = await runTool(ctx, "get_order", { id: "EPK-999999" });
  assert.equal(miss.data.found, false);
});

test("pipeline_summary reports stage counts from the store", async () => {
  const ctx = await context();
  const out = await runTool(ctx, "pipeline_summary", {});
  const pipeline = out.data.pipeline as Array<{ code: string; orders: number }>;
  assert.equal(pipeline.find((p) => p.code === "awaiting_payment")?.orders, 3);
  assert.equal(pipeline.find((p) => p.code === "delivered")?.orders, 40);
  assert.equal(out.data.open_orders, 8);
});

test("sales_summary defaults to the 5-day incentive window and groups consistently", async () => {
  const ctx = await context();
  const byDay = await runTool(ctx, "sales_summary", {});
  assert.equal(byDay.data.from, "2026-10-26");
  assert.equal(byDay.data.to, "2026-10-30");
  const days = byDay.data.rows as Array<{ day: string; orders?: number; offered_inr?: number }>;
  assert.equal(days.length, 5);

  const all = await ctx.store.listOrders({ stage: "all", limit: 1000 });
  const start = new Date("2026-10-26T00:00:00+05:30").toISOString();
  const inWindow = all.items.filter((o) => o.createdAt >= start && o.stage !== "cancelled");
  const totals = byDay.data.totals as { orders: number; offered_inr: number };
  assert.equal(totals.orders, inWindow.length);
  assert.equal(totals.offered_inr, Math.round(inWindow.reduce((s, o) => s + o.offeredTotalMinor, 0) / 100));

  const byPoc = await runTool(ctx, "sales_summary", { group_by: "poc" });
  const pocRows = byPoc.data.rows as Array<{ orders: number }>;
  assert.equal(pocRows.reduce((s, r) => s + r.orders, 0), inWindow.length);
  assert.ok((byPoc.data.largest_orders as unknown[]).length > 0);

  await assert.rejects(runTool(ctx, "sales_summary", { from: "30-10-2026" }), ToolError);
  await assert.rejects(runTool(ctx, "sales_summary", { from: "2026-10-30", to: "2026-10-01" }), ToolError);
});

test("stock_lookup finds a product by name words and matches the store's free stock", async () => {
  const ctx = await context();
  const out = await runTool(ctx, "stock_lookup", { q: "DREAME L50s Pro Ultra" });
  assert.equal(out.data.match, "single");
  const product = out.data.product as { sku: string; free_available: number; recent_movements: unknown[] };
  assert.equal(product.sku, "ep-dr-l50s-pu");
  const level = await ctx.store.stockFor("ep-dr-l50s-pu");
  assert.equal(product.free_available, level?.available);
  assert.ok(product.recent_movements.length >= 1);

  const several = await runTool(ctx, "stock_lookup", { q: "robot vacuum" });
  assert.equal(several.data.match, "several");
  const none = await runTool(ctx, "stock_lookup", { q: "nonexistent gadget" });
  assert.equal(none.data.match, "none");
  await assert.rejects(runTool(ctx, "stock_lookup", {}), ToolError);
});

test("supply tools: low stock, POs past ETA, empty procurement", async () => {
  const ctx = await context();
  const low = await runTool(ctx, "low_stock", {});
  for (const row of low.data.skus as Array<{ free_available: number }>) assert.ok(row.free_available <= 1);
  const pos = await runTool(ctx, "open_purchase_orders", {});
  assert.equal(pos.data.total, 2);
  assert.equal(pos.data.past_eta, 1);
  const oneSku = await runTool(ctx, "open_purchase_orders", { sku: "ep-dy-v8" });
  assert.equal(oneSku.data.total, 1);
  const proc = await runTool(ctx, "open_procurement", {});
  assert.equal(proc.data.total, 0);
});

test("dispatch_queue totals COD to collect today", async () => {
  const ctx = await context();
  const out = await runTool(ctx, "dispatch_queue", {});
  const totals = out.data.totals as { ready_to_dispatch: number; out_for_delivery: number; cod_to_collect_today_inr: number };
  assert.equal(totals.ready_to_dispatch, 2);
  assert.equal(totals.out_for_delivery, 1);
  const ofd = await ctx.store.listOrders({ stage: "out_for_delivery" });
  assert.equal(totals.cod_to_collect_today_inr, Math.round(ofd.items[0].codDueMinor / 100));
  assert.doesNotMatch(JSON.stringify(out.data), PHONE);
});

test("stuck_orders finds checks older than 24h and overdue installations", async () => {
  const ctx = await context();
  const delivered = (await ctx.store.listOrders({ stage: "delivered", limit: 1 })).items[0];
  await ctx.store.insertInstallation({ orderId: delivered.id, lineId: delivered.lines[0].id, sku: delivered.lines[0].sku, productName: delivered.lines[0].productName, customerName: delivered.customerName, phone: delivered.phone, address: null, status: "pending", dueDate: "2026-10-28", doneAt: null, technician: null, note: null });
  const out = await runTool(ctx, "stuck_orders", {});
  assert.equal((out.data.payment_check_over_24h as { count: number }).count, 1);
  assert.equal((out.data.inventory_decision_over_24h as { count: number }).count, 1);
  assert.equal((out.data.installations_past_due as { count: number }).count, 1);
  const installs = await runTool(ctx, "installations_due", {});
  assert.equal(installs.data.overdue_count, 1);
  assert.equal((installs.data.overdue as Array<{ days_overdue: number }>)[0].days_overdue, 2);
});

test("recent_activity and legacy Slack search", async () => {
  const ctx = await context(true);
  const events = await runTool(ctx, "recent_activity", { limit: 5 });
  assert.equal((events.data.events as unknown[]).length, 5);
  const slack = await runTool(ctx, "search_slack_messages", { q: "" , limit: 3 });
  assert.ok((slack.data.messages as unknown[]).length <= 3);
  const noRepo = await context(false);
  await assert.rejects(runTool(noRepo, "search_slack_messages", { q: "x" }), ToolError);
  await assert.rejects(runTool(noRepo, "drop_tables", {}), ToolError);
});

test("the no-model fallback routes the suggested questions to the right tools and answers", async () => {
  const ctx = await context();
  const expectations: Array<[string, string]> = [
    ["What's stuck right now?", "stuck_orders"],
    ["Orders waiting for stock and when they arrive", "search_orders"],
    ["Today's sales by hub", "sales_summary"],
    ["How many DREAME L50s Pro Ultra are free?", "stock_lookup"],
    ["COD to collect today", "dispatch_queue"],
    ["Which POC sold most in the last 5 days?", "sales_summary"],
    ["Tell me about EPK-000004", "get_order"],
  ];
  for (const [question, tool] of expectations) {
    assert.equal(planFor(question, NOW)[0].tool, tool, question);
    const answer = await rulesAnswer(question, ctx);
    assert.ok(answer.answer.length > 20, question);
    assert.ok(answer.steps.every((s) => s.ok), question);
  }
  assert.deepEqual(planFor("Today's sales by hub", NOW)[0].input, { from: "2026-10-30", to: "2026-10-30", group_by: "hub" });
  assert.deepEqual(planFor("How many DREAME L50s Pro Ultra are free?", NOW)[0].input, { q: "DREAME L50s Pro Ultra" });
  const briefing = await rulesBriefing(ctx);
  assert.match(briefing.answer, /\*\*Headline\*\*/);
  assert.match(briefing.answer, /Needs attention/);
});

test("markdown reader handles tables, lists, bold and order links", () => {
  const blocks = parseMarkdown("**3 orders** stuck.\n\n- EPK-000012 waiting\n- #PIK3901 late\n\n| Hub | Orders |\n| --- | --- |\n| HQ | 2 |\n\n1. one\n2. two");
  assert.deepEqual(blocks.map((b) => b.type), ["paragraph", "list", "table", "list"]);
  const para = blocks[0];
  assert.equal(para.type === "paragraph" && para.content[0].type, "bold");
  const list = blocks[1];
  assert.ok(list.type === "list" && !list.ordered && list.items[0][0].type === "order");
  const table = blocks[2];
  assert.ok(table.type === "table" && table.rows.length === 1 && table.header.length === 2);
  const ordered = blocks[3];
  assert.ok(ordered.type === "list" && ordered.ordered && ordered.items.length === 2);
});

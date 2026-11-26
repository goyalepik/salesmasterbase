import "server-only";

import { readEnv } from "@/lib/env";
import { daysBetween, findProducts, findUnits, INCOMING_LABELS, productsInView, type Product, type Snapshot, type StockView } from "./domain/model";

// The IMS assistant: OpenAI with tools over the same stock picture the pages show (read only). Inventory money only,
// at cost: it never states sale prices, GMV or margin.

export type ChatTurn = { role: "user" | "assistant"; content: string };

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const TOOLS = [
  { name: "overview", description: "Headline numbers: stock units and value, by category and age, received and dispatched in the last 7/30 days, coming in, what needs attention.", parameters: obj({}) },
  { name: "finance", description: "Inventory money: stock value (bought vs SOR), by category and hub, aged and dead stock value, days of stock, turns, month by month received vs dispatched at cost, top vendors, billing entities, top products by cash and slow movers.", parameters: obj({}) },
  { name: "find_products", description: "Find products by words in the name, SKU, brand or category, with stock, value, coming, sold last 30 days, cover days and age.", parameters: obj({ query: { type: "string" }, limit: { type: "number" } }, ["query"]) },
  { name: "product_list", description: "Lists: in, coming, low (under a week of stock), out (out of stock but selling), old (90+ days), dead (not moving).", parameters: obj({ view: { type: "string", enum: ["in", "coming", "low", "out", "old", "dead"] }, category: { type: "string" }, limit: { type: "number" } }, ["view"]) },
  { name: "product_detail", description: "One SKU in full: serials in stock with hub, age, vendor, cost; open PO lines; recent dispatches.", parameters: obj({ sku: { type: "string" } }, ["sku"]) },
  { name: "find_serial", description: "Where a unit is, by its serial (or part of it).", parameters: obj({ serial: { type: "string" } }, ["serial"]) },
  { name: "stock_in", description: "Units received (Inward Sheet and IMS bills) in the last N days, by vendor and product, optionally filtered by words.", parameters: obj({ days: { type: "number" }, query: { type: "string" } }, ["days"]) },
  { name: "incoming", description: "Open PO lines: overdue (late), this_week, later, no_date, stale (old, probably received or dropped); optional words filter.", parameters: obj({ state: { type: "string", enum: ["any", "overdue", "this_week", "later", "no_date", "stale"] }, query: { type: "string" }, limit: { type: "number" } }, ["state"]) },
  { name: "dispatches", description: "Items sent to customers in the last N days with delivery status, by POC or product words.", parameters: obj({ days: { type: "number" }, query: { type: "string" } }, ["days"]) },
] as const;

const rs = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function product(p: Product) {
  return { sku: p.sku, name: p.name, brand: p.brand, category: p.category, in_stock: p.inStock, value_at_cost: rs(p.value), tracker_count: p.trackerUnits, coming: p.incoming, next_eta: p.nextEta, sold_last_30_days: p.out30, cover_days: p.cover, avg_age_days: p.avgAge, hubs: p.hubs };
}

function runTool(s: Snapshot, name: string, args: Record<string, unknown>): unknown {
  const limit = Math.min(Number(args.limit) || 15, 40);
  const q = String(args.query ?? "").toLowerCase();
  const since = (days: number) => new Date(Date.parse(`${s.today}T00:00:00Z`) - (Math.min(Math.max(days, 1), 180) - 1) * 86_400_000).toISOString().slice(0, 10);
  switch (name) {
    case "overview":
      return {
        today: s.today, units_in_stock: s.kpis.unitsInStock, stock_value_at_cost: rs(s.kpis.stockValue), products_in_stock: s.kpis.skusInStock,
        received_7d: s.kpis.in7, received_30d: s.kpis.in30, dispatched_7d: s.kpis.out7, dispatched_30d: s.kpis.out30,
        coming_units: s.kpis.incomingUnits, late_po_lines: s.kpis.lateLines, health_score_pct: s.healthScore,
        by_category: s.categories.map((c) => ({ category: c.category, units: c.units, value: rs(c.value), sold_30d: c.out30, cover_days: c.cover })),
        ageing: s.ageing.map((a) => ({ band: a.label, units: a.units, value: rs(a.value) })),
        attention: s.attention.map((a) => `${a.title}: ${a.detail}`),
      };
    case "finance": {
      const f = s.finance;
      return {
        stock_value: rs(f.stockValue), bought_cash_and_carry: rs(f.cncValue), sor_vendor_owned: rs(f.sorValue), days_of_stock: f.daysOfStock, turns_per_year: f.turns,
        aged_90_plus_value: rs(f.agedValue), dead_stock_value: rs(f.deadValue), dead_products: f.deadSkus, cost_of_goods_dispatched_30d: rs(f.costOfDispatch30),
        by_category: f.byCategory.map((c) => ({ category: c.category, value: rs(c.value), share_pct: Math.round(c.share * 100) })),
        by_hub: f.byHub.map((h) => ({ hub: h.hub, value: rs(h.value), units: h.units })),
        months: f.months.map((m) => ({ month: m.label, received_at_cost: rs(m.receivedCost), dispatched_at_cost: rs(m.dispatchedCost), net_change: rs(m.net), sell_through_pct: m.sellThrough })),
        top_vendors_90d: f.vendors.map((v) => ({ vendor: v.vendor, value: rs(v.value), units: v.units })),
        billed_to_90d: f.billedTo.map((b) => ({ entity: b.entity, value: rs(b.value) })),
        top_cash_products: f.topCash.map((p) => ({ name: p.name, units: p.inStock, value: rs(p.value) })),
        slow_movers: f.slowMovers.map((p) => ({ name: p.name, units: p.inStock, value: rs(p.value), avg_age: p.avgAge })),
      };
    }
    case "find_products":
      return findProducts(s, q, limit).map(product);
    case "product_list":
      return productsInView(s, String(args.view) as StockView, args.category ? String(args.category) : null).slice(0, limit).map(product);
    case "product_detail": {
      const sku = String(args.sku ?? "").toLowerCase();
      const p = s.products.find((x) => x.sku.toLowerCase() === sku) ?? findProducts(s, sku, 1)[0];
      if (!p) return { error: "No such SKU" };
      const units = s.units.filter((u) => u.sku.toLowerCase() === p.sku.toLowerCase());
      return {
        ...product(p),
        units_in_stock: units.filter((u) => u.inStock).slice(0, 40).map((u) => ({ serial: u.serial, hub: u.hub, inward_on: u.inwardOn, vendor: u.vendor, cost: rs(u.cost), age_days: u.inwardOn ? daysBetween(u.inwardOn, s.today) : null })),
        open_po_lines: s.incoming.filter((l) => l.sku?.toLowerCase() === p.sku.toLowerCase()).map((l) => ({ po: l.po, vendor: l.vendor, pending: l.pending, eta: l.eta, state: INCOMING_LABELS[l.state] })),
        recent_dispatches: units.filter((u) => !u.inStock && u.dispatchedOn).sort((a, b) => (b.dispatchedOn ?? "").localeCompare(a.dispatchedOn ?? "")).slice(0, 10).map((u) => ({ serial: u.serial, on: u.dispatchedOn, poc: u.poc })),
      };
    }
    case "find_serial":
      return findUnits(s, String(args.serial ?? "")).map((u) => ({ serial: u.serial, sku: u.sku, name: u.name, status: u.inStock ? "In stock" : u.returnedToVendor ? "Returned to vendor" : u.dispatchedOn ? "Dispatched" : "Not in stock", hub: u.hub, inward_on: u.inwardOn, vendor: u.vendor, invoice: u.invoice, po: u.po, dispatched_on: u.dispatchedOn, poc: u.poc, cost: rs(u.cost) }));
    case "stock_in": {
      const from = since(Number(args.days) || 7);
      const list = s.inwards.filter((w) => w.on && w.on >= from && (!q || `${w.vendor} ${w.name} ${w.sku} ${w.brand}`.toLowerCase().includes(q)));
      const by = (f: (w: (typeof list)[number]) => string) => Object.entries(list.reduce<Record<string, { units: number; value: number }>>((m, w) => { const k = f(w); m[k] ??= { units: 0, value: 0 }; m[k].units += w.qty; m[k].value += w.qty * w.cost; return m; }, {})).sort((a, b) => b[1].value - a[1].value).slice(0, 12).map(([k, v]) => ({ name: k, units: v.units, value: rs(v.value) }));
      return { from, to: s.today, units: list.reduce((n, w) => n + w.qty, 0), value: rs(list.reduce((n, w) => n + w.qty * w.cost, 0)), by_vendor: by((w) => w.vendor ?? "?"), by_product: by((w) => w.name), damaged: list.filter((w) => /bad|damag|average/i.test(w.condition ?? "")).length };
    }
    case "incoming": {
      const state = String(args.state ?? "any");
      return s.incoming.filter((l) => (state === "any" ? l.state !== "stale" : l.state === state)).filter((l) => !q || `${l.vendor} ${l.brand} ${l.name} ${l.sku}`.toLowerCase().includes(q)).slice(0, limit)
        .map((l) => ({ po: l.po, raised_on: l.raisedOn, vendor: l.vendor, product: l.name, pending: l.pending, of: l.qty, eta: l.eta, state: INCOMING_LABELS[l.state], update: l.appStatus, delay: l.delayReason, value: rs(l.value) }));
    }
    case "dispatches": {
      const from = since(Number(args.days) || 7);
      const list = s.dispatches.filter((d) => d.on && d.on >= from && (!q || `${d.poc} ${d.name} ${d.sku} ${d.hub}`.toLowerCase().includes(q)));
      return { from, count: list.length, items: list.slice(0, limit).map((d) => ({ order: d.order, on: d.on, product: d.name, serial: d.serial, poc: d.poc, hub: d.hub, status: d.appStatus ?? d.status })) };
    }
    default:
      return { error: "Unknown tool" };
  }
}

const SYSTEM = (s: Snapshot) => `You are EPIK's inventory assistant. EPIK is a consumer-durables retailer in Bengaluru (robot vacuums, phones, appliances).
Today is ${s.today} (IST). Data comes live from the team sheets: the Inventory Masterbase (one row per serial, the truth for stock), the Inward Sheet (stock in), the Dispatch Tracker (stock out), the Procurement list (POs) and the Inventory Tracker (daily count, cost per SKU), plus bills entered in this app.
Money is inventory money at cost incl. GST. Never state sale prices, GMV or margins: if asked, say the inventory sheets can't give them reliably.
Always use the tools for numbers; never guess. Answer short and plain: a one-line answer first, then a small list or table only if it helps (at most 4 columns). Shorten product names to their first few words. Write money as ₹2.6 Cr or ₹4.5 L, dates as "2 Oct". No follow-up questions unless something is unclear.`;

export async function askIms(s: Snapshot, history: ChatTurn[]): Promise<string> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return "The assistant needs an OpenAI key on the server (OPENAI_API_KEY).";
  type Msg = { role: string; content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>; tool_call_id?: string };
  const messages: Msg[] = [{ role: "system", content: SYSTEM(s) }, ...history.slice(-12).map((t) => ({ role: t.role, content: t.content.slice(0, 2000) }))];
  for (let round = 0; round < 5; round++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: readEnv().openaiModel, messages, tools: TOOLS.map((t) => ({ type: "function", function: t })), max_completion_tokens: 900 }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return `The assistant couldn't answer right now (OpenAI ${res.status}). Try again in a minute.`;
    const msg = ((await res.json()) as { choices?: Array<{ message?: Msg }> }).choices?.[0]?.message;
    if (!msg) return "No answer. Try asking another way.";
    if (!msg.tool_calls?.length) return msg.content?.trim() || "No answer.";
    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });
    for (const call of msg.tool_calls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.function.arguments || "{}"); } catch { args = {}; }
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(runTool(s, call.function.name, args)).slice(0, 14_000) });
    }
  }
  return "That needed too many steps. Try a narrower question.";
}

/** One short insight for the Overview card, from the numbers (cached by the page for the day). */
export async function dailyInsight(s: Snapshot): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;
  const facts = runTool(s, "overview", {});
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: readEnv().openaiModel, max_completion_tokens: 120, messages: [
      { role: "system", content: "Write ONE sentence (max 24 words) for a retail founder: the single most useful thing in today's inventory numbers, with one number. Plain words, no hype, no sale prices or margins." },
      { role: "user", content: JSON.stringify(facts) },
    ] }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const text = ((await res.json()) as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content?.trim();
  return text || null;
}

const insightCache = globalThis as { __imsInsight?: { day: string; text: string } };

/** Today's insight, written once a day per server. */
export async function cachedInsight(s: Snapshot): Promise<string | null> {
  if (insightCache.__imsInsight?.day === s.today) return insightCache.__imsInsight.text;
  const text = await dailyInsight(s).catch(() => null);
  if (text) insightCache.__imsInsight = { day: s.today, text };
  return text;
}

import "server-only";

import { readEnv } from "@/lib/env";
import { findProducts, findUnits, INCOMING_LABELS, productsInView, type Snapshot, type StockView } from "./domain/model";
import type { ImsRole } from "./role";

// The IMS chat: OpenAI with tools over the same stock picture the pages show (read only). Viewers never get costs or
// values back from the tools, so the model can't tell them either.

export type ChatTurn = { role: "user" | "assistant"; content: string };

const TOOLS = [
  { name: "overview", description: "Headline numbers: units and value in stock, coming in, moved in the last 7/30 days, ageing, top brands, what needs attention.", parameters: { type: "object", properties: {}, additionalProperties: false } },
  {
    name: "find_products",
    description: "Find products (SKUs) by words in the name, SKU code or brand, with stock, coming, last-30-days sales, cover days and age.",
    parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"], additionalProperties: false },
  },
  {
    name: "product_list",
    description: "Lists of products: in = in stock by value, coming = with units on order, low = under a week of stock, out = out of stock but selling, old = stock older than 90 days, gap = differs from the Inventory Tracker count.",
    parameters: { type: "object", properties: { view: { type: "string", enum: ["in", "coming", "low", "out", "old", "gap"] }, limit: { type: "number" } }, required: ["view"], additionalProperties: false },
  },
  {
    name: "product_detail",
    description: "One SKU in full: units in stock with serial, hub, age and vendor; open PO lines; recent dispatches.",
    parameters: { type: "object", properties: { sku: { type: "string" } }, required: ["sku"], additionalProperties: false },
  },
  { name: "find_serial", description: "Where a unit is, by its serial number (or part of it).", parameters: { type: "object", properties: { serial: { type: "string" } }, required: ["serial"], additionalProperties: false } },
  {
    name: "incoming",
    description: "Open PO lines (what is coming): by state (overdue = late, this_week, later, no_date, stale = old and probably already received or dropped), optionally filtered by words in vendor, brand or product.",
    parameters: { type: "object", properties: { state: { type: "string", enum: ["any", "overdue", "this_week", "later", "no_date", "stale"] }, query: { type: "string" }, limit: { type: "number" } }, required: ["state"], additionalProperties: false },
  },
  {
    name: "movement",
    description: "Units received (inward) and dispatched in the last N days, by brand or product words.",
    parameters: { type: "object", properties: { days: { type: "number" }, query: { type: "string" } }, required: ["days"], additionalProperties: false },
  },
] as const;

const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function runTool(s: Snapshot, role: ImsRole, name: string, args: Record<string, unknown>): unknown {
  const money = role === "admin";
  const product = (p: Snapshot["products"][number]) => ({
    sku: p.sku, name: p.name, brand: p.brand, in_stock: p.inStock, ...(money ? { stock_value: rupees(p.value) } : {}),
    tracker_count: p.trackerUnits, coming: p.incoming, next_eta: p.nextEta, sold_last_30_days: p.out30, cover_days: p.cover, avg_age_days: p.avgAge, oldest_age_days: p.oldestAge, hubs: p.hubs,
  });
  const limit = Math.min(Number(args.limit) || 15, 40);
  switch (name) {
    case "overview":
      return {
        today: s.today,
        ...s.kpis,
        stockValue: money ? rupees(s.kpis.stockValue) : "hidden for viewers",
        incomingValue: money ? rupees(s.kpis.incomingValue) : "hidden for viewers",
        ageing: s.ageing.map((a) => ({ band: a.label, units: a.units, ...(money ? { value: rupees(a.value) } : {}) })),
        top_brands: s.brands.slice(0, 8).map((b) => ({ brand: b.brand, units: b.units, ...(money ? { value: rupees(b.value) } : {}) })),
        attention: s.attention.map((a) => `${a.title}: ${a.detail}`),
        tracker_as_of: s.tracker.asOf,
      };
    case "find_products":
      return findProducts(s, String(args.query ?? ""), limit).map(product);
    case "product_list":
      return productsInView(s, String(args.view) as StockView).slice(0, limit).map(product);
    case "product_detail": {
      const sku = String(args.sku ?? "").toLowerCase();
      const p = s.products.find((x) => x.sku.toLowerCase() === sku) ?? findProducts(s, sku, 1)[0];
      if (!p) return { error: "No such SKU" };
      const units = s.units.filter((u) => u.sku.toLowerCase() === p.sku.toLowerCase());
      return {
        ...product(p),
        units_in_stock: units.filter((u) => u.inStock).slice(0, 40).map((u) => ({ serial: u.serial, hub: u.hub, inward_on: u.inwardOn, vendor: u.vendor, condition: u.condition, ...(money ? { cost: rupees(u.cost) } : {}) })),
        open_po_lines: s.incoming.filter((l) => l.sku?.toLowerCase() === p.sku.toLowerCase()).map((l) => ({ po: l.po, vendor: l.vendor, pending: l.pending, eta: l.eta, state: INCOMING_LABELS[l.state], delay: l.delayReason })),
        recent_dispatches: units.filter((u) => !u.inStock && u.dispatchedOn).sort((a, b) => (b.dispatchedOn ?? "").localeCompare(a.dispatchedOn ?? "")).slice(0, 10).map((u) => ({ serial: u.serial, on: u.dispatchedOn, poc: u.poc })),
      };
    }
    case "find_serial":
      return findUnits(s, String(args.serial ?? "")).map((u) => ({
        serial: u.serial, sku: u.sku, name: u.name, status: u.inStock ? "In stock" : u.returnedToVendor ? "Returned to vendor" : u.dispatchedOn ? "Dispatched" : "Not in stock",
        hub: u.hub, inward_on: u.inwardOn, vendor: u.vendor, invoice: u.invoice, po: u.po, dispatched_on: u.dispatchedOn, poc: u.poc, ...(money ? { cost: rupees(u.cost), customer: u.customer } : {}),
      }));
    case "incoming": {
      const q = String(args.query ?? "").toLowerCase();
      const state = String(args.state ?? "any");
      return s.incoming
        .filter((l) => (state === "any" ? l.state !== "stale" : l.state === state))
        .filter((l) => !q || `${l.vendor} ${l.brand} ${l.name} ${l.sku}`.toLowerCase().includes(q))
        .slice(0, limit)
        .map((l) => ({ po: l.po, raised_on: l.raisedOn, vendor: l.vendor, product: l.name, sku: l.sku, ordered: l.qty, received: l.received, pending: l.pending, eta: l.eta, state: INCOMING_LABELS[l.state], delay: l.delayReason, owner: l.owner, ...(money ? { value: rupees(l.value) } : {}) }));
    }
    case "movement": {
      const days = Math.min(Math.max(Number(args.days) || 7, 1), 120);
      const q = String(args.query ?? "").toLowerCase();
      const from = new Date(Date.parse(`${s.today}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
      const match = (u: Snapshot["units"][number]) => !q || `${u.brand} ${u.name} ${u.sku}`.toLowerCase().includes(q);
      const inward = s.units.filter((u) => u.inwardOn && u.inwardOn >= from && match(u));
      const out = s.units.filter((u) => !u.inStock && u.dispatchedOn && u.dispatchedOn >= from && match(u));
      const top = (list: typeof inward) => Object.entries(list.reduce<Record<string, number>>((m, u) => ((m[u.name] = (m[u.name] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).slice(0, 10);
      return { from, to: s.today, received_units: inward.length, dispatched_units: out.length, top_received: top(inward), top_dispatched: top(out) };
    }
    default:
      return { error: "Unknown tool" };
  }
}

const SYSTEM = (s: Snapshot, role: ImsRole) => `You are EPIK's inventory assistant. EPIK is a consumer-durables retailer in Bengaluru (robot vacuums, phones, appliances).
Today is ${s.today} (IST). Data comes live from three team sheets: the Inventory Masterbase (one row per serial; the truth for stock), the Procurement list (PO lines; what is coming) and the Inventory Tracker's Current Stock (the team's daily count, a cross-check, as of ${s.tracker.asOf ?? "unknown"}).
Always use the tools for numbers; never guess. Answer short and plain: a one-line answer first, then a small list or table only if it helps (at most 4 columns). Shorten product names to their first few words (e.g. "Dreame L50 Ultra"). Write dates like "2 Oct", never "2026-10-02". No follow-up questions unless something is unclear.
"Coming" excludes old PO lines that are probably already received or dropped (state stale); mention them only if asked.
${role === "admin" ? "The user is an admin: you may show costs and values in ₹." : "The user is a viewer: never show costs, values or customer names; say they need Admin for money."}`;

export async function askIms(s: Snapshot, role: ImsRole, history: ChatTurn[]): Promise<string> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return "The chat needs an OpenAI key on the server (OPENAI_API_KEY).";
  const model = readEnv().openaiModel;
  type Msg = { role: string; content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>; tool_call_id?: string };
  const messages: Msg[] = [{ role: "system", content: SYSTEM(s, role) }, ...history.slice(-12).map((t) => ({ role: t.role, content: t.content.slice(0, 2000) }))];
  for (let round = 0; round < 5; round++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model, messages, tools: TOOLS.map((t) => ({ type: "function", function: t })), max_completion_tokens: 900 }),
      signal: AbortSignal.timeout(40_000),
    });
    if (!res.ok) return `The assistant couldn't answer right now (OpenAI ${res.status}). Try again in a minute.`;
    const body = (await res.json()) as { choices?: Array<{ message?: Msg }> };
    const msg = body.choices?.[0]?.message;
    if (!msg) return "The assistant gave no answer. Try asking another way.";
    if (!msg.tool_calls?.length) return msg.content?.trim() || "No answer.";
    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });
    for (const call of msg.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = {};
      }
      const result = runTool(s, role, call.function.name, args);
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 12_000) });
    }
  }
  return "That needed too many steps. Try a narrower question.";
}

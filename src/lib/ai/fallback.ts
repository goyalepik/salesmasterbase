import { HUBS } from "@/lib/ops/types";
import { runTool, ToolError, type ToolContext, type ToolOutput } from "@/lib/ai/tools";
import { inr, shiftIstDate, todayIst } from "@/lib/ai/util";

/**
 * Answers without a language model: route the question to fixed tools by keyword and render
 * the results as markdown. Used when no AI key is set or every provider failed.
 */

export type RulesStep = { tool: string; input: Record<string, unknown>; summary: string; ok: boolean };
export type RulesAnswer = { answer: string; steps: RulesStep[] };

type Plan = Array<{ tool: string; input: Record<string, unknown> }>;
type Data = Record<string, unknown>;
type Row = Record<string, unknown>;

const STOP = new Set(
  "how many much are is free in stock available availability units unit of the do we have left there a an for pieces pcs any what whats what's check right now currently today got still".split(" "),
);

function productWords(question: string): string {
  return question
    .replace(/[?.,!]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w.toLowerCase()))
    .join(" ")
    .trim();
}

function hubIn(question: string): string | undefined {
  const text = question.toLowerCase();
  return [...HUBS].sort((a, b) => b.length - a.length).find((h) => text.includes(h.toLowerCase()));
}

export function planFor(question: string, now: Date): Plan {
  const text = question.toLowerCase();
  const today = todayIst(now);
  const ref = /\b(EPK-?\d+|#?PIK\d{3,})\b/i.exec(question);
  if (ref) return [{ tool: "get_order", input: { id: ref[1] } }];
  if (/stuck|overdue|attention|blocked|delayed|\blate\b/.test(text)) return [{ tool: "stuck_orders", input: {} }];
  if (/waiting for stock|awaiting stock|purchase order|\bpos?\b|arriv|\beta\b|incoming/.test(text)) {
    return [{ tool: "search_orders", input: { stage: "awaiting_stock", limit: 30 } }, { tool: "open_purchase_orders", input: {} }];
  }
  if (/procure/.test(text)) return [{ tool: "open_procurement", input: {} }];
  if (/\bcod\b|collect|dispatch|deliver/.test(text)) return [{ tool: "dispatch_queue", input: hubIn(question) ? { hub: hubIn(question) } : {} }];
  if (/install/.test(text)) return [{ tool: "installations_due", input: {} }];
  if (/low stock|reorder|short|out of stock|running out/.test(text)) return [{ tool: "low_stock", input: {} }];
  if (/\bstock\b|\bfree\b|available|how many .*(are|is|do we)|\bunits?\b/.test(text)) {
    const q = productWords(question);
    return q.length >= 2 ? [{ tool: "stock_lookup", input: { q } }] : [{ tool: "low_stock", input: {} }];
  }
  if (/sold|sales|\bsell|\bpoc\b|salesperson|incentive|revenue|offered|\bhub|orders? (today|yesterday)/.test(text)) {
    const group_by = /\bpoc\b|who|salesperson|incentive/.test(text) ? "poc" : /\bhub/.test(text) ? "hub" : /product|model|sku|item/.test(text) ? "product" : "day";
    let from = shiftIstDate(today, -4);
    let to = today;
    if (/yesterday/.test(text)) from = to = shiftIstDate(today, -1);
    else if (/today/.test(text)) from = today;
    else if (/week|7 days/.test(text)) from = shiftIstDate(today, -6);
    else if (/month|30 days/.test(text)) from = shiftIstDate(today, -29);
    return [{ tool: "sales_summary", input: { from, to, group_by } }];
  }
  if (/slack|message/.test(text)) return [{ tool: "search_slack_messages", input: { q: productWords(question.replace(/slack|messages?/gi, "")) } }];
  if (/activity|recent|latest|happen/.test(text)) return [{ tool: "recent_activity", input: { limit: 15 } }];
  return [{ tool: "pipeline_summary", input: {} }, { tool: "stuck_orders", input: {} }];
}

// ── Markdown helpers ─────────────────────────────────────────────────────────

function cell(value: unknown): string {
  if (value == null || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ") || "—";
  return String(value).replace(/\|/g, "/").replace(/\n/g, " ");
}

function table(headers: string[], keys: string[], rows: Row[], money: string[] = []): string {
  if (!rows.length) return "";
  const head = `| ${headers.join(" | ")} |\n| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${keys.map((k) => (money.includes(k) && typeof r[k] === "number" ? inr((r[k] as number) * 100) : cell(r[k]))).join(" | ")} |`).join("\n");
  return `${head}\n${body}`;
}

const rs = (n: unknown) => (typeof n === "number" ? inr(n * 100) : "—");
const num = (n: unknown) => (typeof n === "number" ? n : 0);
const rows = (v: unknown) => (Array.isArray(v) ? (v as Row[]) : []);
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Data) : {});

function render(tool: string, data: Data): string {
  switch (tool) {
    case "pipeline_summary": {
      const today = obj(data.today);
      const overdue = obj(data.overdue);
      const pipeline = rows(data.pipeline).filter((r) => num(r.orders) > 0);
      return [
        `**${num(data.open_orders)} open orders** worth ${rs(data.open_pipeline_offered_inr)} offered. Today: ${num(today.orders_created)} new orders (${rs(today.offered_inr)} offered), ${rs(today.verified_received_inr)} verified received, ${num(today.delivered)} delivered.`,
        table(["Stage", "Orders"], ["stage", "orders"], pipeline),
        `- Payment checks over 24h: ${num(overdue.payment_check_over_24h)}\n- Inventory decisions over 24h: ${num(overdue.inventory_check_over_24h)}\n- Procurement past ETA: ${num(overdue.procurement_past_eta)}\n- Installations past due: ${num(overdue.installations_past_due)}\n- COD still to collect: ${rs(data.cod_outstanding_inr)}`,
      ].filter(Boolean).join("\n\n");
    }
    case "stuck_orders": {
      const labels: Array<[string, string]> = [
        ["payment_check_over_24h", "Payment check over 24h (RevOps)"],
        ["inventory_decision_over_24h", "Inventory decision over 24h (Inventory)"],
        ["waiting_for_stock_past_eta", "Waiting for stock past ETA (Procurement)"],
        ["waiting_for_stock_without_eta", "Waiting for stock with no ETA (Procurement)"],
        ["out_for_delivery_past_expected_date", "Out for delivery past expected date (Logistics)"],
        ["out_for_delivery_over_48h_no_date", "Out for delivery over 48h, no date (Logistics)"],
        ["on_hold", "On hold (Sales)"],
      ];
      const parts = [`**${num(data.total_items)} items are stuck or late.**`];
      for (const [key, label] of labels) {
        const g = obj(data[key]);
        if (!num(g.count)) continue;
        const list = rows(g.orders).slice(0, 8).map((o) => `${o.id}${o.customer ? ` (${o.customer}, ${o.age_days}d)` : ""}`).join(", ");
        parts.push(`- **${label}:** ${num(g.count)}, ${rs(g.offered_inr)} offered — ${list}${num(g.count) > 8 ? ", …" : ""}`);
      }
      const proc = obj(data.procurement_past_eta);
      if (num(proc.count)) parts.push(`- **Procurement past ETA:** ${num(proc.count)} — ${rows(proc.requests).slice(0, 8).map((r) => `${r.order_id} (${r.vendor}, ${r.days_late}d late)`).join(", ")}`);
      const inst = obj(data.installations_past_due);
      if (num(inst.count)) parts.push(`- **Installations past due:** ${num(inst.count)} — ${rows(inst.items).slice(0, 8).map((r) => `${r.order_id} (${r.days_overdue}d)`).join(", ")}`);
      if (parts.length === 1) return "**Nothing is stuck right now.** No payment or inventory check is older than 24h, and nothing is past its ETA or due date.";
      return parts.join("\n");
    }
    case "search_orders": {
      const list = rows(data.orders);
      if (!list.length) return "**No orders match these filters.**";
      const flat = list.map((o) => ({ ...o, products: rows(o.items).map((i) => `${i.product} — ${i.status}${i.eta ? `, ETA ${i.eta}` : ""}`).join("; ") }));
      return [`**${num(data.total)} orders match**${num(data.total) > list.length ? ` (showing ${list.length})` : ""}.`, table(["Order", "Stage", "Customer", "Hub", "POC", "Offered", "Products"], ["id", "stage", "customer", "hub", "poc", "offered_inr", "products"], flat, ["offered_inr"])].join("\n\n");
    }
    case "get_order": {
      if (!data.found) return `**No order ${cell(data.id)} was found.** Check the ID, or search older Slack posts.`;
      const o = obj(data.order);
      return [
        `**${cell(o.id)}${o.shopify ? ` / ${cell(o.shopify)}` : ""} is at “${cell(o.stage)}”.** Next: ${cell(data.next_step)}`,
        `- Customer: ${cell(o.customer)} · Hub: ${cell(o.hub)} · POC: ${cell(o.poc)}\n- Offered ${rs(o.offered_inr)}${o.price_is_list_estimate ? " (list-price estimate)" : ""} · Paid ${rs(o.paid_inr)} · COD due ${rs(o.cod_due_inr ?? 0)}`,
        table(["Product", "Status", "ETA"], ["product", "status", "eta"], rows(o.items)),
      ].join("\n\n");
    }
    case "sales_summary": {
      const totals = obj(data.totals);
      const group = String(data.group_by);
      const gaps = [totals.orders_with_list_price_estimate ? `${totals.orders_with_list_price_estimate} orders use a list-price estimate.` : "", totals.cancelled_orders_excluded ? `${totals.cancelled_orders_excluded} cancelled orders excluded.` : ""].filter(Boolean).join(" ");
      const top = group !== "day" ? rows(data.rows)[0] : undefined;
      const lead = top ? `**${cell(top[group])} leads** with ${num(top.orders)} orders, ${rs(top.offered_inr)} offered. ` : "";
      return [
        `${lead}**${num(totals.orders)} orders, ${rs(totals.offered_inr)} offered** from ${cell(data.from)} to ${cell(data.to)} (IST). Paid so far on these orders: ${rs(totals.paid_so_far_inr)}.`,
        table([group.toUpperCase() === "POC" ? "POC" : group[0].toUpperCase() + group.slice(1), "Orders", "Units", "Offered", "Paid so far"], [group, "orders", "units", "offered_inr", "paid_so_far_inr"], rows(data.rows).slice(0, 15), ["offered_inr", "paid_so_far_inr"]),
        gaps ? `Gaps: ${gaps} Offered is the deal price, not money collected.` : "Offered is the deal price, not money collected.",
      ].join("\n\n");
    }
    case "stock_lookup": {
      if (data.match === "none") return `**No product matches “${cell(data.q)}”.**`;
      if (data.match === "several") return [`**${num(data.total_free_available)} free across ${rows(data.products).length} matching products.**`, table(["SKU", "Product", "Free", "Reserved", "Incoming", "Next ETA"], ["sku", "name", "free_available", "reserved", "incoming", "next_eta"], rows(data.products))].join("\n\n");
      const p = obj(data.product);
      return [
        `**${num(p.free_available)} free** of ${cell(p.name)} (${cell(p.sku)}): ${num(p.on_hand)} on hand, ${num(p.reserved)} reserved, ${num(p.incoming_on_open_pos)} incoming${p.next_eta ? ` (next ETA ${p.next_eta})` : ""}.`,
        rows(p.orders_waiting_for_it).length ? `- Orders waiting: ${rows(p.orders_waiting_for_it).map((w) => `${w.id} (${w.status})`).join(", ")}` : "",
        Array.isArray(p.reserved_for_orders) && p.reserved_for_orders.length ? `- Reserved for: ${p.reserved_for_orders.join(", ")}` : "",
      ].filter(Boolean).join("\n\n");
    }
    case "low_stock":
      return [`**${num(data.short_of_open_demand)} SKUs are short of open orders**; ${num(data.total)} are at or near zero free.`, table(["SKU", "Product", "Free", "Incoming", "Open demand", "Shortfall"], ["sku", "name", "free_available", "incoming", "open_demand_units", "shortfall"], rows(data.skus).slice(0, 15))].join("\n\n");
    case "open_purchase_orders":
      return [`**${num(data.total)} open PO lines**, ${num(data.past_eta)} past ETA.`, table(["PO", "Vendor", "Product", "Pending", "ETA", "Orders held"], ["po", "vendor", "product", "pending", "eta", "orders_held"], rows(data.purchase_orders).slice(0, 15))].join("\n\n");
    case "open_procurement":
      return [`**${num(data.total)} open procurement requests**, ${num(data.past_eta)} past ETA, ${num(data.without_eta)} without an ETA.`, table(["Order", "Product", "Vendor", "Status", "ETA"], ["order_id", "product", "vendor", "status", "eta"], rows(data.requests).slice(0, 15))].join("\n\n");
    case "dispatch_queue": {
      const t = obj(data.totals);
      return [
        `**${rs(t.cod_to_collect_today_inr)} COD to collect today** from orders out for delivery. ${num(t.out_for_delivery)} out for delivery (${num(t.out_for_delivery_late)} late), ${num(t.ready_to_dispatch)} ready to dispatch (${rs(t.cod_on_ready_to_dispatch_inr)} COD on those).`,
        table(["Order", "Customer", "Hub", "Driver", "Expected", "COD due"], ["id", "customer", "hub", "driver", "expected_delivery", "cod_due_inr"], rows(data.out_for_delivery).slice(0, 12), ["cod_due_inr"]),
      ].join("\n\n");
    }
    case "installations_due":
      return [
        `**${num(data.overdue_count)} installations overdue, ${num(data.due_today_count)} due today**, ${num(data.next_3_days_count)} in the next 3 days.`,
        table(["Order", "Product", "Customer", "Due", "Technician"], ["order_id", "product", "customer", "due", "technician"], [...rows(data.overdue), ...rows(data.due_today)].slice(0, 15)),
      ].join("\n\n");
    case "recent_activity":
      return [`**Latest ${rows(data.events).length} events.**`, rows(data.events).map((e) => `- ${cell(e.at_ist)} · ${cell(e.order_id)} · ${cell(e.what)} (${cell(e.by)})`).join("\n")].join("\n\n");
    case "search_slack_messages":
      return [`**${num(data.total)} Slack messages match.**`, rows(data.messages).map((m) => `- ${cell(m.received_ist)} · ${cell(m.sender)}: ${cell(m.text)}`).join("\n")].join("\n\n");
    default:
      return "";
  }
}

async function execute(ctx: ToolContext, tool: string, input: Record<string, unknown>, steps: RulesStep[]): Promise<ToolOutput | null> {
  try {
    const output = await runTool(ctx, tool, input);
    steps.push({ tool, input, summary: output.summary, ok: true });
    return output;
  } catch (error) {
    const message = error instanceof ToolError ? error.message : "The data could not be read.";
    steps.push({ tool, input, summary: message, ok: false });
    return null;
  }
}

export async function rulesAnswer(question: string, ctx: ToolContext): Promise<RulesAnswer> {
  const steps: RulesStep[] = [];
  const parts: string[] = [];
  for (const step of planFor(question, ctx.now())) {
    const output = await execute(ctx, step.tool, step.input, steps);
    if (output) parts.push(render(step.tool, output.data));
  }
  const body = parts.filter(Boolean).join("\n\n");
  return { answer: body || "I could not read the operations data for this question. Try again in a minute.", steps };
}

/** A founder briefing from fixed reports, used when no model is configured. */
export async function rulesBriefing(ctx: ToolContext): Promise<RulesAnswer> {
  const steps: RulesStep[] = [];
  const today = todayIst(ctx.now());
  const yesterday = shiftIstDate(today, -1);
  const [pipeline, stuck, dispatch, installs, sToday, sYesterday, poc, low] = await Promise.all([
    execute(ctx, "pipeline_summary", {}, steps),
    execute(ctx, "stuck_orders", {}, steps),
    execute(ctx, "dispatch_queue", {}, steps),
    execute(ctx, "installations_due", {}, steps),
    execute(ctx, "sales_summary", { from: today, to: today, group_by: "hub" }, steps),
    execute(ctx, "sales_summary", { from: yesterday, to: yesterday, group_by: "hub" }, steps),
    execute(ctx, "sales_summary", { group_by: "poc" }, steps),
    execute(ctx, "low_stock", { limit: 10 }, steps),
  ]);
  const sections: string[] = [];
  if (pipeline && sToday && sYesterday) {
    const t = obj(sToday.data.totals);
    const y = obj(sYesterday.data.totals);
    const p = pipeline.data;
    sections.push(`**Headline** — ${num(t.orders)} orders today (${rs(t.offered_inr)} offered) against ${num(y.orders)} yesterday (${rs(y.offered_inr)}). ${num(p.open_orders)} orders are open, worth ${rs(p.open_pipeline_offered_inr)} offered. ${rs(obj(p.today).verified_received_inr)} verified received today.`);
  }
  if (stuck) sections.push(`**Needs attention**\n${render("stuck_orders", stuck.data)}`);
  if (low) sections.push(`**Stock and supply**\n${render("low_stock", low.data)}`);
  if (dispatch) sections.push(`**Cash and delivery**\n${render("dispatch_queue", dispatch.data)}`);
  if (installs) sections.push(`**Installations**\n${render("installations_due", installs.data)}`);
  if (poc) sections.push(`**POC window**\n${render("sales_summary", poc.data)}`);
  return { answer: sections.join("\n\n") || "The operations data could not be read.", steps };
}

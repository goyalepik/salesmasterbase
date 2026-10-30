import { nextStep } from "@/lib/ops/service";
import type { OpsStore } from "@/lib/ops/store";
import {
  HUBS,
  LINE_LABELS,
  ORDER_STAGES,
  STAGE_LABELS,
  type Order,
  type OrderFilter,
  type OrderLine,
  type OrderStage,
  type OrderSummary,
  type ProcurementRequest,
  type PurchaseOrder,
} from "@/lib/ops/types";
import type { OpsRepository } from "@/lib/repository";
import { clip, daysBetween, isIsoDate, istDate, istDateTime, istRange, maskPhone, maskPhonesInText, rupees, shiftIstDate, todayIst } from "@/lib/ai/util";

/**
 * Read-only tools over the operations store. The assistant (Anthropic or OpenAI tool calling),
 * the deterministic fallback and the MCP server all use this one registry.
 * Every result is compact JSON: capped row counts, phones masked to the last 4 digits.
 */

export type ToolContext = {
  store: OpsStore;
  /** Legacy Slack-message repository, for older free-text sales. Null when unavailable. */
  repo: OpsRepository | null;
  now: () => Date;
};

export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type ToolOutput = { summary: string; data: Record<string, unknown> };

export type ToolDef = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  run(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolOutput>;
};

/** A problem the caller can fix (bad input, unknown order). The message is safe to show. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

// ── Input helpers ────────────────────────────────────────────────────────────

function str(input: Record<string, unknown>, key: string, max = 120): string | undefined {
  const value = input[key];
  if (value == null) return undefined;
  if (typeof value !== "string" && typeof value !== "number") throw new ToolError(`${key} must be a string.`);
  const text = String(value).trim().slice(0, max);
  return text || undefined;
}

function int(input: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  const value = input[key];
  if (value == null || value === "") return fallback;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw new ToolError(`${key} must be a number.`);
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function oneOf<T extends string>(input: Record<string, unknown>, key: string, values: readonly T[], fallback: T): T {
  const value = str(input, key, 40);
  if (!value) return fallback;
  const hit = values.find((v) => v.toLowerCase() === value.toLowerCase());
  if (!hit) throw new ToolError(`${key} must be one of: ${values.join(", ")}.`);
  return hit;
}

function date(input: Record<string, unknown>, key: string): string | undefined {
  const value = str(input, key, 20);
  if (!value) return undefined;
  if (!isIsoDate(value)) throw new ToolError(`${key} must be an IST calendar date like 2026-10-30.`);
  return value;
}

function hubName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return HUBS.find((h) => h.toLowerCase() === value.toLowerCase()) ?? value;
}

/** Drop null, undefined, empty strings and empty arrays so payloads stay small. */
function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    out[key] = v;
  }
  return out as Partial<T>;
}

// ── Order helpers ────────────────────────────────────────────────────────────

const PAGE = 500;

async function allOrders(store: OpsStore, filter: OrderFilter, max = 5000): Promise<{ items: OrderSummary[]; total: number; truncated: boolean }> {
  const items: OrderSummary[] = [];
  let total = 0;
  for (let offset = 0; offset < max; offset += PAGE) {
    const page = await store.listOrders({ ...filter, limit: Math.min(PAGE, max - offset), offset });
    total = page.total;
    items.push(...page.items);
    if (page.items.length < PAGE) break;
  }
  return { items, total, truncated: total > items.length };
}

/** Imported orders whose sheet had no offered price carry the list price instead. */
export function priceIsEstimate(order: Pick<Order, "source" | "notes">): boolean {
  return order.source === "import" && /list price shown|offered price not in/i.test(order.notes ?? "");
}

type Lookups = { pos: Map<string, PurchaseOrder>; procurement: Map<string, ProcurementRequest> };

async function lookupsFor(store: OpsStore, orders: Array<{ lines: OrderLine[] }>): Promise<Lookups> {
  const lines = orders.flatMap((o) => o.lines);
  const needPo = lines.some((l) => l.poId);
  const needProc = lines.some((l) => l.procurementId);
  const [pos, procurement] = await Promise.all([
    needPo ? store.listPurchaseOrders({ status: "all" }) : Promise.resolve([]),
    needProc ? store.listProcurement({ status: "all" }) : Promise.resolve([]),
  ]);
  return { pos: new Map(pos.map((p) => [p.id, p])), procurement: new Map(procurement.map((p) => [p.id, p])) };
}

function lineEta(line: OrderLine, lk: Lookups | null): { eta: string | null; via: string | null } {
  if (!lk) return { eta: null, via: null };
  if (line.poId) {
    const po = lk.pos.get(line.poId);
    if (po) return { eta: po.eta, via: `${po.poNumber}${po.vendor ? ` (${po.vendor})` : ""}` };
  }
  if (line.procurementId) {
    const req = lk.procurement.get(line.procurementId);
    if (req) return { eta: req.eta, via: `procurement from ${req.vendor}${req.poNumber ? ` on ${req.poNumber}` : ""}` };
  }
  return { eta: null, via: null };
}

function ageDays(iso: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
}

function orderRow(order: OrderSummary, now: Date, lk: Lookups | null = null) {
  return compact({
    id: order.id,
    shopify: order.shopifyOrderId,
    created_ist: istDateTime(order.createdAt),
    age_days: ageDays(order.createdAt, now),
    stage: STAGE_LABELS[order.stage],
    hub: order.hub,
    poc: order.poc,
    customer: order.customerName,
    phone: maskPhone(order.phone),
    source: order.source,
    offered_inr: rupees(order.offeredTotalMinor),
    paid_inr: rupees(order.paidMinor),
    cod_due_inr: order.codDueMinor ? rupees(order.codDueMinor) : null,
    price_is_list_estimate: priceIsEstimate(order) || null,
    driver: order.driver,
    expected_delivery: order.expectedDeliveryDate,
    hold_reason: clip(order.holdReason, 120),
    cancel_reason: clip(order.cancelReason, 120),
    items: order.lines.map((line) => {
      const eta = lineEta(line, lk);
      return compact({
        product: clip(line.productName, 80),
        sku: line.sku,
        qty: line.qty !== 1 ? line.qty : null,
        status: LINE_LABELS[line.status],
        offered_inr: order.lines.length > 1 ? rupees(line.offeredPriceMinor) : null,
        eta: eta.eta,
        via: eta.via,
      });
    }),
  });
}

function normaliseOrderRef(raw: string): { kind: "id"; value: string } | { kind: "shopify"; value: string } | null {
  const text = raw.trim().toUpperCase().replace(/\s+/g, "");
  const epk = /^EPK-?(\d+)$/.exec(text);
  if (epk) return { kind: "id", value: `EPK-${epk[1].padStart(6, "0")}` };
  const pik = /^#?PIK(\d+)$/.exec(text);
  if (pik) return { kind: "shopify", value: `#PIK${pik[1]}` };
  if (/^\d{3,6}$/.test(text)) return { kind: "shopify", value: `#PIK${text}` };
  return null;
}

// ── Tools ────────────────────────────────────────────────────────────────────

const STAGE_INPUT = [...ORDER_STAGES, "open", "all"] as const;

const searchOrders: ToolDef = {
  name: "search_orders",
  description:
    "Find orders in the operations system. Free text `q` matches customer name, phone digits, order ID (EPK-…), Shopify number (#PIK…), SKU, product name or POC. Filters: stage (use 'open' for everything not yet delivered or cancelled; 'awaiting_stock' = waiting for a PO or procurement), hub, POC (salesperson), and created-date range in IST (from/to inclusive, YYYY-MM-DD). Returns newest first with stage, hub, POC, offered price (deal price), paid so far, COD due, and every product line's stock status with PO/procurement ETA when it is waiting for goods. Use this to list or count specific orders.",
  inputSchema: {
    type: "object",
    properties: {
      q: { type: "string", description: "Free text: customer, phone digits, EPK-/#PIK id, SKU, product or POC." },
      stage: { type: "string", enum: [...STAGE_INPUT], description: "Order stage, or 'open' / 'all'. Default 'all'." },
      hub: { type: "string", description: `Hub name, e.g. ${HUBS.join(", ")}.` },
      poc: { type: "string", description: "Salesperson (POC) name, exact match ignoring case." },
      from: { type: "string", description: "First IST date (YYYY-MM-DD) of order creation, inclusive." },
      to: { type: "string", description: "Last IST date (YYYY-MM-DD) of order creation, inclusive." },
      limit: { type: "integer", minimum: 1, maximum: 50, description: "Rows to return (default 20, max 50). `total` always gives the full count." },
    },
    additionalProperties: false,
  },
  async run(ctx, input) {
    const now = ctx.now();
    const from = date(input, "from");
    const to = date(input, "to");
    const filter: OrderFilter = {
      q: str(input, "q", 80),
      stage: oneOf(input, "stage", STAGE_INPUT, "all"),
      hub: hubName(str(input, "hub", 40)),
      poc: str(input, "poc", 60),
      from: from ? istRange(from, from).fromIso : undefined,
      to: to ? istRange(to, to).toIso : undefined,
      limit: int(input, "limit", 20, 1, 50),
    };
    const result = await ctx.store.listOrders(filter);
    const lk = await lookupsFor(ctx.store, result.items);
    const offered = result.items.reduce((s, o) => s + o.offeredTotalMinor, 0);
    return {
      summary: `${result.total} order${result.total === 1 ? "" : "s"} matched; ${result.items.length} shown.`,
      data: {
        total: result.total,
        shown: result.items.length,
        offered_inr_of_shown: rupees(offered),
        orders: result.items.map((o) => orderRow(o, now, lk)),
      },
    };
  },
};

const getOrder: ToolDef = {
  name: "get_order",
  description:
    "Full detail for one order by its ID (EPK-000123) or Shopify number (#PIK3918): customer, hub, POC, address, every product line with stock decision and ETA, verified payments, COD due, installations, procurement, the event history, and the next step with the team that owns it.",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string", description: "EPK-… order ID or #PIK… Shopify number." } },
    required: ["id"],
    additionalProperties: false,
  },
  async run(ctx, input) {
    const now = ctx.now();
    const raw = str(input, "id", 40);
    if (!raw) throw new ToolError("id is required.");
    const ref = normaliseOrderRef(raw);
    let detail = null;
    if (ref?.kind === "id") detail = await ctx.store.getOrder(ref.value);
    if (!detail) {
      const lookup = ref?.kind === "shopify" ? ref.value : raw;
      const hits = await ctx.store.listOrders({ q: lookup, stage: "all", limit: 10 });
      const match = hits.items.find((o) => o.id.toUpperCase() === lookup.toUpperCase() || o.shopifyOrderId?.toUpperCase() === lookup.toUpperCase());
      if (match) detail = await ctx.store.getOrder(match.id);
    }
    if (!detail) return { summary: `No order ${raw}.`, data: { found: false, id: raw } };
    const lk = await lookupsFor(ctx.store, [detail]);
    return {
      summary: `${detail.id}: ${STAGE_LABELS[detail.stage]}.`,
      data: {
        found: true,
        order: {
          ...orderRow(detail, now, lk),
          ...compact({
            address: clip(maskPhonesInText(detail.shippingAddress ?? ""), 160),
            pincode: detail.pincode,
            cx_type: detail.cxType,
            sale_source: detail.saleSource,
            sale_type: detail.saleType,
            declared_payment: [detail.declaredPaymentStatus, detail.declaredPaymentMode].filter(Boolean).join(" / ") || null,
            dispatched_ist: istDateTime(detail.dispatchedAt),
            delivered_ist: istDateTime(detail.deliveredAt),
            notes: clip(maskPhonesInText(detail.notes ?? ""), 300),
          }),
        },
        next_step: nextStep(detail),
        verified_payments: detail.payments.map((p) =>
          compact({ date_ist: istDateTime(p.createdAt), amount_inr: rupees(p.amountMinor), kind: p.kind, mode: p.mode, reference: p.reference, status: p.status, by: p.recordedBy }),
        ),
        installations: detail.installations.map((i) => compact({ product: clip(i.productName, 60), status: i.status, due: i.dueDate, done_ist: istDateTime(i.doneAt), technician: i.technician })),
        procurement: detail.procurement.map((r) => compact({ product: clip(r.productName, 60), vendor: r.vendor, status: r.status, eta: r.eta, po_number: r.poNumber, cost_inr: rupees(r.costMinor) })),
        history: detail.events.slice(-20).map((e) => ({ at_ist: istDateTime(e.createdAt), by: e.actor, what: clip(maskPhonesInText(e.summary), 200) })),
      },
    };
  },
};

const pipelineSummary: ToolDef = {
  name: "pipeline_summary",
  description:
    "Company snapshot right now: orders and offered value created today (IST), RevOps-verified money received today, deliveries today, count of orders at every stage, open pipeline value, overdue counts (payment/inventory checks older than 24h, late procurement, late installations), COD still to collect, stock totals, and the last 14 IST days of orders/offered/delivered. Start here for broad 'how are we doing' questions.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async run(ctx) {
    const m = await ctx.store.metrics(ctx.now());
    const open = Object.entries(m.pipeline).filter(([stage]) => stage !== "delivered" && stage !== "cancelled").reduce((s, [, n]) => s + n, 0);
    return {
      summary: `${open} open orders; ${m.today.orders} created today.`,
      data: {
        today: { orders_created: m.today.orders, offered_inr: rupees(m.today.offeredMinor), verified_received_inr: rupees(m.today.verifiedMinor), delivered: m.today.delivered },
        pipeline: ORDER_STAGES.map((stage) => ({ stage: STAGE_LABELS[stage], code: stage, orders: m.pipeline[stage] })),
        open_orders: open,
        open_pipeline_offered_inr: rupees(m.pipelineValueMinor),
        overdue: {
          payment_check_over_24h: m.overdue.stuckPayment,
          inventory_check_over_24h: m.overdue.stuckInventory,
          procurement_past_eta: m.overdue.lateProcurement,
          installations_past_due: m.overdue.lateInstallations,
        },
        cod_outstanding_inr: rupees(m.codOutstandingMinor),
        stock: { skus_in_stock: m.stock.skus, units_on_hand: m.stock.units, units_reserved: m.stock.reserved, units_incoming: m.stock.incoming, value_at_cost_inr: rupees(m.stock.valueMinor) },
        last_14_days: m.daily.map((d) => ({ day: d.day, orders: d.orders, offered_inr: rupees(d.offeredMinor), delivered: d.delivered })),
        notes: "offered = deal price, not money collected. verified_received_inr = RevOps-verified payments plus COD recorded on delivery today.",
      },
    };
  },
};

const GROUPS = ["day", "hub", "poc", "product"] as const;

const salesSummary: ToolDef = {
  name: "sales_summary",
  description:
    "Sales for an IST date range (orders created from/to, inclusive), grouped by day, hub, poc (salesperson) or product. Each row has orders, units, offered value (deal price), and paid so far on those orders. Cancelled orders are excluded and counted separately. Defaults to the incentive/POC window: today plus the previous 4 IST days. Also lists the largest orders so you can cite IDs, and counts imported orders whose price is a list-price estimate.",
  inputSchema: {
    type: "object",
    properties: {
      from: { type: "string", description: "First IST date, YYYY-MM-DD. Default: 4 days before today." },
      to: { type: "string", description: "Last IST date, YYYY-MM-DD, inclusive. Default: today." },
      group_by: { type: "string", enum: [...GROUPS], description: "Grouping. Default 'day'." },
    },
    additionalProperties: false,
  },
  async run(ctx, input) {
    const now = ctx.now();
    const today = todayIst(now);
    const to = date(input, "to") ?? today;
    const from = date(input, "from") ?? shiftIstDate(to, -4);
    if (from > to) throw new ToolError("from must be on or before to.");
    if (daysBetween(from, to) > 400) throw new ToolError("Use a range of at most 400 days.");
    const groupBy = oneOf(input, "group_by", GROUPS, "day");
    const range = istRange(from, to);
    const { items, truncated } = await allOrders(ctx.store, { stage: "all", from: range.fromIso, to: range.toIso });
    const cancelled = items.filter((o) => o.stage === "cancelled");
    const live = items.filter((o) => o.stage !== "cancelled");

    type Row = { key: string; orders: Set<string>; units: number; offered: number; paid: number; estimated: number };
    const rows = new Map<string, Row>();
    const bump = (key: string, order: OrderSummary, units: number, offered: number, paid: number) => {
      const row = rows.get(key) ?? { key, orders: new Set<string>(), units: 0, offered: 0, paid: 0, estimated: 0 };
      if (!row.orders.has(order.id) && priceIsEstimate(order)) row.estimated += 1;
      row.orders.add(order.id);
      row.units += units;
      row.offered += offered;
      row.paid += paid;
      rows.set(key, row);
    };
    if (groupBy === "day" && daysBetween(from, to) <= 62) {
      for (let d = from; d <= to; d = shiftIstDate(d, 1)) rows.set(d, { key: d, orders: new Set(), units: 0, offered: 0, paid: 0, estimated: 0 });
    }
    for (const order of live) {
      const units = order.lines.reduce((s, l) => s + l.qty, 0);
      if (groupBy === "product") {
        for (const line of order.lines) {
          const share = order.offeredTotalMinor ? line.offeredPriceMinor / order.offeredTotalMinor : 0;
          bump(line.sku ? `${line.productName} [${line.sku}]` : `${line.productName} [no SKU]`, order, line.qty, line.offeredPriceMinor, Math.round(order.paidMinor * share));
        }
      } else {
        const key = groupBy === "day" ? istDate(order.createdAt)! : groupBy === "hub" ? order.hub ?? "No hub" : order.poc ?? "No POC";
        bump(key, order, units, order.offeredTotalMinor, order.paidMinor);
      }
    }
    const sorted = [...rows.values()].sort((a, b) => (groupBy === "day" ? a.key.localeCompare(b.key) : b.offered - a.offered || b.orders.size - a.orders.size));
    const offered = live.reduce((s, o) => s + o.offeredTotalMinor, 0);
    const paid = live.reduce((s, o) => s + o.paidMinor, 0);
    const estimated = live.filter(priceIsEstimate).length;
    const imported = live.filter((o) => o.source === "import").length;
    const largest = [...live].sort((a, b) => b.offeredTotalMinor - a.offeredTotalMinor).slice(0, 5);
    return {
      summary: `${live.length} orders, ${rows.size} ${groupBy} group${rows.size === 1 ? "" : "s"}, ${from} to ${to}.`,
      data: {
        from,
        to,
        group_by: groupBy,
        totals: compact({
          orders: live.length,
          units: live.reduce((s, o) => s + o.lines.reduce((n, l) => n + l.qty, 0), 0),
          offered_inr: rupees(offered),
          paid_so_far_inr: rupees(paid),
          cancelled_orders_excluded: cancelled.length || null,
          imported_orders: imported || null,
          orders_with_list_price_estimate: estimated || null,
          truncated: truncated || null,
        }),
        rows: sorted.slice(0, 40).map((r) =>
          compact({ [groupBy]: r.key, orders: r.orders.size, units: r.units, offered_inr: rupees(r.offered), paid_so_far_inr: rupees(r.paid), list_price_estimates: r.estimated || null }),
        ),
        more_rows: sorted.length > 40 ? sorted.length - 40 : null,
        largest_orders: largest.map((o) => compact({ id: o.id, shopify: o.shopifyOrderId, customer: o.customerName, poc: o.poc, hub: o.hub, offered_inr: rupees(o.offeredTotalMinor), stage: STAGE_LABELS[o.stage] })),
        notes: "paid_so_far = money recorded against these orders to date (for imported orders it comes from the sheets, not RevOps verification). Product rows split an order's paid amount by line value.",
      },
    };
  },
};

async function skuDetail(ctx: ToolContext, sku: string) {
  const now = ctx.now();
  const [product, level, movements, pos, open] = await Promise.all([
    ctx.store.getProduct(sku),
    ctx.store.stockFor(sku),
    ctx.store.listMovements(sku, 15),
    ctx.store.listPurchaseOrders({ status: "open", sku }),
    allOrders(ctx.store, { stage: "open", q: sku }, 500),
  ]);
  const reservedFor: string[] = [];
  const waiting: Array<{ id: string; status: string }> = [];
  for (const order of open.items) {
    for (const line of order.lines) {
      if (line.sku !== sku) continue;
      if (line.status === "reserved") reservedFor.push(order.id);
      else if (line.status === "pending" || line.status === "awaiting_po" || line.status === "procuring") waiting.push({ id: order.id, status: LINE_LABELS[line.status] });
    }
  }
  return {
    sku,
    name: product?.name ?? level?.name ?? null,
    brand: product?.brand ?? null,
    on_hand: level?.onHand ?? 0,
    reserved: level?.reserved ?? 0,
    free_available: level?.available ?? 0,
    incoming_on_open_pos: level?.incoming ?? 0,
    next_eta: level?.nextEta ?? null,
    unit_cost_inr: rupees(level?.unitCostMinor ?? null),
    list_price_inr: rupees(product?.listPriceMinor ?? null),
    reserved_for_orders: reservedFor.slice(0, 20),
    orders_waiting_for_it: waiting.slice(0, 20),
    open_pos: pos.slice(0, 10).map((p) => compact({ po: p.poNumber, vendor: p.vendor, pending: p.qtyOrdered - p.qtyReceived, eta: p.eta })),
    recent_movements: movements.map((m) => compact({ at_ist: istDateTime(m.createdAt), qty: m.qty, kind: m.kind, ref: [m.refType, m.refId].filter(Boolean).join(" ") || null, serial: m.serialNo, note: clip(m.note, 60) })),
    age_note: `Checked ${istDateTime(now.toISOString())} IST.`,
  };
}

const stockLookup: ToolDef = {
  name: "stock_lookup",
  description:
    "Stock for a product. Give `sku` for one exact SKU (adds movement history, open POs, which orders hold reservations and which are waiting), or `q` with words from the product name/brand (e.g. 'DREAME L50s Pro Ultra'). free_available = on hand minus units reserved for orders; incoming = still pending on open purchase orders. When q matches exactly one product the full detail is returned; otherwise a list to choose from.",
  inputSchema: {
    type: "object",
    properties: {
      q: { type: "string", description: "Words from the product name, brand or SKU." },
      sku: { type: "string", description: "Exact SKU, e.g. ep-dr-l50s-pu." },
    },
    additionalProperties: false,
  },
  async run(ctx, input) {
    const sku = str(input, "sku", 80);
    const q = str(input, "q", 80);
    if (!sku && !q) throw new ToolError("Give q or sku.");
    if (sku && (await ctx.store.getProduct(sku) || await ctx.store.stockFor(sku))) {
      const detail = await skuDetail(ctx, sku);
      return { summary: `${sku}: ${detail.free_available} free, ${detail.reserved} reserved, ${detail.incoming_on_open_pos} incoming.`, data: { match: "sku", product: detail } };
    }
    const term = q ?? sku!;
    let products = (await ctx.store.searchProducts(term, 15)).map((p) => ({ sku: p.sku, name: p.name }));
    if (!products.length) products = (await ctx.store.stockLevels({ q: term, limit: 15 })).map((s) => ({ sku: s.sku, name: s.name }));
    if (!products.length) return { summary: `No product matches “${term}”.`, data: { match: "none", q: term } };
    if (products.length === 1) {
      const detail = await skuDetail(ctx, products[0].sku);
      return { summary: `${products[0].sku}: ${detail.free_available} free, ${detail.reserved} reserved, ${detail.incoming_on_open_pos} incoming.`, data: { match: "single", product: detail } };
    }
    const levels = await Promise.all(products.map((p) => ctx.store.stockFor(p.sku)));
    const rows = products.map((p, i) => compact({ sku: p.sku, name: clip(p.name, 80), on_hand: levels[i]?.onHand ?? 0, reserved: levels[i]?.reserved ?? 0, free_available: levels[i]?.available ?? 0, incoming: levels[i]?.incoming ?? 0, next_eta: levels[i]?.nextEta }));
    const free = rows.reduce((s, r) => s + (r.free_available ?? 0), 0);
    return {
      summary: `${rows.length} products match “${term}”; ${free} free in total.`,
      data: { match: "several", q: term, total_free_available: free, products: rows, hint: "Call stock_lookup with sku for movements and the orders holding or waiting for a SKU." },
    };
  },
};

/** Units still needed by open orders, per SKU (lines not yet reserved or dispatched). */
async function openDemand(store: OpsStore) {
  const open = await allOrders(store, { stage: "open" });
  const demand = new Map<string, { sku: string; name: string; units: number; orders: string[] }>();
  for (const order of open.items) {
    for (const line of order.lines) {
      if (!line.sku || !(line.status === "pending" || line.status === "awaiting_po" || line.status === "procuring")) continue;
      const row = demand.get(line.sku) ?? { sku: line.sku, name: line.productName, units: 0, orders: [] };
      row.units += line.qty;
      row.orders.push(order.id);
      demand.set(line.sku, row);
    }
  }
  return demand;
}

const lowStock: ToolDef = {
  name: "low_stock",
  description:
    "SKUs that are out of stock or nearly out, ranked by shortfall against open orders still waiting for them (demand − free − incoming). Includes SKUs open orders need that have never been stocked. Use for 'what should we reorder' or 'what are we short of'.",
  inputSchema: {
    type: "object",
    properties: {
      max_available: { type: "integer", minimum: 0, maximum: 10, description: "Include SKUs with at most this many free units (default 1)." },
      limit: { type: "integer", minimum: 1, maximum: 50, description: "Rows (default 30)." },
    },
    additionalProperties: false,
  },
  async run(ctx, input) {
    const maxAvailable = int(input, "max_available", 1, 0, 10);
    const limit = int(input, "limit", 30, 1, 50);
    const [levels, demand] = await Promise.all([ctx.store.stockLevels({ only: "all", limit: 10_000 }), openDemand(ctx.store)]);
    const rows = levels
      .filter((l) => l.available <= maxAvailable)
      .map((l) => {
        const need = demand.get(l.sku);
        return { sku: l.sku, name: l.name, on_hand: l.onHand, reserved: l.reserved, free_available: l.available, incoming: l.incoming, next_eta: l.nextEta, open_demand_units: need?.units ?? 0, waiting_orders: need?.orders.slice(0, 8) ?? [] };
      });
    const seen = new Set(levels.map((l) => l.sku));
    for (const need of demand.values()) {
      if (seen.has(need.sku)) continue;
      rows.push({ sku: need.sku, name: need.name, on_hand: 0, reserved: 0, free_available: 0, incoming: 0, next_eta: null, open_demand_units: need.units, waiting_orders: need.orders.slice(0, 8) });
    }
    const shortfall = (r: (typeof rows)[number]) => r.open_demand_units - Math.max(0, r.free_available) - r.incoming;
    rows.sort((a, b) => shortfall(b) - shortfall(a) || b.open_demand_units - a.open_demand_units || a.free_available - b.free_available || a.name.localeCompare(b.name));
    const short = rows.filter((r) => shortfall(r) > 0).length;
    return {
      summary: `${rows.length} SKUs at or below ${maxAvailable} free; ${short} short of open demand.`,
      data: {
        total: rows.length,
        short_of_open_demand: short,
        skus: rows.slice(0, limit).map((r) => compact({ ...r, name: clip(r.name, 70), shortfall: Math.max(0, shortfall(r)) || null })),
      },
    };
  },
};

const openProcurement: ToolDef = {
  name: "open_procurement",
  description:
    "Customer-specific procurement requests still open (requested or ordered from a vendor for one order line): order ID, product, vendor, status, ETA, days late, PO number and cost. Use for 'what are we buying for customers' and 'which procurement is late'.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async run(ctx) {
    const today = todayIst(ctx.now());
    const items = await ctx.store.listProcurement({ status: "open" });
    const late = items.filter((r) => r.eta && r.eta < today).length;
    const noEta = items.filter((r) => !r.eta).length;
    return {
      summary: `${items.length} open procurement requests; ${late} past ETA.`,
      data: {
        total: items.length,
        past_eta: late,
        without_eta: noEta,
        requests: items.slice(0, 40).map((r) =>
          compact({ order_id: r.orderId, product: clip(r.productName, 70), sku: r.sku, vendor: r.vendor, status: r.status, eta: r.eta, days_late: r.eta && r.eta < today ? daysBetween(r.eta, today) : null, po_number: r.poNumber, cost_inr: rupees(r.costMinor), requested: istDate(r.createdAt) }),
        ),
      },
    };
  },
};

const openPurchaseOrders: ToolDef = {
  name: "open_purchase_orders",
  description:
    "Open brand/vendor purchase orders (stock POs): PO number, vendor, SKU, product, ordered/received/pending units, ETA, days late, and which customer orders are held waiting on each PO. Optional `sku` filter. Use for 'when does stock arrive' and 'which orders are waiting on POs'.",
  inputSchema: {
    type: "object",
    properties: { sku: { type: "string", description: "Only POs for this exact SKU." } },
    additionalProperties: false,
  },
  async run(ctx, input) {
    const today = todayIst(ctx.now());
    const sku = str(input, "sku", 80);
    const [pos, waiting] = await Promise.all([ctx.store.listPurchaseOrders({ status: "open", sku }), allOrders(ctx.store, { stage: "open" })]);
    const held = new Map<string, string[]>();
    for (const order of waiting.items) for (const line of order.lines) if (line.poId && line.status === "awaiting_po") held.set(line.poId, [...(held.get(line.poId) ?? []), order.id]);
    const names = new Map<string, string>();
    for (const po of pos.slice(0, 40)) {
      if (po.productName || names.has(po.sku)) continue;
      const product = await ctx.store.getProduct(po.sku);
      if (product) names.set(po.sku, product.name);
    }
    const late = pos.filter((p) => p.eta && p.eta < today).length;
    return {
      summary: `${pos.length} open PO line${pos.length === 1 ? "" : "s"}; ${late} past ETA.`,
      data: {
        total: pos.length,
        past_eta: late,
        purchase_orders: pos.slice(0, 40).map((p) =>
          compact({ po: p.poNumber, vendor: p.vendor, sku: p.sku, product: clip(p.productName ?? names.get(p.sku) ?? null, 70), ordered: p.qtyOrdered, received: p.qtyReceived, pending: p.qtyOrdered - p.qtyReceived, eta: p.eta, days_late: p.eta && p.eta < today ? daysBetween(p.eta, today) : null, orders_held: held.get(p.id) ?? [] }),
        ),
      },
    };
  },
};

const dispatchQueue: ToolDef = {
  name: "dispatch_queue",
  description:
    "Logistics queue: orders ready to dispatch and orders out for delivery, with driver, expected delivery date, and COD still to collect. Totals include COD to collect today (out for delivery with expected date today, earlier, or not set) and COD on orders not yet dispatched. Optional hub filter.",
  inputSchema: {
    type: "object",
    properties: { hub: { type: "string", description: `Hub name, e.g. ${HUBS.join(", ")}.` } },
    additionalProperties: false,
  },
  async run(ctx, input) {
    const now = ctx.now();
    const today = todayIst(now);
    const hub = hubName(str(input, "hub", 40));
    const [ready, out] = await Promise.all([
      allOrders(ctx.store, { stage: "ready_to_dispatch", hub }, 1000),
      allOrders(ctx.store, { stage: "out_for_delivery", hub }, 1000),
    ]);
    const dueToday = out.items.filter((o) => !o.expectedDeliveryDate || o.expectedDeliveryDate <= today);
    const late = out.items.filter((o) => o.expectedDeliveryDate && o.expectedDeliveryDate < today);
    const sum = (list: OrderSummary[]) => rupees(list.reduce((s, o) => s + o.codDueMinor, 0));
    const byDate = (a: OrderSummary, b: OrderSummary) => (a.expectedDeliveryDate ?? "0").localeCompare(b.expectedDeliveryDate ?? "0") || a.createdAt.localeCompare(b.createdAt);
    const row = (o: OrderSummary) =>
      compact({ id: o.id, shopify: o.shopifyOrderId, hub: o.hub, poc: o.poc, customer: o.customerName, phone: maskPhone(o.phone), products: o.lines.map((l) => clip(l.productName, 50)).join("; "), cod_due_inr: o.codDueMinor ? rupees(o.codDueMinor) : null, driver: o.driver, expected_delivery: o.expectedDeliveryDate, dispatched_ist: istDateTime(o.dispatchedAt), age_days: ageDays(o.createdAt, now), price_is_list_estimate: priceIsEstimate(o) || null });
    return {
      summary: `${ready.total} ready to dispatch, ${out.total} out for delivery.`,
      data: {
        hub: hub ?? "all",
        totals: {
          ready_to_dispatch: ready.total,
          out_for_delivery: out.total,
          out_for_delivery_late: late.length,
          cod_to_collect_today_inr: sum(dueToday),
          cod_on_out_for_delivery_inr: sum(out.items),
          cod_on_ready_to_dispatch_inr: sum(ready.items),
        },
        ready_to_dispatch: [...ready.items].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, 30).map(row),
        out_for_delivery: [...out.items].sort(byDate).slice(0, 30).map(row),
      },
    };
  },
};

const installationsDue: ToolDef = {
  name: "installations_due",
  description:
    "Pending installations (robot vacuums are due the day after delivery): overdue, due today, and due in the next 3 days, with order ID, product, customer, masked phone, due date and technician.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async run(ctx) {
    const today = todayIst(ctx.now());
    const soon = shiftIstDate(today, 3);
    const pending = await ctx.store.listInstallations({ status: "pending" });
    const row = (i: (typeof pending)[number]) => compact({ order_id: i.orderId, product: clip(i.productName, 60), customer: i.customerName, phone: maskPhone(i.phone), due: i.dueDate, days_overdue: i.dueDate < today ? daysBetween(i.dueDate, today) : null, technician: i.technician });
    const overdue = pending.filter((i) => i.dueDate < today);
    const dueToday = pending.filter((i) => i.dueDate === today);
    const upcoming = pending.filter((i) => i.dueDate > today && i.dueDate <= soon);
    return {
      summary: `${overdue.length} overdue, ${dueToday.length} due today, ${upcoming.length} in the next 3 days.`,
      data: {
        pending_total: pending.length,
        overdue_count: overdue.length,
        due_today_count: dueToday.length,
        next_3_days_count: upcoming.length,
        later_count: pending.length - overdue.length - dueToday.length - upcoming.length,
        overdue: overdue.slice(0, 25).map(row),
        due_today: dueToday.slice(0, 25).map(row),
        next_3_days: upcoming.slice(0, 25).map(row),
      },
    };
  },
};

const stuckOrders: ToolDef = {
  name: "stuck_orders",
  description:
    "Everything that is stuck or late right now, grouped: payment check older than 24h, inventory decision older than 24h, lines waiting for stock past their PO/procurement ETA, out-for-delivery past the expected date, orders on hold, open procurement past ETA, and installations past due. Each group has a count, the offered value at stake, and the orders (IDs, customer, hub, POC, age). Use for 'what's stuck' or 'what needs attention'.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async run(ctx) {
    const now = ctx.now();
    const today = todayIst(now);
    const hours = (iso: string) => (now.getTime() - new Date(iso).getTime()) / 3_600_000;
    const open = await allOrders(ctx.store, { stage: "open" });
    const [procurement, installs] = await Promise.all([ctx.store.listProcurement({ status: "open" }), ctx.store.listInstallations({ status: "pending" })]);
    const lk = await lookupsFor(ctx.store, open.items);
    const group = (orders: OrderSummary[], detail: (o: OrderSummary) => string | null) => ({
      count: orders.length,
      offered_inr: rupees(orders.reduce((s, o) => s + o.offeredTotalMinor, 0)),
      orders: orders.slice(0, 15).map((o) => compact({ id: o.id, shopify: o.shopifyOrderId, customer: o.customerName, hub: o.hub, poc: o.poc, age_days: ageDays(o.createdAt, now), offered_inr: rupees(o.offeredTotalMinor), detail: detail(o), price_is_list_estimate: priceIsEstimate(o) || null })),
    });
    const by = (stage: OrderStage) => open.items.filter((o) => o.stage === stage).sort((a, b) => a.stageChangedAt.localeCompare(b.stageChangedAt));
    const payment = by("awaiting_payment").filter((o) => hours(o.stageChangedAt) > 24);
    const inventory = by("awaiting_inventory").filter((o) => hours(o.stageChangedAt) > 24);
    const lateStock = by("awaiting_stock").filter((o) => o.lines.some((l) => { const eta = lineEta(l, lk).eta; return eta != null && eta < today; }));
    const noEtaStock = by("awaiting_stock").filter((o) => o.lines.every((l) => (l.status === "awaiting_po" || l.status === "procuring" ? !lineEta(l, lk).eta : true)) && o.lines.some((l) => l.status === "awaiting_po" || l.status === "procuring"));
    const lateDelivery = by("out_for_delivery").filter((o) => o.expectedDeliveryDate && o.expectedDeliveryDate < today);
    const longOut = by("out_for_delivery").filter((o) => !o.expectedDeliveryDate && o.dispatchedAt && hours(o.dispatchedAt) > 48);
    const onHold = by("on_hold");
    const lateProc = procurement.filter((r) => r.eta && r.eta < today);
    const lateInstall = installs.filter((i) => i.dueDate < today);
    const etaDetail = (o: OrderSummary) => o.lines.map((l) => { const e = lineEta(l, lk); return e.eta ? `${clip(l.productName, 40)} ETA ${e.eta} via ${e.via}` : null; }).filter(Boolean).join("; ") || null;
    const groups = {
      payment_check_over_24h: group(payment, () => "RevOps has not verified payment"),
      inventory_decision_over_24h: group(inventory, (o) => `${o.lines.filter((l) => l.status === "pending").length} line(s) need a stock decision`),
      waiting_for_stock_past_eta: group(lateStock, etaDetail),
      waiting_for_stock_without_eta: group(noEtaStock, () => "No ETA recorded"),
      out_for_delivery_past_expected_date: group(lateDelivery, (o) => `Expected ${o.expectedDeliveryDate}${o.driver ? `, driver ${o.driver}` : ""}`),
      out_for_delivery_over_48h_no_date: group(longOut, (o) => `Dispatched ${istDate(o.dispatchedAt)}`),
      on_hold: group(onHold, (o) => clip(o.holdReason, 100)),
    };
    const total = Object.values(groups).reduce((s, g) => s + g.count, 0) + lateProc.length + lateInstall.length;
    return {
      summary: `${total} stuck or late items across ${Object.values(groups).filter((g) => g.count).length + (lateProc.length ? 1 : 0) + (lateInstall.length ? 1 : 0)} groups.`,
      data: {
        total_items: total,
        ...groups,
        procurement_past_eta: {
          count: lateProc.length,
          requests: lateProc.slice(0, 15).map((r) => compact({ order_id: r.orderId, product: clip(r.productName, 60), vendor: r.vendor, eta: r.eta, days_late: daysBetween(r.eta!, today), status: r.status })),
        },
        installations_past_due: {
          count: lateInstall.length,
          items: lateInstall.slice(0, 15).map((i) => compact({ order_id: i.orderId, product: clip(i.productName, 60), customer: i.customerName, due: i.dueDate, days_overdue: daysBetween(i.dueDate, today), technician: i.technician })),
        },
        rules: "Payment and inventory checks are stuck after 24h from order creation. Dates are IST.",
      },
    };
  },
};

const recentActivity: ToolDef = {
  name: "recent_activity",
  description: "The latest events across all orders (sales posted, payments verified, stock decisions, dispatches, deliveries, installations, notes), newest first, with IST time, order ID and who did it.",
  inputSchema: {
    type: "object",
    properties: { limit: { type: "integer", minimum: 1, maximum: 50, description: "Events to return (default 20)." } },
    additionalProperties: false,
  },
  async run(ctx, input) {
    const limit = int(input, "limit", 20, 1, 50);
    const events = await ctx.store.recentEvents(limit);
    return {
      summary: `${events.length} recent event${events.length === 1 ? "" : "s"}.`,
      data: { events: events.map((e) => ({ at_ist: istDateTime(e.createdAt), order_id: e.orderId, type: e.type, by: e.actor, what: clip(maskPhonesInText(e.summary), 200) })) },
    };
  },
};

const searchSlackMessages: ToolDef = {
  name: "search_slack_messages",
  description:
    "Search the legacy Slack sales channel messages (free text posted before the structured order flow, and their extracted customer/amount fields). Use when an order is not found in the operations system or the question is about older Slack posts. Amounts here are what salespeople typed, not verified payments.",
  inputSchema: {
    type: "object",
    properties: {
      q: { type: "string", description: "Words to search for (customer, product, amount, order reference)." },
      from: { type: "string", description: "First IST date, YYYY-MM-DD." },
      to: { type: "string", description: "Last IST date, YYYY-MM-DD, inclusive." },
      limit: { type: "integer", minimum: 1, maximum: 25, description: "Rows (default 10)." },
    },
    additionalProperties: false,
  },
  async run(ctx, input) {
    if (!ctx.repo) throw new ToolError("Legacy Slack messages are not available in this workspace.");
    const q = str(input, "q", 80) ?? "";
    const limit = int(input, "limit", 10, 1, 25);
    const page = await ctx.repo.listMessages({ q, status: "all", channel: "", from: date(input, "from") ?? "", to: date(input, "to") ?? "", page: 1, pageSize: limit, view: "all" });
    return {
      summary: `${page.total} Slack message${page.total === 1 ? "" : "s"} matched; ${page.items.length} shown.`,
      data: {
        total: page.total,
        messages: page.items.map((m) =>
          compact({ id: m.id, received_ist: istDateTime(m.eventReceivedAt), sender: m.senderName ?? m.senderId, customer: m.customerName, order_ref: m.orderReference, amount_text: m.amountText, status: m.processingStatus, text: clip(maskPhonesInText(m.text), 280) }),
        ),
      },
    };
  },
};

export const TOOLS: ToolDef[] = [
  pipelineSummary,
  stuckOrders,
  searchOrders,
  getOrder,
  salesSummary,
  stockLookup,
  lowStock,
  openPurchaseOrders,
  openProcurement,
  dispatchQueue,
  installationsDue,
  recentActivity,
  searchSlackMessages,
];

export function findTool(name: string): ToolDef | undefined {
  return TOOLS.find((tool) => tool.name === name);
}

/** Runs a tool and stamps the IST date on the result. Throws ToolError for bad input or unknown tools. */
export async function runTool(ctx: ToolContext, name: string, input: unknown): Promise<ToolOutput> {
  const tool = findTool(name);
  if (!tool) throw new ToolError(`Unknown tool ${name}.`);
  const args = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const output = await tool.run(ctx, args);
  return { summary: output.summary, data: { today_ist: todayIst(ctx.now()), ...output.data } };
}

const MAX_RESULT_CHARS = 24_000;

/** JSON for a model or MCP client, cut to a safe size. */
export function serialiseResult(output: ToolOutput): string {
  const text = JSON.stringify(output.data);
  if (text.length <= MAX_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_RESULT_CHARS)}… [truncated: narrow the query with filters or a lower limit]`;
}

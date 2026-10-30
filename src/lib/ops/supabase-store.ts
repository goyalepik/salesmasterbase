import type { SupabaseClient } from "@supabase/supabase-js";
import { istDayBounds } from "@/lib/format";
import { log } from "@/lib/log";
import { computeMetrics } from "@/lib/ops/metrics";
import type { InstallFilter, OpsStore, PoFilter, ProcurementFilter, StockFilter } from "@/lib/ops/store";
import {
  OPEN_STAGES,
  type Installation,
  type NewOrderInput,
  type Order,
  type OrderDetail,
  type OrderEvent,
  type OrderFilter,
  type OrderLine,
  type OrderStage,
  type OrderSummary,
  type Payment,
  type Person,
  type ProcurementRequest,
  type Product,
  type PurchaseOrder,
  type ReserveResult,
  type Role,
  type StockLevel,
  type StockMovement,
} from "@/lib/ops/types";

type Row = Record<string, unknown>;
type DbError = { code?: string; message?: string } | null;

const s = (v: unknown): string | null => (typeof v === "string" ? v : v == null ? null : String(v));
const n = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : 0);
const nn = (v: unknown): number | null => (v == null || v === "" ? null : n(v));

function check(error: DbError, where: string): void {
  if (!error) return;
  log("error", "ops_db_error", { where, code: error.code ?? "unknown", message: error.message?.slice(0, 200) ?? "" });
  throw new Error(`The database request failed (${where}).`);
}

function snake(patch: Record<string, unknown>): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    out[key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = value;
  }
  return out;
}

const product = (r: Row): Product => ({
  sku: s(r.sku)!,
  name: s(r.name) ?? "",
  brand: s(r.brand),
  category: s(r.category),
  channel: (s(r.channel) as Product["channel"]) ?? null,
  listPriceMinor: nn(r.list_price_minor),
  gstRate: nn(r.gst_rate),
  hsn: s(r.hsn),
  eol: Boolean(r.eol),
  needsInstallation: Boolean(r.needs_installation),
});

const order = (r: Row): Order => ({
  id: s(r.id)!,
  createdAt: s(r.created_at)!,
  updatedAt: s(r.updated_at)!,
  source: s(r.source) as Order["source"],
  stage: s(r.stage) as OrderStage,
  stageChangedAt: s(r.stage_changed_at) ?? s(r.created_at)!,
  customerName: s(r.customer_name) ?? "",
  phone: s(r.phone),
  email: s(r.email),
  shippingAddress: s(r.shipping_address),
  pincode: s(r.pincode),
  billingAddress: s(r.billing_address),
  gst: s(r.gst),
  hub: s(r.hub),
  cxType: s(r.cx_type),
  poc: s(r.poc),
  saleSource: s(r.sale_source),
  saleType: s(r.sale_type),
  declaredPaymentStatus: s(r.declared_payment_status),
  declaredPaymentMode: s(r.declared_payment_mode),
  notes: s(r.notes),
  shopifyOrderId: s(r.shopify_order_id),
  slackChannelId: s(r.slack_channel_id),
  slackMessageTs: s(r.slack_message_ts),
  createdBy: s(r.created_by),
  offeredTotalMinor: n(r.offered_total_minor),
  paidMinor: n(r.paid_minor),
  codDueMinor: n(r.cod_due_minor),
  driver: s(r.driver),
  expectedDeliveryDate: s(r.expected_delivery_date),
  dispatchedAt: s(r.dispatched_at),
  deliveredAt: s(r.delivered_at),
  holdReason: s(r.hold_reason),
  cancelReason: s(r.cancel_reason),
});

const line = (r: Row): OrderLine => ({
  id: s(r.id)!,
  orderId: s(r.order_id)!,
  lineNo: n(r.line_no),
  sku: s(r.sku),
  productName: s(r.product_name) ?? "",
  qty: n(r.qty) || 1,
  listPriceMinor: nn(r.list_price_minor),
  offeredPriceMinor: n(r.offered_price_minor),
  accessories: s(r.accessories),
  extendedWarranty: s(r.extended_warranty),
  installation: s(r.installation),
  status: s(r.status) as OrderLine["status"],
  poId: s(r.po_id),
  procurementId: s(r.procurement_id),
  serialNo: s(r.serial_no),
  rejectReason: s(r.reject_reason),
});

const payment = (r: Row): Payment => ({
  id: s(r.id)!,
  orderId: s(r.order_id)!,
  amountMinor: n(r.amount_minor),
  mode: s(r.mode) ?? "",
  kind: s(r.kind) as Payment["kind"],
  reference: s(r.reference),
  status: s(r.status) as Payment["status"],
  recordedBy: s(r.recorded_by) ?? "",
  createdAt: s(r.created_at)!,
});

const event = (r: Row): OrderEvent => ({
  id: s(r.id)!,
  orderId: s(r.order_id)!,
  lineId: s(r.line_id),
  type: s(r.type) ?? "",
  actor: s(r.actor) ?? "",
  summary: s(r.summary) ?? "",
  createdAt: s(r.created_at)!,
});

const install = (r: Row): Installation => ({
  id: s(r.id)!,
  orderId: s(r.order_id)!,
  lineId: s(r.line_id)!,
  sku: s(r.sku),
  productName: s(r.product_name) ?? "",
  customerName: s(r.customer_name) ?? "",
  phone: s(r.phone),
  address: s(r.address),
  status: s(r.status) as Installation["status"],
  dueDate: s(r.due_date)!,
  doneAt: s(r.done_at),
  technician: s(r.technician),
  note: s(r.note),
});

const po = (r: Row): PurchaseOrder => ({
  id: s(r.id)!,
  poNumber: s(r.po_number) ?? "",
  vendor: s(r.vendor),
  sku: s(r.sku)!,
  productName: s(r.product_name),
  qtyOrdered: n(r.qty_ordered),
  qtyReceived: n(r.qty_received),
  eta: s(r.eta),
  status: s(r.status) as PurchaseOrder["status"],
  createdAt: s(r.created_at)!,
});

const procurement = (r: Row): ProcurementRequest => ({
  id: s(r.id)!,
  orderId: s(r.order_id)!,
  lineId: s(r.line_id)!,
  sku: s(r.sku),
  productName: s(r.product_name) ?? "",
  vendor: s(r.vendor) ?? "",
  costMinor: nn(r.cost_minor),
  eta: s(r.eta),
  status: s(r.status) as ProcurementRequest["status"],
  poNumber: s(r.po_number),
  createdAt: s(r.created_at)!,
  updatedAt: s(r.updated_at)!,
});

const level = (r: Row): StockLevel => ({
  sku: s(r.sku)!,
  name: s(r.name) ?? "",
  brand: s(r.brand),
  category: s(r.category),
  channel: (s(r.channel) as StockLevel["channel"]) ?? null,
  onHand: n(r.on_hand),
  reserved: n(r.reserved),
  available: n(r.available),
  incoming: n(r.incoming),
  nextEta: s(r.next_eta),
  unitCostMinor: nn(r.unit_cost_minor),
});

function like(q: string): string {
  return `%${q.replace(/[%_,()]/g, " ").trim()}%`;
}

/** Supabase hands back at most 1,000 rows per request, so long lists are read page by page. */
const PAGE = 1000;
type Ranged = { range(from: number, to: number): PromiseLike<{ data: Row[] | null; error: DbError }> };

async function readAll(make: () => Ranged, max: number, where: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const to = Math.min(from + PAGE, max) - 1;
    const { data, error } = await make().range(from, to);
    check(error, where);
    out.push(...(data ?? []));
    if (!data || data.length < to - from + 1) break;
  }
  return out;
}

export class SupabaseOpsStore implements OpsStore {
  readonly kind = "supabase" as const;
  constructor(private db: SupabaseClient) {}

  async upsertProducts(products: Product[]) {
    for (let i = 0; i < products.length; i += 500) {
      const rows = products.slice(i, i + 500).map((p) => ({
        sku: p.sku, name: p.name, brand: p.brand, category: p.category, channel: p.channel,
        list_price_minor: p.listPriceMinor, gst_rate: p.gstRate, hsn: p.hsn, eol: p.eol,
        needs_installation: p.needsInstallation, active: true, updated_at: new Date().toISOString(),
      }));
      const { error } = await this.db.from("products").upsert(rows);
      check(error, "upsert products");
    }
  }

  async searchProducts(q: string, limit: number) {
    let request = this.db.from("products").select("*").eq("active", true);
    const terms = q.trim().split(/\s+/).filter(Boolean).slice(0, 4);
    for (const term of terms) request = request.or(`name.ilike.${like(term)},sku.ilike.${like(term)},brand.ilike.${like(term)}`);
    const { data, error } = await request.order("name").limit(limit);
    check(error, "search products");
    return (data ?? []).map(product);
  }

  async getProduct(sku: string) {
    const { data, error } = await this.db.from("products").select("*").eq("sku", sku).maybeSingle();
    check(error, "product");
    return data ? product(data) : null;
  }

  async people() {
    const { data, error } = await this.db.from("ops_people").select("*").eq("active", true);
    check(error, "people");
    return (data ?? []).map((r: Row) => ({ slackUserId: s(r.slack_user_id)!, name: s(r.name) ?? "", roles: (r.roles as Role[]) ?? [], hub: s(r.hub) }));
  }

  async upsertPerson(person: Person) {
    const { error } = await this.db.from("ops_people").upsert({ slack_user_id: person.slackUserId, name: person.name, roles: person.roles, hub: person.hub, active: true, updated_at: new Date().toISOString() });
    check(error, "save person");
  }

  async insertOrder(input: NewOrderInput): Promise<OrderDetail> {
    if (input.slackChannelId && input.slackMessageTs) {
      const existing = await this.findOrderBySlack(input.slackChannelId, input.slackMessageTs);
      if (existing) return (await this.getOrder(existing.id))!;
    }
    const { lines, ...rest } = input;
    const row = snake({ ...rest, offeredTotalMinor: lines.reduce((sum, l) => sum + l.offeredPriceMinor, 0), stageChangedAt: rest.createdAt });
    const inserted = await this.db.from("orders").insert(row).select("id").single();
    check(inserted.error, "insert order");
    const id = s((inserted.data as Row).id)!;
    const lineRows = lines.map((l, i) => ({
      order_id: id,
      line_no: i + 1,
      sku: l.sku,
      product_name: l.productName,
      qty: l.qty ?? 1,
      list_price_minor: l.listPriceMinor,
      offered_price_minor: l.offeredPriceMinor,
      accessories: l.accessories ?? null,
      extended_warranty: l.extendedWarranty ?? null,
      installation: l.installation ?? null,
    }));
    const linesResult = await this.db.from("order_lines").insert(lineRows);
    if (linesResult.error) {
      await this.db.from("orders").delete().eq("id", id);
      check(linesResult.error, "insert lines");
    }
    return (await this.getOrder(id))!;
  }

  async getOrder(id: string): Promise<OrderDetail | null> {
    const [o, l, p, e, i, r] = await Promise.all([
      this.db.from("orders").select("*").eq("id", id).maybeSingle(),
      this.db.from("order_lines").select("*").eq("order_id", id).order("line_no"),
      this.db.from("payments").select("*").eq("order_id", id).order("created_at"),
      this.db.from("order_events").select("*").eq("order_id", id).order("created_at"),
      this.db.from("installations").select("*").eq("order_id", id),
      this.db.from("procurement_requests").select("*").eq("order_id", id).order("created_at"),
    ]);
    for (const [result, where] of [[o, "order"], [l, "lines"], [p, "payments"], [e, "events"], [i, "installations"], [r, "procurement"]] as const) check(result.error, where);
    if (!o.data) return null;
    return {
      ...order(o.data),
      lines: (l.data ?? []).map(line),
      payments: (p.data ?? []).map(payment),
      events: (e.data ?? []).map(event),
      installations: (i.data ?? []).map(install),
      procurement: (r.data ?? []).map(procurement),
    };
  }

  async findOrderBySlack(channelId: string, ts: string) {
    const { data, error } = await this.db.from("orders").select("*").eq("slack_channel_id", channelId).eq("slack_message_ts", ts).maybeSingle();
    check(error, "order by slack");
    return data ? order(data) : null;
  }

  async listOrders(filter: OrderFilter): Promise<{ items: OrderSummary[]; total: number }> {
    const wanted = filter.limit ?? 50;
    if (wanted > PAGE) {
      const items: OrderSummary[] = [];
      let total = 0;
      for (let offset = filter.offset ?? 0; items.length < wanted; offset += PAGE) {
        const page = await this.listOrders({ ...filter, offset, limit: Math.min(PAGE, wanted - items.length) });
        items.push(...page.items);
        total = page.total;
        if (page.items.length < PAGE) break;
      }
      return { items, total };
    }
    let request = this.db.from("orders").select("*, order_lines(*)", { count: "exact" });
    if (filter.stage === "open") request = request.in("stage", OPEN_STAGES);
    else if (filter.stage && filter.stage !== "all") request = request.eq("stage", filter.stage);
    if (filter.hub) request = request.eq("hub", filter.hub);
    if (filter.poc) request = request.ilike("poc", filter.poc);
    if (filter.from) request = request.gte("created_at", filter.from);
    if (filter.to) request = request.lt("created_at", filter.to);
    if (filter.deliveredFrom) request = request.gte("delivered_at", filter.deliveredFrom);
    const q = filter.q?.trim();
    if (q) {
      const skuHits = await this.db.from("order_lines").select("order_id").or(`sku.ilike.${like(q)},product_name.ilike.${like(q)}`).limit(500);
      check(skuHits.error, "search lines");
      const ids = [...new Set((skuHits.data ?? []).map((r: Row) => s(r.order_id)!))];
      const clauses = [`id.ilike.${like(q)}`, `customer_name.ilike.${like(q)}`, `phone.ilike.${like(q)}`, `shopify_order_id.ilike.${like(q)}`, `poc.ilike.${like(q)}`];
      if (ids.length) clauses.push(`id.in.(${ids.map((x) => `"${x}"`).join(",")})`);
      request = request.or(clauses.join(","));
    }
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 50;
    const { data, error, count } = await request.order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + limit - 1);
    check(error, "list orders");
    return {
      total: count ?? 0,
      items: (data ?? []).map((r: Row) => ({ ...order(r), lines: ((r.order_lines as Row[]) ?? []).map(line).sort((a, b) => a.lineNo - b.lineNo) })),
    };
  }

  async updateOrder(id: string, patch: Partial<Order>, expectStage?: OrderStage | OrderStage[]) {
    const rest: Partial<Order> = { ...patch };
    delete rest.id;
    delete rest.createdAt;
    delete rest.updatedAt;
    let request = this.db.from("orders").update(snake(rest)).eq("id", id);
    if (expectStage) request = Array.isArray(expectStage) ? request.in("stage", expectStage) : request.eq("stage", expectStage);
    const { data, error } = await request.select("id");
    check(error, "update order");
    return (data ?? []).length > 0;
  }

  async getLine(id: string) {
    const { data, error } = await this.db.from("order_lines").select("*").eq("id", id).maybeSingle();
    check(error, "line");
    return data ? line(data) : null;
  }

  async updateLine(id: string, patch: Partial<OrderLine>, expectStatus?: OrderLine["status"][]) {
    const rest: Partial<OrderLine> = { ...patch };
    delete rest.id;
    delete rest.orderId;
    let request = this.db.from("order_lines").update(snake(rest)).eq("id", id);
    if (expectStatus) request = request.in("status", expectStatus);
    const { data, error } = await request.select("id");
    check(error, "update line");
    return (data ?? []).length > 0;
  }

  async linesWaitingOnPo(poId: string) {
    const { data, error } = await this.db.from("order_lines").select("*").eq("po_id", poId).eq("status", "awaiting_po");
    check(error, "lines on po");
    return (data ?? []).map(line);
  }

  async insertPayment(input: Omit<Payment, "id" | "createdAt">) {
    const { data, error } = await this.db.from("payments").insert(snake(input)).select("*").single();
    check(error, "insert payment");
    return payment(data as Row);
  }

  async stockLevels(filter: StockFilter) {
    const make = () => {
      let request = this.db.from("stock_levels").select("*");
      const q = filter.q?.trim();
      if (q) request = request.or(`name.ilike.${like(q)},sku.ilike.${like(q)},brand.ilike.${like(q)}`);
      if (filter.only === "available") request = request.gt("available", 0);
      if (filter.only === "out") request = request.lte("available", 0);
      if (filter.only === "reserved") request = request.gt("reserved", 0);
      if (filter.only === "incoming") request = request.gt("incoming", 0);
      return request.order("on_hand", { ascending: false }).order("sku") as unknown as Ranged;
    };
    return (await readAll(make, filter.limit ?? 1000, "stock")).map(level);
  }

  async stockFor(sku: string) {
    const { data, error } = await this.db.from("stock_levels").select("*").eq("sku", sku).maybeSingle();
    check(error, "stock for sku");
    return data ? level(data) : null;
  }

  async reserveLine(lineId: string): Promise<ReserveResult> {
    const { data, error } = await this.db.rpc("ops_reserve_line", { target: lineId });
    check(error, "reserve");
    return data as ReserveResult;
  }

  async releaseReservation(lineId: string) {
    const { error } = await this.db.from("reservations").update({ status: "released", closed_at: new Date().toISOString() }).eq("order_line_id", lineId).eq("status", "active");
    check(error, "release");
  }

  async consumeReservation(lineId: string) {
    const { error } = await this.db.from("reservations").update({ status: "consumed", closed_at: new Date().toISOString() }).eq("order_line_id", lineId).eq("status", "active");
    check(error, "consume");
  }

  async addMovement(movement: Omit<StockMovement, "id" | "createdAt"> & { createdAt?: string }) {
    const { error } = await this.db.from("stock_movements").insert(snake(movement));
    check(error, "movement");
  }

  async addMovements(movements: Array<Omit<StockMovement, "id" | "createdAt"> & { createdAt?: string }>) {
    for (let i = 0; i < movements.length; i += 500) {
      const { error } = await this.db.from("stock_movements").insert(movements.slice(i, i + 500).map((m) => snake(m)));
      check(error, "movements");
    }
  }

  async hasMovements() {
    const { count, error } = await this.db.from("stock_movements").select("id", { count: "exact", head: true });
    check(error, "count movements");
    return (count ?? 0) > 0;
  }

  async listMovements(sku: string, limit: number) {
    const { data, error } = await this.db.from("stock_movements").select("*").eq("sku", sku).order("created_at", { ascending: false }).limit(limit);
    check(error, "movements");
    return (data ?? []).map((r: Row) => ({
      id: s(r.id)!,
      sku: s(r.sku)!,
      qty: n(r.qty),
      kind: s(r.kind) as StockMovement["kind"],
      refType: s(r.ref_type),
      refId: s(r.ref_id),
      serialNo: s(r.serial_no),
      unitCostMinor: nn(r.unit_cost_minor),
      note: s(r.note),
      actor: s(r.actor) ?? "",
      createdAt: s(r.created_at)!,
    }));
  }

  async upsertPurchaseOrder(input: Omit<PurchaseOrder, "id" | "createdAt"> & { createdAt?: string }) {
    const { data, error } = await this.db.from("purchase_orders").upsert(snake(input), { onConflict: "po_number,sku" }).select("*").single();
    check(error, "upsert purchase order");
    return po(data as Row);
  }

  async listPurchaseOrders(filter: PoFilter) {
    const make = () => {
      let request = this.db.from("purchase_orders").select("*");
      if (filter.status && filter.status !== "all") request = request.eq("status", filter.status);
      if (filter.sku) request = request.eq("sku", filter.sku);
      return request.order("eta", { ascending: true, nullsFirst: false }).order("id") as unknown as Ranged;
    };
    return (await readAll(make, 20_000, "purchase orders")).map(po);
  }

  async getPurchaseOrder(id: string) {
    const { data, error } = await this.db.from("purchase_orders").select("*").eq("id", id).maybeSingle();
    check(error, "purchase order");
    return data ? po(data) : null;
  }

  async updatePurchaseOrder(id: string, patch: Partial<PurchaseOrder>, expectReceived?: number) {
    let request = this.db.from("purchase_orders").update(snake(patch)).eq("id", id);
    if (expectReceived !== undefined) request = request.eq("qty_received", expectReceived);
    const { data, error } = await request.select("id");
    check(error, "update purchase order");
    return (data ?? []).length > 0;
  }

  async insertProcurement(request: Omit<ProcurementRequest, "id" | "createdAt" | "updatedAt">) {
    const { data, error } = await this.db.from("procurement_requests").insert(snake(request)).select("*").single();
    check(error, "insert procurement");
    return procurement(data as Row);
  }

  async getProcurement(id: string) {
    const { data, error } = await this.db.from("procurement_requests").select("*").eq("id", id).maybeSingle();
    check(error, "procurement");
    return data ? procurement(data) : null;
  }

  async updateProcurement(id: string, patch: Partial<ProcurementRequest>, expectStatus?: ProcurementRequest["status"][]) {
    let request = this.db.from("procurement_requests").update(snake(patch)).eq("id", id);
    if (expectStatus) request = request.in("status", expectStatus);
    const { data, error } = await request.select("id");
    check(error, "update procurement");
    return (data ?? []).length > 0;
  }

  async listProcurement(filter: ProcurementFilter) {
    let request = this.db.from("procurement_requests").select("*");
    if (filter.status === "open") request = request.in("status", ["requested", "ordered"]);
    else if (filter.status && filter.status !== "all") request = request.eq("status", filter.status);
    const { data, error } = await request.order("eta", { ascending: true, nullsFirst: false }).limit(500);
    check(error, "list procurement");
    return (data ?? []).map(procurement);
  }

  async insertInstallation(item: Omit<Installation, "id">) {
    const { data, error } = await this.db.from("installations").upsert(snake(item), { onConflict: "line_id", ignoreDuplicates: false }).select("*").single();
    check(error, "insert installation");
    return install(data as Row);
  }

  async updateInstallation(id: string, patch: Partial<Installation>) {
    const { data, error } = await this.db.from("installations").update(snake(patch)).eq("id", id).select("id");
    check(error, "update installation");
    return (data ?? []).length > 0;
  }

  async listInstallations(filter: InstallFilter) {
    const make = () => {
      let request = this.db.from("installations").select("*");
      if (filter.status && filter.status !== "all") request = request.eq("status", filter.status);
      return request.order("due_date").order("id") as unknown as Ranged;
    };
    return (await readAll(make, 20_000, "installations")).map(install);
  }

  async appendEvent(input: Omit<OrderEvent, "id" | "createdAt">) {
    const { error } = await this.db.from("order_events").insert(snake(input));
    check(error, "event");
  }

  async recentEvents(limit: number) {
    const { data, error } = await this.db.from("order_events").select("*").order("created_at", { ascending: false }).limit(limit);
    check(error, "recent events");
    return (data ?? []).map(event);
  }

  async releaseAction(key: string) {
    const { error } = await this.db.from("action_claims").delete().eq("key", key);
    check(error, "release claim");
  }

  async claimAction(key: string) {
    const { error } = await this.db.from("action_claims").insert({ key });
    if (error?.code === "23505") return false;
    check(error, "claim");
    return true;
  }

  async metrics(now: Date) {
    const since = new Date(istDayBounds(now).start.getTime() - 13 * 24 * 60 * 60 * 1000).toISOString();
    const bounds = istDayBounds(now);
    const [recent, open, delivered, paid, stock, proc, installs] = await Promise.all([
      this.listOrders({ stage: "all", from: since, limit: 5000 }),
      this.listOrders({ stage: "open", limit: 5000 }),
      // Older orders delivered inside the window still count as delivered that day.
      this.listOrders({ stage: "all", deliveredFrom: since, limit: 5000 }),
      this.db.from("payments").select("amount_minor").eq("status", "verified").gte("created_at", bounds.start.toISOString()).lt("created_at", bounds.end.toISOString()),
      this.stockLevels({ only: "all", limit: 5000 }),
      this.listProcurement({ status: "open" }),
      this.listInstallations({ status: "pending" }),
    ]);
    check(paid.error, "payments today");
    const merged = new Map<string, (typeof recent.items)[number]>();
    for (const o of [...recent.items, ...open.items, ...delivered.items]) merged.set(o.id, o);
    return computeMetrics({
      now,
      orders: [...merged.values()],
      verifiedTodayMinor: (paid.data ?? []).reduce((sum: number, r: Row) => sum + n(r.amount_minor), 0),
      stock,
      procurement: proc,
      installations: installs,
    });
  }
}

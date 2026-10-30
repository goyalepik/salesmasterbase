import { randomUUID } from "node:crypto";
import { istDayBounds } from "@/lib/format";
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
  type Payment,
  type Person,
  type ProcurementRequest,
  type Product,
  type PurchaseOrder,
  type ReserveResult,
  type StockLevel,
  type StockMovement,
} from "@/lib/ops/types";

type Reservation = { lineId: string; sku: string; qty: number; status: "active" | "consumed" | "released" };

export type OpsSnapshot = {
  products: Product[];
  movements: Array<Omit<StockMovement, "id"> & { id?: string }>;
  purchaseOrders: PurchaseOrder[];
  orders?: Array<NewOrderInput & { id?: string; patch?: Partial<Order>; lineStatus?: OrderLine["status"] }>;
  people?: Person[];
};

function norm(value: string | null | undefined): string {
  return (value ?? "").toLowerCase();
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryOpsStore implements OpsStore {
  readonly kind = "memory" as const;
  private products = new Map<string, Product>();
  private orders = new Map<string, Order>();
  private lines = new Map<string, OrderLine>();
  private payments: Payment[] = [];
  private movements: StockMovement[] = [];
  private reservations: Reservation[] = [];
  private pos = new Map<string, PurchaseOrder>();
  private procurement = new Map<string, ProcurementRequest>();
  private installs = new Map<string, Installation>();
  private events: OrderEvent[] = [];
  private claims = new Set<string>();
  private persons = new Map<string, Person>();
  private seq = 0;
  private eventSeq = 0;

  constructor(snapshot?: OpsSnapshot) {
    if (!snapshot) return;
    for (const product of snapshot.products) this.products.set(product.sku, product);
    snapshot.movements.forEach((movement, index) => this.movements.push({ ...movement, id: movement.id ?? `m${index}` }));
    for (const po of snapshot.purchaseOrders) this.pos.set(po.id, po);
    for (const person of snapshot.people ?? []) this.persons.set(person.slackUserId, person);
  }

  /** Load imported orders after construction so ids and reservations follow normal rules. */
  async loadOrders(orders: NonNullable<OpsSnapshot["orders"]>): Promise<void> {
    for (const input of orders) {
      const detail = await this.insertOrder(input, input.id);
      if (input.patch) await this.updateOrder(detail.id, input.patch);
      if (input.lineStatus) {
        for (const line of detail.lines) {
          if (input.lineStatus === "reserved" && line.sku) {
            const result = await this.reserveLine(line.id);
            if (result !== "ok") await this.updateLine(line.id, { status: "pending" });
          } else {
            await this.updateLine(line.id, { status: input.lineStatus });
          }
        }
      }
    }
  }

  async upsertProducts(products: Product[]) {
    for (const product of products) this.products.set(product.sku, product);
  }

  async searchProducts(q: string, limit: number): Promise<Product[]> {
    const terms = norm(q).split(/\s+/).filter(Boolean);
    const all = [...this.products.values()];
    if (!terms.length) return all.slice(0, limit);
    const scored = all
      .map((product) => {
        const hay = `${norm(product.sku)} ${norm(product.name)} ${norm(product.brand)}`;
        if (!terms.every((term) => hay.includes(term))) return null;
        const score = (norm(product.sku) === norm(q) ? 100 : 0) + (norm(product.name).startsWith(terms[0]) ? 10 : 0) - product.name.length / 100;
        return { product, score };
      })
      .filter((item): item is { product: Product; score: number } => item !== null)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((item) => item.product);
  }

  async getProduct(sku: string) {
    return this.products.get(sku) ?? null;
  }

  async people() {
    return [...this.persons.values()];
  }

  async upsertPerson(person: Person) {
    this.persons.set(person.slackUserId, person);
  }

  async insertOrder(input: NewOrderInput, forcedId?: string): Promise<OrderDetail> {
    if (input.slackChannelId && input.slackMessageTs) {
      const existing = await this.findOrderBySlack(input.slackChannelId, input.slackMessageTs);
      if (existing) return (await this.getOrder(existing.id))!;
    }
    this.seq += 1;
    const id = forcedId ?? `EPK-${String(this.seq).padStart(6, "0")}`;
    const now = input.createdAt ?? new Date().toISOString();
    const order: Order = {
      id,
      createdAt: now,
      updatedAt: now,
      source: input.source,
      stage: input.stage ?? "awaiting_payment",
      stageChangedAt: now,
      customerName: input.customerName,
      phone: input.phone,
      email: input.email ?? null,
      shippingAddress: input.shippingAddress ?? null,
      pincode: input.pincode ?? null,
      billingAddress: input.billingAddress ?? null,
      gst: input.gst ?? null,
      hub: input.hub,
      cxType: input.cxType ?? null,
      poc: input.poc,
      saleSource: input.saleSource ?? null,
      saleType: input.saleType ?? null,
      declaredPaymentStatus: input.declaredPaymentStatus ?? null,
      declaredPaymentMode: input.declaredPaymentMode ?? null,
      notes: input.notes ?? null,
      shopifyOrderId: input.shopifyOrderId ?? null,
      slackChannelId: input.slackChannelId ?? null,
      slackMessageTs: input.slackMessageTs ?? null,
      createdBy: input.createdBy ?? null,
      offeredTotalMinor: input.lines.reduce((sum, line) => sum + line.offeredPriceMinor, 0),
      paidMinor: 0,
      codDueMinor: 0,
      driver: null,
      expectedDeliveryDate: null,
      dispatchedAt: null,
      deliveredAt: null,
      holdReason: null,
      cancelReason: null,
    };
    this.orders.set(id, order);
    input.lines.forEach((line, index) => {
      const lineId = randomUUID();
      this.lines.set(lineId, {
        id: lineId,
        orderId: id,
        lineNo: index + 1,
        sku: line.sku,
        productName: line.productName,
        qty: line.qty ?? 1,
        listPriceMinor: line.listPriceMinor,
        offeredPriceMinor: line.offeredPriceMinor,
        accessories: line.accessories ?? null,
        extendedWarranty: line.extendedWarranty ?? null,
        installation: line.installation ?? null,
        status: "pending",
        poId: null,
        procurementId: null,
        serialNo: null,
        rejectReason: null,
      });
    });
    return (await this.getOrder(id))!;
  }

  private linesOf(orderId: string): OrderLine[] {
    return [...this.lines.values()].filter((line) => line.orderId === orderId).sort((a, b) => a.lineNo - b.lineNo);
  }

  async getOrder(id: string): Promise<OrderDetail | null> {
    const order = this.orders.get(id);
    if (!order) return null;
    return clone({
      ...order,
      lines: this.linesOf(id),
      payments: this.payments.filter((p) => p.orderId === id),
      events: this.events.filter((e) => e.orderId === id),
      installations: [...this.installs.values()].filter((i) => i.orderId === id),
      procurement: [...this.procurement.values()].filter((r) => r.orderId === id),
    });
  }

  async findOrderBySlack(channelId: string, ts: string) {
    for (const order of this.orders.values()) {
      if (order.slackChannelId === channelId && order.slackMessageTs === ts) return clone(order);
    }
    return null;
  }

  async listOrders(filter: OrderFilter) {
    const q = norm(filter.q).trim();
    const matches = [...this.orders.values()].filter((order) => {
      if (filter.stage === "open" && !OPEN_STAGES.includes(order.stage)) return false;
      if (filter.stage && filter.stage !== "open" && filter.stage !== "all" && order.stage !== filter.stage) return false;
      if (filter.hub && order.hub !== filter.hub) return false;
      if (filter.poc && norm(order.poc) !== norm(filter.poc)) return false;
      if (filter.from && order.createdAt < filter.from) return false;
      if (filter.to && order.createdAt >= filter.to) return false;
      if (q) {
        const lines = this.linesOf(order.id);
        const hay = [order.id, order.customerName, order.phone, order.shopifyOrderId, order.poc, ...lines.map((l) => `${l.sku} ${l.productName}`)].map(norm).join(" ");
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    matches.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 50;
    return {
      total: matches.length,
      items: matches.slice(offset, offset + limit).map((order) => clone({ ...order, lines: this.linesOf(order.id) })),
    };
  }

  async updateOrder(id: string, patch: Partial<Order>, expectStage?: OrderStage | OrderStage[]) {
    const order = this.orders.get(id);
    if (!order) return false;
    if (expectStage) {
      const allowed = Array.isArray(expectStage) ? expectStage : [expectStage];
      if (!allowed.includes(order.stage)) return false;
    }
    const at = new Date().toISOString();
    const moved = patch.stage && patch.stage !== order.stage;
    Object.assign(order, patch, { updatedAt: at }, moved && !patch.stageChangedAt ? { stageChangedAt: at } : {});
    return true;
  }

  async getLine(id: string) {
    const line = this.lines.get(id);
    return line ? clone(line) : null;
  }

  async updateLine(id: string, patch: Partial<OrderLine>, expectStatus?: OrderLine["status"][]) {
    const line = this.lines.get(id);
    if (!line) return false;
    if (expectStatus && !expectStatus.includes(line.status)) return false;
    Object.assign(line, patch);
    return true;
  }

  async linesWaitingOnPo(poId: string) {
    return [...this.lines.values()].filter((line) => line.poId === poId && line.status === "awaiting_po").map(clone);
  }

  async insertPayment(payment: Omit<Payment, "id" | "createdAt">) {
    const saved = { ...payment, id: randomUUID(), createdAt: new Date().toISOString() };
    this.payments.push(saved);
    return clone(saved);
  }

  private level(sku: string): StockLevel | null {
    const product = this.products.get(sku);
    if (!product) return null;
    let onHand = 0;
    let unitCostMinor: number | null = null;
    let touched = false;
    for (const m of this.movements) {
      if (m.sku !== sku) continue;
      touched = true;
      onHand += m.qty;
      if (m.unitCostMinor != null) unitCostMinor = m.unitCostMinor;
    }
    const reserved = this.reservations.filter((r) => r.sku === sku && r.status === "active").reduce((s, r) => s + r.qty, 0);
    let incoming = 0;
    let nextEta: string | null = null;
    for (const po of this.pos.values()) {
      if (po.sku !== sku || po.status !== "open" || po.qtyOrdered <= po.qtyReceived) continue;
      incoming += po.qtyOrdered - po.qtyReceived;
      if (po.eta && (!nextEta || po.eta < nextEta)) nextEta = po.eta;
    }
    if (!touched && !reserved && !incoming) return null;
    return {
      sku,
      name: product.name,
      brand: product.brand,
      category: product.category,
      channel: product.channel,
      onHand,
      reserved,
      available: onHand - reserved,
      incoming,
      nextEta,
      unitCostMinor,
    };
  }

  async stockLevels(filter: StockFilter) {
    const skus = new Set<string>([...this.movements.map((m) => m.sku), ...this.reservations.map((r) => r.sku), ...[...this.pos.values()].map((p) => p.sku)]);
    const q = norm(filter.q).trim();
    const rows = [...skus]
      .map((sku) => this.level(sku))
      .filter((row): row is StockLevel => row !== null)
      .filter((row) => !q || `${norm(row.sku)} ${norm(row.name)} ${norm(row.brand)}`.includes(q))
      .filter((row) => {
        if (filter.only === "available") return row.available > 0;
        if (filter.only === "out") return row.available <= 0;
        if (filter.only === "reserved") return row.reserved > 0;
        if (filter.only === "incoming") return row.incoming > 0;
        return true;
      })
      .sort((a, b) => b.onHand - a.onHand || a.name.localeCompare(b.name));
    return rows.slice(0, filter.limit ?? 1000);
  }

  async stockFor(sku: string) {
    return this.level(sku);
  }

  async reserveLine(lineId: string): Promise<ReserveResult> {
    const line = this.lines.get(lineId);
    if (!line) return "missing";
    if (!line.sku) return "no_sku";
    if (this.reservations.some((r) => r.lineId === lineId && r.status === "active")) return "already";
    const level = this.level(line.sku);
    if (!level || level.available < line.qty) return "insufficient";
    this.reservations.push({ lineId, sku: line.sku, qty: line.qty, status: "active" });
    line.status = "reserved";
    line.poId = null;
    return "ok";
  }

  async releaseReservation(lineId: string) {
    for (const r of this.reservations) if (r.lineId === lineId && r.status === "active") r.status = "released";
  }

  async consumeReservation(lineId: string) {
    for (const r of this.reservations) if (r.lineId === lineId && r.status === "active") r.status = "consumed";
  }

  async addMovement(movement: Omit<StockMovement, "id" | "createdAt"> & { createdAt?: string }) {
    this.movements.push({ ...movement, id: randomUUID(), createdAt: movement.createdAt ?? new Date().toISOString() });
  }

  async addMovements(movements: Array<Omit<StockMovement, "id" | "createdAt"> & { createdAt?: string }>) {
    for (const movement of movements) await this.addMovement(movement);
  }

  async hasMovements() {
    return this.movements.length > 0;
  }

  async listMovements(sku: string, limit: number) {
    return this.movements.filter((m) => m.sku === sku).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map(clone);
  }

  async upsertPurchaseOrder(input: Omit<PurchaseOrder, "id" | "createdAt"> & { createdAt?: string }) {
    const existing = [...this.pos.values()].find((po) => po.poNumber === input.poNumber && po.sku === input.sku);
    const saved: PurchaseOrder = { ...input, id: existing?.id ?? randomUUID(), createdAt: input.createdAt ?? existing?.createdAt ?? new Date().toISOString() };
    this.pos.set(saved.id, saved);
    return clone(saved);
  }

  async listPurchaseOrders(filter: PoFilter) {
    return [...this.pos.values()]
      .filter((po) => (filter.status && filter.status !== "all" ? po.status === filter.status : true))
      .filter((po) => (filter.sku ? po.sku === filter.sku : true))
      .sort((a, b) => (a.eta ?? "9999").localeCompare(b.eta ?? "9999"))
      .map(clone);
  }

  async getPurchaseOrder(id: string) {
    const po = this.pos.get(id);
    return po ? clone(po) : null;
  }

  async updatePurchaseOrder(id: string, patch: Partial<PurchaseOrder>) {
    const po = this.pos.get(id);
    if (po) Object.assign(po, patch);
  }

  async insertProcurement(request: Omit<ProcurementRequest, "id" | "createdAt" | "updatedAt">) {
    const now = new Date().toISOString();
    const saved = { ...request, id: randomUUID(), createdAt: now, updatedAt: now };
    this.procurement.set(saved.id, saved);
    return clone(saved);
  }

  async getProcurement(id: string) {
    const item = this.procurement.get(id);
    return item ? clone(item) : null;
  }

  async updateProcurement(id: string, patch: Partial<ProcurementRequest>, expectStatus?: ProcurementRequest["status"][]) {
    const item = this.procurement.get(id);
    if (!item) return false;
    if (expectStatus && !expectStatus.includes(item.status)) return false;
    Object.assign(item, patch, { updatedAt: new Date().toISOString() });
    return true;
  }

  async listProcurement(filter: ProcurementFilter) {
    return [...this.procurement.values()]
      .filter((r) => {
        if (!filter.status || filter.status === "all") return true;
        if (filter.status === "open") return r.status === "requested" || r.status === "ordered";
        return r.status === filter.status;
      })
      .sort((a, b) => (a.eta ?? "9999").localeCompare(b.eta ?? "9999"))
      .map(clone);
  }

  async insertInstallation(item: Omit<Installation, "id">) {
    const existing = [...this.installs.values()].find((i) => i.lineId === item.lineId);
    if (existing) return clone(existing);
    const saved = { ...item, id: randomUUID() };
    this.installs.set(saved.id, saved);
    return clone(saved);
  }

  async updateInstallation(id: string, patch: Partial<Installation>) {
    const item = this.installs.get(id);
    if (!item) return false;
    Object.assign(item, patch);
    return true;
  }

  async listInstallations(filter: InstallFilter) {
    return [...this.installs.values()]
      .filter((i) => (filter.status && filter.status !== "all" ? i.status === filter.status : true))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .map(clone);
  }

  async appendEvent(event: Omit<OrderEvent, "id" | "createdAt">) {
    this.eventSeq += 1;
    this.events.push({ ...event, id: String(this.eventSeq), createdAt: new Date().toISOString() });
  }

  async recentEvents(limit: number) {
    return [...this.events].reverse().slice(0, limit).map(clone);
  }

  async claimAction(key: string) {
    if (this.claims.has(key)) return false;
    this.claims.add(key);
    return true;
  }

  async releaseAction(key: string) {
    this.claims.delete(key);
  }

  async metrics(now: Date) {
    const orders = (await this.listOrders({ stage: "all", limit: 100_000 })).items;
    const bounds = istDayBounds(now);
    const verifiedTodayMinor = this.payments
      .filter((p) => p.status === "verified" && p.createdAt >= bounds.start.toISOString() && p.createdAt < bounds.end.toISOString())
      .reduce((sum, p) => sum + p.amountMinor, 0);
    return computeMetrics({
      now,
      orders,
      verifiedTodayMinor,
      stock: await this.stockLevels({ only: "all", limit: 100_000 }),
      procurement: [...this.procurement.values()],
      installations: [...this.installs.values()],
    });
  }
}

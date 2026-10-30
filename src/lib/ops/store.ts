import type {
  Installation,
  NewOrderInput,
  OpsMetrics,
  Order,
  OrderDetail,
  OrderEvent,
  OrderFilter,
  OrderLine,
  OrderStage,
  OrderSummary,
  Payment,
  Person,
  ProcurementRequest,
  Product,
  PurchaseOrder,
  ReserveResult,
  StockLevel,
  StockMovement,
} from "@/lib/ops/types";

export type StockFilter = { q?: string; only?: "available" | "out" | "reserved" | "incoming" | "all"; limit?: number };
export type ProcurementFilter = { status?: ProcurementRequest["status"] | "open" | "all" };
export type PoFilter = { status?: PurchaseOrder["status"] | "all"; sku?: string };
export type InstallFilter = { status?: Installation["status"] | "all" };

/**
 * Storage for the operations model. The service layer (`service.ts`) holds the rules;
 * a store only reads and writes. Two implementations: memory (demo, tests) and Supabase (live).
 */
export interface OpsStore {
  readonly kind: "memory" | "supabase";

  // Catalogue and people
  upsertProducts(products: Product[]): Promise<void>;
  searchProducts(q: string, limit: number): Promise<Product[]>;
  getProduct(sku: string): Promise<Product | null>;
  people(): Promise<Person[]>;
  upsertPerson(person: Person): Promise<void>;

  // Orders
  insertOrder(input: NewOrderInput): Promise<OrderDetail>;
  getOrder(id: string): Promise<OrderDetail | null>;
  findOrderBySlack(channelId: string, ts: string): Promise<Order | null>;
  listOrders(filter: OrderFilter): Promise<{ items: OrderSummary[]; total: number }>;
  /** Conditional update. Returns false when `expectStage` is given and does not match. */
  updateOrder(id: string, patch: Partial<Order>, expectStage?: OrderStage | OrderStage[]): Promise<boolean>;
  getLine(id: string): Promise<OrderLine | null>;
  updateLine(id: string, patch: Partial<OrderLine>, expectStatus?: OrderLine["status"][]): Promise<boolean>;
  linesWaitingOnPo(poId: string): Promise<OrderLine[]>;

  // Money
  insertPayment(payment: Omit<Payment, "id" | "createdAt">): Promise<Payment>;

  // Stock
  stockLevels(filter: StockFilter): Promise<StockLevel[]>;
  stockFor(sku: string): Promise<StockLevel | null>;
  reserveLine(lineId: string): Promise<ReserveResult>;
  releaseReservation(lineId: string): Promise<void>;
  consumeReservation(lineId: string): Promise<void>;
  addMovement(movement: Omit<StockMovement, "id" | "createdAt"> & { createdAt?: string }): Promise<void>;
  addMovements(movements: Array<Omit<StockMovement, "id" | "createdAt"> & { createdAt?: string }>): Promise<void>;
  hasMovements(): Promise<boolean>;
  listMovements(sku: string, limit: number): Promise<StockMovement[]>;

  // Purchase orders and procurement
  upsertPurchaseOrder(po: Omit<PurchaseOrder, "id" | "createdAt"> & { createdAt?: string }): Promise<PurchaseOrder>;
  listPurchaseOrders(filter: PoFilter): Promise<PurchaseOrder[]>;
  getPurchaseOrder(id: string): Promise<PurchaseOrder | null>;
  updatePurchaseOrder(id: string, patch: Partial<PurchaseOrder>): Promise<void>;
  insertProcurement(request: Omit<ProcurementRequest, "id" | "createdAt" | "updatedAt">): Promise<ProcurementRequest>;
  getProcurement(id: string): Promise<ProcurementRequest | null>;
  updateProcurement(id: string, patch: Partial<ProcurementRequest>, expectStatus?: ProcurementRequest["status"][]): Promise<boolean>;
  listProcurement(filter: ProcurementFilter): Promise<ProcurementRequest[]>;

  // Installation
  insertInstallation(item: Omit<Installation, "id">): Promise<Installation>;
  updateInstallation(id: string, patch: Partial<Installation>): Promise<boolean>;
  listInstallations(filter: InstallFilter): Promise<Installation[]>;

  // History and safety
  appendEvent(event: Omit<OrderEvent, "id" | "createdAt">): Promise<void>;
  recentEvents(limit: number): Promise<OrderEvent[]>;
  claimAction(key: string): Promise<boolean>;
  /** Frees a claim when the action was refused, so the same input can be tried again. */
  releaseAction(key: string): Promise<void>;

  metrics(now: Date): Promise<OpsMetrics>;
}

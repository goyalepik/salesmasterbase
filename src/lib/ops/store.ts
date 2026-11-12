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
  ShopifyCatalogItem,
  CatalogResult,
  WebSale,
  InventoryNote,
  NewWebSale,
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
  /** `shopifyOnly`: only products in the Shopify catalogue, website (ACTIVE) ones first. */
  searchProducts(q: string, limit: number, opts?: { shopifyOnly?: boolean }): Promise<Product[]>;
  /** Every active product in the Shopify catalogue (about 3,000), for the Slack picker's in-memory copy. */
  shopifyProducts(): Promise<Product[]>;
  /**
   * Copies the Shopify catalogue into the product list: Shopify's name and price for every SKU it has, new SKUs
   * added, and the Shopify mark taken off products no longer in Shopify. Stock, installation and other fields stay.
   */
  applyShopifyCatalog(items: ShopifyCatalogItem[]): Promise<CatalogResult>;
  getProduct(sku: string): Promise<Product | null>;
  people(): Promise<Person[]>;
  upsertPerson(person: Person): Promise<void>;

  // Orders
  insertOrder(input: NewOrderInput): Promise<OrderDetail>;
  getOrder(id: string): Promise<OrderDetail | null>;
  findOrderBySlack(channelId: string, ts: string): Promise<Order | null>;
  /** Website sales (Slack short form). */
  insertWebSale(input: NewWebSale): Promise<WebSale>;
  /** Unmatched website sales for this 10-digit phone, created between the two times, newest first. */
  openWebSales(phone: string, fromIso: string, toIso: string): Promise<WebSale[]>;
  /** Links a website sale to its order. False when it was already linked. */
  markWebSaleMatched(id: string, orderId: string): Promise<boolean>;
  /** The order linked to a Shopify order number (#PIK…), if any. */
  findOrderByShopify(shopifyOrderId: string): Promise<Order | null>;
  listOrders(filter: OrderFilter): Promise<{ items: OrderSummary[]; total: number }>;
  /** IDs of orders whose payments or CDE payment line use this UTR or reference. */
  ordersUsingReference(reference: string): Promise<string[]>;
  /** Removes an order with its lines, payments, reservations, events and the rest. Only for test orders. */
  deleteOrder(id: string): Promise<void>;
  /** Removes website-order forms whose customer name starts with TEST. Returns how many. */
  deleteTestWebSales(): Promise<number>;
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
  /** Movements of these kinds since a time, oldest first (for the sheet sync). */
  movementsSince(fromIso: string, kinds: StockMovement["kind"][], limit: number): Promise<StockMovement[]>;
  /** Whether this serial number already has a movement of this kind (e.g. it was already dispatched). */
  serialHasMovement(serialNo: string, kind: StockMovement["kind"]): Promise<boolean>;
  /** Which of these serial numbers are in stock right now (came in and have not left). */
  serialsInStock(serials: string[]): Promise<Set<string>>;

  // Purchase orders and procurement
  upsertPurchaseOrder(po: Omit<PurchaseOrder, "id" | "createdAt"> & { createdAt?: string }): Promise<PurchaseOrder>;
  listPurchaseOrders(filter: PoFilter): Promise<PurchaseOrder[]>;
  getPurchaseOrder(id: string): Promise<PurchaseOrder | null>;
  /** With `expectReceived`, only updates when the received count is still that number (stops a double receipt). */
  updatePurchaseOrder(id: string, patch: Partial<PurchaseOrder>, expectReceived?: number): Promise<boolean>;
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
  /** When the newest claim starting with this prefix was taken (for "Shopify checked 3 min ago"), or null. */
  lastClaimAt(prefix: string): Promise<string | null>;
  /** The newest claim key starting with this prefix (the sheet sync stores its summary in it), or null. */
  lastClaimKey(prefix: string): Promise<string | null>;
  /** Every claim key starting with this prefix (rows the sheet sync already applied). */
  claimsWithPrefix(prefix: string): Promise<Set<string>>;

  // Inventory notes
  /** Open notes first (newest first), then up to `limit` done ones. */
  listInventoryNotes(limit: number): Promise<InventoryNote[]>;
  addInventoryNote(note: { body: string; author: string }): Promise<InventoryNote>;
  /** Ticks a note done (or open again). False when it does not exist. */
  setInventoryNoteDone(id: string, done: boolean, by: string): Promise<boolean>;

  metrics(now: Date): Promise<OpsMetrics>;
}

// Operations model: one order moves Sale → RevOps → Inventory → Logistics → Installation.
// Money is stored in paise (minor units). Times are ISO strings in UTC; the UI shows IST.

export const ROLES = ["sales", "revops", "inventory", "procurement", "logistics", "installation", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const ORDER_STAGES = [
  "awaiting_payment",
  "awaiting_inventory",
  "awaiting_stock",
  "ready_to_dispatch",
  "out_for_delivery",
  "delivered",
  "on_hold",
  "cancelled",
] as const;
export type OrderStage = (typeof ORDER_STAGES)[number];

export const STAGE_LABELS: Record<OrderStage, string> = {
  awaiting_payment: "Payment check",
  awaiting_inventory: "Inventory check",
  awaiting_stock: "Waiting for stock",
  ready_to_dispatch: "Ready to dispatch",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  on_hold: "On hold",
  cancelled: "Cancelled",
};

/** The codes the logistics team already uses in the dispatch sheet. */
export const STAGE_SHEET_CODES: Partial<Record<OrderStage, string>> = {
  ready_to_dispatch: "CONFIRMED",
  out_for_delivery: "EPIK_OFD",
  delivered: "EPIK_DELIVERED",
  cancelled: "EPIK_CANCELLED",
};

/** Which team owns the next step at each stage. */
export const STAGE_OWNER: Record<OrderStage, Role | null> = {
  awaiting_payment: "revops",
  awaiting_inventory: "inventory",
  awaiting_stock: "procurement",
  ready_to_dispatch: "logistics",
  out_for_delivery: "logistics",
  delivered: null,
  on_hold: "sales",
  cancelled: null,
};

export const OPEN_STAGES: OrderStage[] = [
  "awaiting_payment",
  "awaiting_inventory",
  "awaiting_stock",
  "ready_to_dispatch",
  "out_for_delivery",
  "on_hold",
];

export const LINE_STATUSES = ["pending", "reserved", "awaiting_po", "procuring", "brand_direct", "rejected", "dispatched", "cancelled"] as const;
export type LineStatus = (typeof LINE_STATUSES)[number];

export const LINE_LABELS: Record<LineStatus, string> = {
  pending: "Needs decision",
  reserved: "Reserved",
  awaiting_po: "Held on PO",
  procuring: "Procuring",
  brand_direct: "Brand ships direct",
  rejected: "Rejected",
  dispatched: "Dispatched",
  cancelled: "Cancelled",
};

export const PAYMENT_MODES = ["Cash", "UPI", "Card", "NEFT", "Snapmint", "Bajaj", "Other"] as const;
export const PAYMENT_KINDS = ["advance", "full", "balance", "cod", "finance"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export const HUBS = ["Hebbal", "HQ", "HSR HQ", "Jayanagar", "Kengeri", "Mahadevpura"] as const;

export type Product = {
  sku: string;
  name: string;
  brand: string | null;
  category: string | null;
  channel: "SOR" | "CnC" | null;
  listPriceMinor: number | null;
  gstRate: number | null;
  hsn: string | null;
  eol: boolean;
  needsInstallation: boolean;
};

export type OrderLine = {
  id: string;
  orderId: string;
  lineNo: number;
  sku: string | null;
  productName: string;
  qty: number;
  listPriceMinor: number | null;
  offeredPriceMinor: number;
  accessories: string | null;
  extendedWarranty: string | null;
  installation: string | null;
  status: LineStatus;
  poId: string | null;
  procurementId: string | null;
  serialNo: string | null;
  rejectReason: string | null;
};

export type Payment = {
  id: string;
  orderId: string;
  amountMinor: number;
  mode: string;
  kind: PaymentKind;
  reference: string | null;
  status: "verified" | "rejected";
  recordedBy: string;
  createdAt: string;
};

export type Order = {
  id: string;
  createdAt: string;
  updatedAt: string;
  source: "slack" | "desk" | "import";
  stage: OrderStage;
  /** When the order reached its current stage. "Stuck" is measured from here. */
  stageChangedAt: string;
  customerName: string;
  phone: string | null;
  email: string | null;
  shippingAddress: string | null;
  pincode: string | null;
  billingAddress: string | null;
  gst: string | null;
  hub: string | null;
  cxType: string | null;
  poc: string | null;
  saleSource: string | null;
  saleType: string | null;
  declaredPaymentStatus: string | null;
  declaredPaymentMode: string | null;
  notes: string | null;
  shopifyOrderId: string | null;
  slackChannelId: string | null;
  slackMessageTs: string | null;
  createdBy: string | null;
  offeredTotalMinor: number;
  paidMinor: number;
  codDueMinor: number;
  driver: string | null;
  expectedDeliveryDate: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  holdReason: string | null;
  cancelReason: string | null;
};

export type OrderEvent = {
  id: string;
  orderId: string;
  lineId: string | null;
  type: string;
  actor: string;
  summary: string;
  createdAt: string;
};

export type Installation = {
  id: string;
  orderId: string;
  lineId: string;
  sku: string | null;
  productName: string;
  customerName: string;
  phone: string | null;
  address: string | null;
  status: "pending" | "done" | "not_required";
  dueDate: string;
  doneAt: string | null;
  technician: string | null;
  note: string | null;
};

export type PurchaseOrder = {
  id: string;
  poNumber: string;
  vendor: string | null;
  sku: string;
  productName: string | null;
  qtyOrdered: number;
  qtyReceived: number;
  eta: string | null;
  status: "open" | "closed" | "cancelled";
  createdAt: string;
};

export type ProcurementRequest = {
  id: string;
  orderId: string;
  lineId: string;
  sku: string | null;
  productName: string;
  vendor: string;
  costMinor: number | null;
  eta: string | null;
  status: "requested" | "ordered" | "received" | "cancelled";
  poNumber: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StockMovementKind = "opening" | "inward" | "dispatch" | "return" | "rtv" | "adjust";

export type StockMovement = {
  id: string;
  sku: string;
  qty: number;
  kind: StockMovementKind;
  refType: string | null;
  refId: string | null;
  serialNo: string | null;
  unitCostMinor: number | null;
  note: string | null;
  actor: string;
  createdAt: string;
};

export type StockLevel = {
  sku: string;
  name: string;
  brand: string | null;
  category: string | null;
  channel: "SOR" | "CnC" | null;
  onHand: number;
  reserved: number;
  available: number;
  incoming: number;
  nextEta: string | null;
  unitCostMinor: number | null;
};

export type Person = { slackUserId: string; name: string; roles: Role[]; hub: string | null };

export type OrderDetail = Order & {
  lines: OrderLine[];
  payments: Payment[];
  events: OrderEvent[];
  installations: Installation[];
  procurement: ProcurementRequest[];
};

export type OrderSummary = Order & { lines: OrderLine[] };

export type OrderFilter = {
  q?: string;
  stage?: OrderStage | "open" | "all";
  hub?: string;
  poc?: string;
  from?: string; // ISO
  to?: string; // ISO, exclusive
  deliveredFrom?: string; // ISO
  limit?: number;
  offset?: number;
};

export type NewOrderLineInput = {
  sku: string | null;
  productName: string;
  qty?: number;
  listPriceMinor: number | null;
  offeredPriceMinor: number;
  accessories?: string | null;
  extendedWarranty?: string | null;
  installation?: string | null;
};

export type NewOrderInput = {
  source: Order["source"];
  customerName: string;
  phone: string | null;
  email?: string | null;
  shippingAddress?: string | null;
  pincode?: string | null;
  billingAddress?: string | null;
  gst?: string | null;
  hub: string | null;
  cxType?: string | null;
  poc: string | null;
  saleSource?: string | null;
  saleType?: string | null;
  declaredPaymentStatus?: string | null;
  declaredPaymentMode?: string | null;
  notes?: string | null;
  shopifyOrderId?: string | null;
  slackChannelId?: string | null;
  slackMessageTs?: string | null;
  createdBy?: string | null;
  createdAt?: string;
  stage?: OrderStage;
  lines: NewOrderLineInput[];
};

export type OpsMetrics = {
  today: { orders: number; offeredMinor: number; verifiedMinor: number; delivered: number };
  pipeline: Record<OrderStage, number>;
  pipelineValueMinor: number;
  overdue: { stuckPayment: number; stuckInventory: number; lateProcurement: number; lateInstallations: number };
  codOutstandingMinor: number;
  stock: { skus: number; units: number; reserved: number; incoming: number; valueMinor: number };
  daily: Array<{ day: string; orders: number; offeredMinor: number; delivered: number }>;
  byHub: Array<{ hub: string; orders: number; offeredMinor: number }>;
  byPoc: Array<{ poc: string; orders: number; offeredMinor: number }>;
  topProducts: Array<{ sku: string | null; name: string; units: number; offeredMinor: number }>;
};

export type ReserveResult = "ok" | "insufficient" | "already" | "missing" | "no_sku";

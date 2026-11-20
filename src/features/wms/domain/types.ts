// The warehouse (WMS) records. They sit beside the operations model: products, purchase order lines, orders and the
// stock ledger (stock_movements) stay where they are; these add units, goods receipts and the managed lists.

import type { Condition, UnitStatus } from "./unit";

/** Managed lists (dropdowns). One table, one kind per list. */
export const MASTER_KINDS = ["hub", "vendor", "billing_entity", "logistics_partner", "payment_term", "delay_reason"] as const;
export type MasterKind = (typeof MASTER_KINDS)[number];

export const MASTER_LABELS: Record<MasterKind, { one: string; many: string }> = {
  hub: { one: "Hub", many: "Hubs" },
  vendor: { one: "Vendor", many: "Vendors" },
  billing_entity: { one: "Billed to", many: "Billing entities" },
  logistics_partner: { one: "3PL partner", many: "3PL partners" },
  payment_term: { one: "Payment terms", many: "Payment terms" },
  delay_reason: { one: "Delay reason", many: "Delay reasons" },
};

export type WmsMaster = { id: string; kind: MasterKind; name: string; active: boolean; sort: number; /** 3PL partners: the tracking link with {awb}. */ note: string | null };

export type Ownership = "CnC" | "SOR";

/** The cost and ownership of one product on a PO. Prices include GST, in paise. */
export type PoLineTerms = { sku: string; unitCostMinor: number | null; gstRate: number | null; ownership: Ownership | null };

/** The PO's header. Its product lines are the existing purchase_orders rows with the same PO number. */
export type WmsPoHeader = {
  poNumber: string;
  vendor: string;
  hub: string | null;
  billedTo: string | null;
  paymentTerms: string | null;
  priority: "normal" | "high" | "urgent";
  eta: string | null;
  notes: string | null;
  lines: PoLineTerms[];
  createdBy: string;
  createdAt: string;
};

export type SerialSource = "scan" | "manual" | "internal" | "opening";

export type WmsUnit = {
  id: string;
  sku: string;
  /** As scanned. */
  serial: string;
  /** Upper-case, no spaces: what stays unique per SKU. */
  serialNorm: string;
  serialSource: SerialSource;
  /** A second IMEI or the box EAN, searchable. */
  altIds: string[];
  status: UnitStatus;
  condition: Condition;
  hub: string | null;
  ownership: Ownership | null;
  billedTo: string | null;
  /** Unit cost including GST (the sheets' CPU), in paise. */
  unitCostMinor: number | null;
  gstRate: number | null;
  poNumber: string | null;
  grnNumber: string | null;
  vendor: string | null;
  invoiceNo: string | null;
  remark: string | null;
  photos: string[];
  receivedAt: string;
  receivedBy: string;
  updatedAt: string;
};

export type UnitEvent = {
  id: string;
  unitId: string;
  at: string;
  by: string;
  kind: "received" | "status" | "condition" | "note";
  fromStatus: UnitStatus | null;
  toStatus: UnitStatus | null;
  refType: string | null;
  refId: string | null;
  text: string;
};

/** One product line of a goods receipt. */
export type GrnLine = { sku: string; productName: string; pendingBefore: number; received: number; onHold: number; countOnly: boolean };

export type Grn = {
  number: string;
  poNumber: string;
  vendor: string | null;
  hub: string | null;
  invoiceNo: string | null;
  invoicePending: boolean;
  notes: string | null;
  lines: GrnLine[];
  unitIds: string[];
  receivedBy: string;
  createdAt: string;
};

// ── Phase 2 to 4 records ─────────────────────────────────────────────────────

export type ShipmentKind = "sale" | "replacement" | "rtv";
export type ShipmentStatus = "dispatched" | "delivered" | "failed" | "returned";

/** One dispatch: units handed to our own delivery person or a 3PL, with the AWB and tracking link. */
export type Shipment = {
  number: string;
  kind: ShipmentKind;
  orderId: string | null;
  rmaNumber: string | null;
  carrier: "own" | "3pl";
  partner: string | null;
  driver: string | null;
  awb: string | null;
  trackingUrl: string | null;
  expectedDate: string | null;
  status: ShipmentStatus;
  unitIds: string[];
  serials: string[];
  hub: string | null;
  vendor: string | null;
  creditNoteMinor: number | null;
  note: string | null;
  dispatchedAt: string;
  dispatchedBy: string;
  deliveredAt: string | null;
  closedBy: string | null;
};

/** Which unit went to which order line. A unit can be linked, returned, and another linked as the replacement. */
export type UnitLink = {
  id: string;
  unitId: string;
  serial: string;
  sku: string;
  orderId: string;
  lineId: string | null;
  linkType: "sale" | "replacement";
  shipmentNumber: string | null;
  source: "dispatch_scan" | "replacement" | "manual_fix";
  active: boolean;
  linkedAt: string;
  linkedBy: string;
};

export const RMA_TYPES = ["replacement", "refund", "repair", "doa", "wrong_item", "transit_damage", "rto"] as const;
export type RmaType = (typeof RMA_TYPES)[number];
export const RMA_TYPE_LABELS: Record<RmaType, string> = {
  replacement: "Replacement",
  refund: "Return and refund",
  repair: "Repair via brand",
  doa: "Dead on arrival",
  wrong_item: "Wrong item delivered",
  transit_damage: "Damaged in transit",
  rto: "RTO (not delivered)",
};
export const RMA_REASONS = ["Defective", "Dead on arrival", "Physical damage", "Wrong item", "Missing parts", "Customer changed mind", "Not as described", "Installation issue", "Other"] as const;

export const RMA_STATUSES = ["open", "approved", "rejected", "pickup_scheduled", "received", "replacement_sent", "refund_done", "closed"] as const;
export type RmaStatus = (typeof RMA_STATUSES)[number];
export const RMA_STATUS_LABELS: Record<RmaStatus, string> = {
  open: "Open",
  approved: "Approved",
  rejected: "Rejected",
  pickup_scheduled: "Pickup booked",
  received: "Back in warehouse",
  replacement_sent: "Replacement sent",
  refund_done: "Refund done",
  closed: "Closed",
};

export type Rma = {
  number: string;
  type: RmaType;
  status: RmaStatus;
  orderId: string | null;
  unitId: string;
  serial: string;
  sku: string;
  customer: string | null;
  reason: string;
  description: string | null;
  brandTicket: string | null;
  pickup: { partner: string | null; awb: string | null; trackingUrl: string | null; at: string } | null;
  receivedAt: string | null;
  receivedCondition: import("./unit").Condition | null;
  disposition: string | null;
  replacementUnitId: string | null;
  replacementShipment: string | null;
  refundMinor: number;
  shippingCostMinor: number;
  repairCostMinor: number;
  recoveredMinor: number;
  history: Array<{ at: string; by: string; text: string }>;
  createdAt: string;
  createdBy: string;
  closedAt: string | null;
};

/** A stock count: every serial found at a hub, compared with what the system expects there. */
export type StockCount = {
  number: string;
  hub: string;
  status: "open" | "closed";
  scans: string[];
  result: { expected: number; found: number; missing: string[]; unexpected: string[]; elsewhere: string[] } | null;
  createdAt: string;
  createdBy: string;
  closedAt: string | null;
  closedBy: string | null;
};

export type RecordKinds = { shipment: Shipment; link: UnitLink; rma: Rma; count: StockCount };
export type RecordKind = keyof RecordKinds;

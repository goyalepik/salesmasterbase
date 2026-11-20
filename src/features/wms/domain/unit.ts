// A physical unit's status and condition. Pure. Every status change goes through `canMove`, so the rules sit in one place.

export const UNIT_STATUSES = [
  "received",
  "available",
  "quarantine",
  "reserved",
  "picked",
  "packed",
  "dispatched",
  "delivered",
  "return_initiated",
  "return_in_transit",
  "return_received",
  "open_box_available",
  "defective",
  "rtv_pending",
  "returned_to_vendor",
  "demo_deployed",
  "transfer_in_transit",
  "damaged",
  "lost",
  "written_off",
] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

export const UNIT_STATUS_LABELS: Record<UnitStatus, string> = {
  received: "Received, check pending",
  available: "Available",
  quarantine: "On hold",
  reserved: "Booked to an order",
  picked: "Picked",
  packed: "Packed",
  dispatched: "Dispatched",
  delivered: "Delivered",
  return_initiated: "Return started",
  return_in_transit: "Coming back",
  return_received: "Back, check pending",
  open_box_available: "Open box, available",
  defective: "Defective",
  rtv_pending: "To go back to vendor",
  returned_to_vendor: "Returned to vendor",
  demo_deployed: "Out as a demo",
  transfer_in_transit: "Moving between hubs",
  damaged: "Damaged",
  lost: "Lost",
  written_off: "Written off",
};

/** Where each status may go next. Phase 1 uses received → available / quarantine; the rest is ready for later phases. */
const NEXT: Record<UnitStatus, UnitStatus[]> = {
  received: ["available", "quarantine", "damaged", "defective"],
  available: ["reserved", "dispatched", "quarantine", "transfer_in_transit", "demo_deployed", "damaged", "lost", "written_off", "defective"],
  quarantine: ["available", "open_box_available", "defective", "damaged", "rtv_pending", "written_off"],
  reserved: ["available", "picked", "dispatched", "quarantine"],
  picked: ["packed", "available", "reserved"],
  packed: ["dispatched", "available", "reserved"],
  dispatched: ["delivered", "return_in_transit", "return_received", "lost"],
  delivered: ["return_initiated", "return_in_transit", "return_received"],
  return_initiated: ["return_in_transit", "return_received", "delivered"],
  return_in_transit: ["return_received", "lost"],
  return_received: ["available", "open_box_available", "defective", "damaged", "demo_deployed", "rtv_pending"],
  open_box_available: ["reserved", "dispatched", "quarantine", "demo_deployed", "written_off"],
  defective: ["rtv_pending", "written_off", "quarantine"],
  rtv_pending: ["returned_to_vendor", "defective"],
  returned_to_vendor: [],
  demo_deployed: ["available", "open_box_available", "quarantine", "written_off", "lost"],
  transfer_in_transit: ["available", "lost"],
  damaged: ["rtv_pending", "written_off", "quarantine"],
  lost: ["available"],
  written_off: [],
};

export function canMove(from: UnitStatus, to: UnitStatus): boolean {
  return NEXT[from].includes(to);
}

/** Physically with us (counts as stock on hand). */
export const ON_HAND: readonly UnitStatus[] = ["received", "available", "quarantine", "reserved", "picked", "packed", "open_box_available", "return_received", "defective", "damaged", "rtv_pending"];
/** Can be sold as is. */
export const SELLABLE: readonly UnitStatus[] = ["available", "open_box_available"];
/** Gone for good: their serial may come back as a new unit (a replacement from the brand, say). */
export const TERMINAL: readonly UnitStatus[] = ["returned_to_vendor", "written_off"];

export const isOnHand = (s: UnitStatus) => ON_HAND.includes(s);

/** Counted in the stock ledger: in a warehouse, or moving between our hubs. Leaving this set takes 1 off the ledger. */
export const IN_LEDGER: readonly UnitStatus[] = [...ON_HAND, "transfer_in_transit"];
export const inLedger = (s: UnitStatus) => IN_LEDGER.includes(s);

/** Changes a supervisor (procurement or admin) must make: stock written off or lost. */
export const SUPERVISOR_ONLY: readonly UnitStatus[] = ["lost", "written_off"];

// ── Condition (separate from status) ─────────────────────────────────────────

export const CONDITIONS = ["new_sealed", "good", "box_damaged", "open_box", "refurbished", "defective", "damaged", "rto_returned"] as const;
export type Condition = (typeof CONDITIONS)[number];

export const CONDITION_LABELS: Record<Condition, string> = {
  new_sealed: "New, sealed",
  good: "Good",
  box_damaged: "Box damaged",
  open_box: "Open box",
  refurbished: "Refurbished",
  defective: "Defective",
  damaged: "Damaged",
  rto_returned: "RTO returned",
};

/** The conditions offered on the receive screen, most common first. */
export const RECEIVE_CONDITIONS: Condition[] = ["good", "new_sealed", "box_damaged", "open_box", "damaged", "defective"];

/** A unit received in this condition can be sold; the others go on hold. */
export function sellableCondition(c: Condition): boolean {
  return c === "new_sealed" || c === "good" || c === "box_damaged" || c === "open_box" || c === "refurbished";
}

export function isCondition(value: unknown): value is Condition {
  return typeof value === "string" && (CONDITIONS as readonly string[]).includes(value);
}

/** The old sheets' words: GOOD/Good → good, Average → box_damaged, BAD → damaged, RTO → rto_returned. */
export function conditionFromLegacy(raw: string | null | undefined): Condition {
  const t = (raw ?? "").trim().toLowerCase();
  if (t.startsWith("avg") || t.startsWith("average") || t.startsWith("med") || t.startsWith("box")) return "box_damaged";
  if (t === "bad" || t.startsWith("damag")) return "damaged";
  if (t.startsWith("rto")) return "rto_returned";
  if (t.startsWith("defect")) return "defective";
  if (t.startsWith("open")) return "open_box";
  return "good";
}

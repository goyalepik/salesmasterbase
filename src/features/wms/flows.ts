// Warehouse flows after receiving: dispatch with AWB and tracking (phase 2), returns, replacements, back to vendor,
// demo and hub moves (phase 3), stock counts (phase 4). Every unit move goes through `moveUnit`, which keeps the one
// stock ledger right: a unit leaving the warehouse takes 1 off, a unit coming back adds 1, history is written.

import { randomUUID } from "node:crypto";
import { canAct, markDelivered, type Actor, type Result } from "@/lib/ops/service";
import { needsPaymentApproval } from "@/lib/ops/delivery-status";
import type { OrderLine, OrderStage, StockMovement } from "@/lib/ops/types";
import { normalizeSerial } from "./domain/serial";
import type { Rma, RmaType, Shipment, StockCount, UnitLink, WmsUnit } from "./domain/types";
import { RMA_TYPES } from "./domain/types";
import { canMove, CONDITION_LABELS, inLedger, isCondition, isOnHand, SELLABLE, SUPERVISOR_ONLY, UNIT_STATUS_LABELS, type Condition, type UnitStatus } from "./domain/unit";
import { activeNames, canSeeCost, ensureMasters, type Wms } from "./service";

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const clean = (v: string | null | undefined, max = 200) => v?.replace(/\s+/g, " ").trim().slice(0, max) || null;
const pad = (prefix: string, n: number) => `${prefix}-${String(n).padStart(5, "0")}`;

// ── Moving one unit ──────────────────────────────────────────────────────────

type MoveOpts = { actor: Actor; text: string; refType: string; refId: string | null; patch?: Partial<WmsUnit>; at?: string };

const OUT_KINDS: Partial<Record<UnitStatus, StockMovement["kind"]>> = { dispatched: "dispatch", returned_to_vendor: "rtv" };
const FROM_CUSTOMER: UnitStatus[] = ["dispatched", "delivered", "return_initiated", "return_in_transit"];

/** Moves a unit to a new status (only along allowed steps), keeps the ledger right and writes the history. Error text or null. */
export async function moveUnit(ctx: Wms, unit: WmsUnit, to: UnitStatus, o: MoveOpts): Promise<string | null> {
  if (unit.status === to) return null;
  if (!canMove(unit.status, to)) return `${unit.serial} is “${UNIT_STATUS_LABELS[unit.status]}”, so it can't become “${UNIT_STATUS_LABELS[to]}”.`;
  const at = o.at ?? new Date().toISOString();
  const ok = await ctx.wms.updateUnit(unit.id, { ...o.patch, status: to }, unit.status);
  if (!ok) return `${unit.serial} was just changed by someone else. Refresh and try again.`;
  const was = inLedger(unit.status);
  const now = inLedger(to);
  if (was !== now) {
    const kind: StockMovement["kind"] = was ? (OUT_KINDS[to] ?? "adjust") : FROM_CUSTOMER.includes(unit.status) ? "return" : "adjust";
    await ctx.ops.addMovement({ sku: unit.sku, qty: was ? -1 : 1, kind, refType: o.refType, refId: o.refId, serialNo: unit.serial, unitCostMinor: unit.unitCostMinor, note: o.text.slice(0, 200), actor: o.actor.name, createdAt: at });
  }
  await ctx.wms.addUnitEvents([{ unitId: unit.id, at, by: o.actor.name, kind: "status", fromStatus: unit.status, toStatus: to, refType: o.refType, refId: o.refId, text: o.text }]);
  Object.assign(unit, o.patch, { status: to });
  return null;
}

/** The unit with this serial (or second ID), preferring one still with us. */
async function unitBySerial(ctx: Wms, serial: string, sku?: string): Promise<WmsUnit | null> {
  const units = await ctx.wms.unitsBySerial(normalizeSerial(serial));
  const pick = (list: WmsUnit[]) => list.find((u) => isOnHand(u.status)) ?? list[0] ?? null;
  return sku ? pick(units.filter((u) => u.sku === sku)) ?? pick(units) : pick(units);
}

function trackingLink(template: string | null | undefined, awb: string | null): string | null {
  if (!template || !awb || !template.includes("{awb}")) return null;
  return template.replace("{awb}", encodeURIComponent(awb));
}

async function partnerTemplate(ctx: Wms, partner: string | null): Promise<string | null> {
  if (!partner) return null;
  const masters = await ensureMasters(ctx);
  return masters.find((m) => m.kind === "logistics_partner" && m.name === partner)?.note ?? null;
}

// ── Phase 2: dispatch ────────────────────────────────────────────────────────

export type Carrier = { carrier: "own" | "3pl"; partner: string | null; driver: string | null; awb: string | null; trackingUrl: string | null; expectedDate: string | null; note: string | null };

async function checkCarrier(ctx: Wms, c: Carrier): Promise<{ ok: true; value: Carrier } | { ok: false; error: string }> {
  const driver = clean(c.driver, 60);
  const partner = clean(c.partner, 60);
  const awb = clean(c.awb, 60)?.replace(/\s/g, "") ?? null;
  if (c.carrier === "own" && !driver) return fail("Enter who is delivering (our delivery person).");
  if (c.carrier === "3pl") {
    if (!partner || !(await activeNames(ctx, "logistics_partner")).includes(partner)) return fail("Choose the 3PL partner.");
    if (!awb) return fail("Enter or scan the AWB (tracking number).");
  }
  const typed = clean(c.trackingUrl, 300);
  if (typed && !/^https:\/\/[^\s]+$/.test(typed)) return fail("The tracking link should start with https://");
  const trackingUrl = typed ?? trackingLink(await partnerTemplate(ctx, partner), awb);
  if (c.expectedDate && !/^\d{4}-\d{2}-\d{2}$/.test(c.expectedDate)) return fail("Expected date looks wrong.");
  return { ok: true, value: { carrier: c.carrier, partner: c.carrier === "3pl" ? partner : null, driver, awb, trackingUrl, expectedDate: c.expectedDate || null, note: clean(c.note, 300) } };
}

const LIVE_LINE = (l: OrderLine) => !!l.sku && l.status !== "cancelled" && l.status !== "rejected" && l.status !== "brand_direct";
const DISPATCHABLE: OrderStage[] = ["awaiting_payment", "awaiting_inventory", "awaiting_stock", "ready_to_dispatch", "on_hold"];

export type QueueRow = { orderId: string; label: string; customer: string; hub: string | null; stage: OrderStage; createdAt: string; lines: Array<{ lineId: string; sku: string; name: string; qty: number; sent: number; inStock: number }> };

/** Orders waiting to go out: payment approved, not yet dispatched, with products the warehouse ships. */
export async function dispatchQueue(ctx: Wms): Promise<QueueRow[]> {
  const lists = await Promise.all(DISPATCHABLE.map((stage) => ctx.ops.listOrders({ stage, limit: 500 })));
  const sellable = await ctx.wms.listUnits({ statuses: [...SELLABLE] });
  const inStock = new Map<string, number>();
  for (const u of sellable) inStock.set(u.sku, (inStock.get(u.sku) ?? 0) + 1);
  const rows: QueueRow[] = [];
  for (const order of lists.flatMap((l) => l.items)) {
    if (needsPaymentApproval(order)) continue;
    const lines = order.lines.filter((l) => LIVE_LINE(l) && l.status !== "dispatched");
    if (!lines.length) continue;
    const links = await ctx.wms.listRecords("link", { orderId: order.id, status: "active" });
    rows.push({
      orderId: order.id,
      label: order.shopifyOrderId ?? order.id,
      customer: order.customerName,
      hub: order.hub,
      stage: order.stage,
      createdAt: order.createdAt,
      lines: lines.map((l) => ({ lineId: l.id, sku: l.sku!, name: l.productName, qty: l.qty, sent: links.filter((k) => k.lineId === l.id).length, inStock: inStock.get(l.sku!) ?? 0 })),
    });
  }
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export type DispatchScan = { ok: true; lineId: string; serial: string; sku: string; text: string } | { ok: false; reason: string };

/** Checks one scanned serial for an order: in stock and sellable, and the product of a line that still needs units. */
export async function checkDispatchScan(ctx: Wms, orderId: string, serial: string, already: Array<{ lineId: string; serial: string }>): Promise<DispatchScan> {
  const order = await ctx.ops.getOrder(orderId);
  if (!order) return { ok: false, reason: "Order not found." };
  const norm = normalizeSerial(serial);
  if (!norm) return { ok: false, reason: "The scan was empty." };
  if (already.some((a) => normalizeSerial(a.serial) === norm)) return { ok: false, reason: "Already scanned for this order." };
  const unit = await unitBySerial(ctx, serial);
  if (!unit) return { ok: false, reason: "No unit with this serial in the warehouse records. Check the serial, or receive it first." };
  if (!SELLABLE.includes(unit.status)) return { ok: false, reason: `This unit is “${UNIT_STATUS_LABELS[unit.status]}”, so it can't be sent.` };
  const links = await ctx.wms.listRecords("link", { orderId, status: "active" });
  const line = order.lines.filter(LIVE_LINE).find((l) => l.sku === unit.sku && l.status !== "dispatched" && links.filter((k) => k.lineId === l.id).length + already.filter((a) => a.lineId === l.id).length < l.qty);
  if (!line) {
    const wanted = order.lines.filter(LIVE_LINE).map((l) => l.sku).join(", ");
    return { ok: false, reason: order.lines.some((l) => l.sku === unit.sku) ? "All units of this product are already scanned for this order." : `Wrong product: this is ${unit.sku}. The order needs ${wanted || "nothing from the warehouse"}.` };
  }
  return { ok: true, lineId: line.id, serial: unit.serial, sku: unit.sku, text: `${unit.serial} matches ${line.productName.slice(0, 50)}.` };
}

/** Hands units to a delivery person or 3PL: units out of stock, shipment with AWB and tracking link, units linked to the order lines. */
async function ship(ctx: Wms, units: WmsUnit[], c: Carrier, meta: { kind: Shipment["kind"]; orderId: string | null; rmaNumber: string | null; vendor?: string | null; creditNoteMinor?: number | null; lineOf?: Map<string, string>; to?: UnitStatus }, actor: Actor, now: Date): Promise<Result<Shipment>> {
  const at = now.toISOString();
  const number = pad("SHP", await ctx.wms.nextNumber("shipment"));
  const to = meta.to ?? "dispatched";
  const moved: WmsUnit[] = [];
  for (const u of units) {
    const before = { ...u };
    const error = await moveUnit(ctx, u, to, { actor, at, refType: meta.kind === "replacement" ? "replacement" : meta.kind === "rtv" ? "rtv" : "order", refId: meta.orderId ?? meta.rmaNumber ?? number, text: `${meta.kind === "rtv" ? "Sent back to the vendor" : "Dispatched"} on ${number}${c.awb ? `, AWB ${c.awb}` : ""}${c.partner ? ` via ${c.partner}` : c.driver ? ` with ${c.driver}` : ""}${meta.orderId ? ` for ${meta.orderId}` : ""}.` });
    if (error) {
      // Put back what already moved, so a half-done dispatch never stays.
      for (const m of moved.reverse()) await moveBack(ctx, m, actor, number);
      Object.assign(u, before);
      return fail(error);
    }
    moved.push(u);
  }
  const shipment: Shipment = {
    number,
    kind: meta.kind,
    orderId: meta.orderId,
    rmaNumber: meta.rmaNumber,
    carrier: c.carrier,
    partner: c.partner,
    driver: c.driver,
    awb: c.awb,
    trackingUrl: c.trackingUrl,
    expectedDate: c.expectedDate,
    status: "dispatched",
    unitIds: units.map((u) => u.id),
    serials: units.map((u) => u.serial),
    hub: units[0]?.hub ?? null,
    vendor: meta.vendor ?? null,
    creditNoteMinor: meta.creditNoteMinor ?? null,
    note: c.note,
    dispatchedAt: at,
    dispatchedBy: actor.name,
    deliveredAt: null,
    closedBy: null,
  };
  await ctx.wms.saveRecord("shipment", shipment);
  if (meta.orderId && meta.kind !== "rtv") {
    for (const u of units) {
      const link: UnitLink = { id: randomUUID(), unitId: u.id, serial: u.serial, sku: u.sku, orderId: meta.orderId, lineId: meta.lineOf?.get(u.id) ?? null, linkType: meta.kind === "replacement" ? "replacement" : "sale", shipmentNumber: number, source: meta.kind === "replacement" ? "replacement" : "dispatch_scan", active: true, linkedAt: at, linkedBy: actor.name };
      await ctx.wms.saveRecord("link", link);
    }
  }
  return { ok: true, value: shipment, message: number };
}

/** Undo one dispatch move (used when a later unit in the same dispatch fails). */
async function moveBack(ctx: Wms, unit: WmsUnit, actor: Actor, ref: string) {
  const back: UnitStatus = "available";
  await ctx.wms.updateUnit(unit.id, { status: back });
  await ctx.ops.addMovement({ sku: unit.sku, qty: 1, kind: "adjust", refType: "undo", refId: ref, serialNo: unit.serial, unitCostMinor: unit.unitCostMinor, note: "Dispatch undone", actor: actor.name });
  await ctx.wms.addUnitEvents([{ unitId: unit.id, at: new Date().toISOString(), by: actor.name, kind: "status", fromStatus: unit.status, toStatus: back, refType: "undo", refId: ref, text: "Dispatch undone: another unit in the same dispatch failed." }]);
}

export type DispatchInput = Carrier & { orderId: string; units: Array<{ lineId: string; serial: string }> };

/**
 * Dispatches an order from the warehouse: each scanned unit is checked (in stock, sellable, right product), leaves stock,
 * and is linked to its order line; the shipment keeps the AWB and tracking link; the order goes out for delivery once
 * every product line is sent.
 */
export async function dispatchOrder(ctx: Wms, input: DispatchInput, actor: Actor, now = new Date()): Promise<Result<Shipment>> {
  if (!(await canAct(ctx.ops, actor, "logistics")) && !(await canAct(ctx.ops, actor, "inventory"))) return fail("Only the warehouse or logistics can dispatch.");
  const order = await ctx.ops.getOrder(input.orderId);
  if (!order) return fail("Order not found.");
  if (order.stage === "cancelled") return fail("This order is cancelled.");
  if (order.stage === "delivered" || order.stage === "out_for_delivery") return fail("This order has already gone out.");
  if (needsPaymentApproval(order)) return fail("Sales hasn't approved the payment yet.");
  if (!input.units.length) return fail("Scan at least one unit.");
  const carrier = await checkCarrier(ctx, input);
  if (!carrier.ok) return carrier;

  const units: WmsUnit[] = [];
  const lineOf = new Map<string, string>();
  const checked: Array<{ lineId: string; serial: string }> = [];
  for (const scan of input.units) {
    const check = await checkDispatchScan(ctx, order.id, scan.serial, checked);
    if (!check.ok) return fail(`${scan.serial}: ${check.reason}`);
    const unit = (await unitBySerial(ctx, check.serial, check.sku))!;
    units.push(unit);
    lineOf.set(unit.id, check.lineId);
    checked.push({ lineId: check.lineId, serial: check.serial });
  }

  // Lines booked by quantity in the ledger: free the booking first, the units now leave as themselves.
  for (const lineId of new Set(lineOf.values())) {
    const line = order.lines.find((l) => l.id === lineId);
    if (line?.status === "reserved") await ctx.ops.consumeReservation(line.id);
  }

  const shipped = await ship(ctx, units, carrier.value, { kind: "sale", orderId: order.id, rmaNumber: null, lineOf }, actor, now);
  if (!shipped.ok) return shipped;

  const links = await ctx.wms.listRecords("link", { orderId: order.id, status: "active" });
  for (const line of order.lines.filter(LIVE_LINE)) {
    const serials = links.filter((k) => k.lineId === line.id).map((k) => k.serial);
    if (!serials.length) continue;
    await ctx.ops.updateLine(line.id, { serialNo: serials.join(", ").slice(0, 200), ...(serials.length >= line.qty ? { status: "dispatched" } : {}) });
  }
  const fresh = (await ctx.ops.getOrder(order.id))!;
  const allSent = fresh.lines.filter(LIVE_LINE).every((l) => l.status === "dispatched");
  const s = shipped.value;
  const who = s.carrier === "3pl" ? `${s.partner}${s.awb ? `, AWB ${s.awb}` : ""}` : `${s.driver}`;
  if (allSent) {
    await ctx.ops.updateOrder(order.id, { stage: "out_for_delivery", stageChangedAt: now.toISOString(), driver: s.driver ?? s.partner, dispatchedAt: now.toISOString(), expectedDeliveryDate: s.expectedDate ?? order.expectedDeliveryDate }, DISPATCHABLE);
  }
  await ctx.ops.appendEvent({ orderId: order.id, lineId: null, type: allSent ? "out_for_delivery" : "note", actor: actor.name, summary: `${allSent ? "Out for delivery" : "Part dispatched"} from the warehouse (${s.number}) with ${who}. Serials: ${s.serials.join(", ")}.${s.trackingUrl ? ` Track: ${s.trackingUrl}` : ""}` });
  return { ok: true, value: s, message: `${s.number}: ${s.serials.length} unit${s.serials.length === 1 ? "" : "s"} out for ${order.shopifyOrderId ?? order.id} with ${who}.${allSent ? "" : " Some products on the order still need units."}` };
}

/** Delivered: units delivered, the order marked delivered (cash collected recorded, installation made as usual). */
export async function shipmentDelivered(ctx: Wms, number: string, input: { collectedMinor: number; mode: string | null }, actor: Actor, now = new Date()): Promise<Result<Shipment>> {
  if (!(await canAct(ctx.ops, actor, "logistics")) && !(await canAct(ctx.ops, actor, "inventory"))) return fail("Only the warehouse or logistics can update deliveries.");
  const s = await ctx.wms.getRecord("shipment", number);
  if (!s || s.status !== "dispatched") return fail("This shipment isn't on the road.");
  for (const id of s.unitIds) {
    const u = await ctx.wms.getUnit(id);
    if (u && u.status === "dispatched") await moveUnit(ctx, u, s.kind === "rtv" ? "returned_to_vendor" : "delivered", { actor, refType: "shipment", refId: number, text: `Delivered (${number}).` });
  }
  s.status = "delivered";
  s.deliveredAt = now.toISOString();
  s.closedBy = actor.name;
  await ctx.wms.saveRecord("shipment", s);
  if (s.kind === "sale" && s.orderId) {
    const order = await ctx.ops.getOrder(s.orderId);
    if (order?.stage === "out_for_delivery") {
      const done = await markDelivered(ctx.ops, s.orderId, { collectedMinor: Math.max(0, input.collectedMinor), mode: input.mode }, actor, now);
      if (!done.ok) return { ok: true, value: s, message: `${number} delivered. The order wasn't updated: ${done.error}` };
    }
  }
  return { ok: true, value: s, message: `${number} delivered.` };
}

/** Delivery failed: units come back (RTO). The order goes on hold with the reason. */
export async function shipmentFailed(ctx: Wms, number: string, reason: string, actor: Actor, now = new Date()): Promise<Result<Shipment>> {
  if (!(await canAct(ctx.ops, actor, "logistics")) && !(await canAct(ctx.ops, actor, "inventory"))) return fail("Only the warehouse or logistics can update deliveries.");
  const why = clean(reason, 200);
  if (!why) return fail("Write why the delivery failed.");
  const s = await ctx.wms.getRecord("shipment", number);
  if (!s || s.status !== "dispatched") return fail("This shipment isn't on the road.");
  for (const id of s.unitIds) {
    const u = await ctx.wms.getUnit(id);
    if (u && u.status === "dispatched") await moveUnit(ctx, u, "return_in_transit", { actor, refType: "shipment", refId: number, text: `Delivery failed (${why}). Coming back.` });
  }
  s.status = "failed";
  s.note = [s.note, `Failed: ${why}`].filter(Boolean).join(" · ");
  await ctx.wms.saveRecord("shipment", s);
  if (s.orderId) {
    await ctx.ops.updateOrder(s.orderId, { stage: "on_hold", stageChangedAt: now.toISOString(), holdReason: `Delivery failed: ${why}` }, "out_for_delivery");
    for (const link of await ctx.wms.listRecords("link", { orderId: s.orderId, status: "active" })) {
      if (link.shipmentNumber === number) await ctx.wms.saveRecord("link", { ...link, active: false });
    }
    for (const line of (await ctx.ops.getOrder(s.orderId))?.lines ?? []) if (line.status === "dispatched") await ctx.ops.updateLine(line.id, { status: "pending" });
    await ctx.ops.appendEvent({ orderId: s.orderId, lineId: null, type: "status", actor: actor.name, summary: `Delivery failed (${number}): ${why}. Units coming back to the warehouse; order on hold.` });
  }
  return { ok: true, value: s, message: `${number} marked failed. Receive the units when they're back.` };
}

/** Units of a failed delivery are back: they go to "Back, check pending" and stock again. */
export async function shipmentBack(ctx: Wms, number: string, actor: Actor): Promise<Result<Shipment>> {
  if (!(await canAct(ctx.ops, actor, "inventory"))) return fail("Only the warehouse can receive units back.");
  const s = await ctx.wms.getRecord("shipment", number);
  if (!s || s.status !== "failed") return fail("Only a failed delivery can come back here.");
  for (const id of s.unitIds) {
    const u = await ctx.wms.getUnit(id);
    if (u && (u.status === "return_in_transit" || u.status === "dispatched")) {
      const error = await moveUnit(ctx, u, "return_received", { actor, refType: "shipment", refId: number, text: `Back in the warehouse after the failed delivery (${number}). Check it before selling.` });
      if (error) return fail(error);
    }
  }
  s.status = "returned";
  s.closedBy = actor.name;
  await ctx.wms.saveRecord("shipment", s);
  return { ok: true, value: s, message: `${number}: units back. Check each one on its page (ready to sell, open box or defective).` };
}

/** Orders delivered on the Order view (status picker) also close their shipment here. */
export async function followDeliveredOrders(ctx: Wms, actor: Actor): Promise<number> {
  let n = 0;
  for (const s of await ctx.wms.listRecords("shipment", { status: "dispatched", limit: 500 })) {
    if (s.kind !== "sale" || !s.orderId) continue;
    const order = await ctx.ops.getOrder(s.orderId);
    if (order?.stage !== "delivered") continue;
    for (const id of s.unitIds) {
      const u = await ctx.wms.getUnit(id);
      if (u?.status === "dispatched") await moveUnit(ctx, u, "delivered", { actor, refType: "order", refId: order.id, text: "Delivered (marked on the Order view)." });
    }
    await ctx.wms.saveRecord("shipment", { ...s, status: "delivered", deliveredAt: order.deliveredAt ?? new Date().toISOString() });
    n++;
  }
  return n;
}

export type OrderUnitsView = Array<{ link: UnitLink; unit: WmsUnit | null; shipment: Shipment | null }>;

/** The units sent on an order, with AWB and tracking link (shown on the order card). */
export async function orderUnits(ctx: Wms, orderId: string): Promise<OrderUnitsView> {
  const links = await ctx.wms.listRecords("link", { orderId });
  const out: OrderUnitsView = [];
  for (const link of links) {
    out.push({ link, unit: await ctx.wms.getUnit(link.unitId), shipment: link.shipmentNumber ? await ctx.wms.getRecord("shipment", link.shipmentNumber) : null });
  }
  return out;
}

// ── Phase 3: returns and replacements (RMA) ──────────────────────────────────

export type NewRma = { serial: string; type: RmaType; reason: string; description: string | null; brandTicket: string | null };

export async function openRma(ctx: Wms, input: NewRma, actor: Actor, now = new Date()): Promise<Result<Rma>> {
  if (!(await canAct(ctx.ops, actor, "inventory")) && !(await canAct(ctx.ops, actor, "sales"))) return fail("Only sales or the warehouse can open a return.");
  if (!RMA_TYPES.includes(input.type)) return fail("Choose what kind of return this is.");
  const reason = clean(input.reason, 60);
  if (!reason) return fail("Choose the reason.");
  const unit = await unitBySerial(ctx, input.serial);
  if (!unit) return fail("No unit with that serial was sent from the warehouse. Returns start from the original serial.");
  if (isOnHand(unit.status)) return fail(`${unit.serial} is in the warehouse (“${UNIT_STATUS_LABELS[unit.status]}”). Returns are for units that went to a customer.`);
  const open = (await ctx.wms.listRecords("rma", { unitId: unit.id })).find((r) => r.status !== "closed" && r.status !== "rejected");
  if (open) return fail(`${unit.serial} already has an open return: ${open.number}.`);
  const link = (await ctx.wms.listRecords("link", { unitId: unit.id }))[0] ?? null;
  const order = link ? await ctx.ops.getOrder(link.orderId) : null;
  const at = now.toISOString();
  const rma: Rma = {
    number: pad("RMA", await ctx.wms.nextNumber("rma")),
    type: input.type,
    status: "open",
    orderId: link?.orderId ?? null,
    unitId: unit.id,
    serial: unit.serial,
    sku: unit.sku,
    customer: order?.customerName ?? null,
    reason,
    description: clean(input.description, 500),
    brandTicket: clean(input.brandTicket, 60),
    pickup: null,
    receivedAt: null,
    receivedCondition: null,
    disposition: null,
    replacementUnitId: null,
    replacementShipment: null,
    refundMinor: 0,
    shippingCostMinor: 0,
    repairCostMinor: 0,
    recoveredMinor: 0,
    history: [{ at, by: actor.name, text: `Opened: ${reason}${input.description ? `. ${clean(input.description, 200)}` : ""}` }],
    createdAt: at,
    createdBy: actor.name,
    closedAt: null,
  };
  await ctx.wms.saveRecord("rma", rma);
  await ctx.wms.addUnitEvents([{ unitId: unit.id, at, by: actor.name, kind: "note", fromStatus: null, toStatus: null, refType: "rma", refId: rma.number, text: `Return opened: ${rma.number} (${reason}).` }]);
  if (rma.orderId) await ctx.ops.appendEvent({ orderId: rma.orderId, lineId: null, type: "note", actor: actor.name, summary: `Return ${rma.number} opened for ${unit.serial}: ${reason}.` });
  return { ok: true, value: rma, message: `${rma.number} opened for ${unit.serial}.` };
}

export type RmaStep =
  | { step: "approve"; note: string | null }
  | { step: "reject"; note: string | null }
  | ({ step: "pickup" } & Pick<Carrier, "partner" | "awb" | "trackingUrl">)
  | { step: "receive"; serial: string; condition: Condition; note: string | null; override: boolean }
  | { step: "dispose"; to: UnitStatus; note: string | null }
  | ({ step: "replace"; serial: string } & Carrier)
  | { step: "money"; refundMinor: number | null; shippingCostMinor: number | null; repairCostMinor: number | null; recoveredMinor: number | null }
  | { step: "close"; note: string | null };

export const DISPOSITIONS: Array<{ to: UnitStatus; label: string }> = [
  { to: "available", label: "Restock as new" },
  { to: "open_box_available", label: "Restock as open box" },
  { to: "rtv_pending", label: "Send back to vendor" },
  { to: "defective", label: "Defective, decide later" },
  { to: "demo_deployed", label: "Use as a demo unit" },
  { to: "written_off", label: "Scrap (write off)" },
];

/** One step on a return. Each step checks it makes sense now, moves the unit if needed and adds a line to the history. */
export async function rmaStep(ctx: Wms, number: string, s: RmaStep, actor: Actor, now = new Date()): Promise<Result<Rma>> {
  if (!(await canAct(ctx.ops, actor, "inventory")) && !(await canAct(ctx.ops, actor, "sales"))) return fail("Only sales or the warehouse can work on returns.");
  const rma = await ctx.wms.getRecord("rma", number);
  if (!rma) return fail("Return not found.");
  if (rma.status === "closed" && s.step !== "money") return fail("This return is closed.");
  const unit = await ctx.wms.getUnit(rma.unitId);
  if (!unit) return fail("The unit of this return is missing.");
  const at = now.toISOString();
  const add = (text: string) => rma.history.push({ at, by: actor.name, text });
  const supervisor = await canSeeCost(ctx.ops, actor);

  switch (s.step) {
    case "approve":
      if (rma.status !== "open") return fail("Only an open return can be approved.");
      rma.status = "approved";
      add(`Approved.${s.note ? ` ${clean(s.note)}` : ""}`);
      break;
    case "reject":
      if (!clean(s.note)) return fail("Write why the return is rejected.");
      if (rma.receivedAt) return fail("The unit is already back. Use the steps below instead.");
      rma.status = "rejected";
      rma.closedAt = at;
      add(`Rejected: ${clean(s.note)}`);
      break;
    case "pickup": {
      if (rma.status !== "approved" && rma.status !== "open") return fail("Book the pickup after approving.");
      const c = await checkCarrier(ctx, { carrier: "3pl", partner: s.partner, driver: null, awb: s.awb, trackingUrl: s.trackingUrl, expectedDate: null, note: null });
      if (!c.ok) return c;
      if (unit.status === "delivered" || unit.status === "dispatched") {
        const error = await moveUnit(ctx, unit, "return_in_transit", { actor, at, refType: "rma", refId: number, text: `Pickup booked with ${c.value.partner}, AWB ${c.value.awb} (${number}).` });
        if (error) return fail(error);
      }
      rma.pickup = { partner: c.value.partner, awb: c.value.awb, trackingUrl: c.value.trackingUrl, at };
      rma.status = "pickup_scheduled";
      add(`Pickup booked: ${c.value.partner}, AWB ${c.value.awb}.`);
      break;
    }
    case "receive": {
      if (rma.receivedAt) return fail("Already received.");
      if (!isCondition(s.condition)) return fail("Choose the condition it came back in.");
      if (normalizeSerial(s.serial) !== unit.serialNorm && !unit.altIds.includes(normalizeSerial(s.serial))) {
        if (!s.override || !supervisor) return fail(`The serial scanned (${s.serial}) is not the one sold (${unit.serial}). Only procurement or admin can accept a different unit, with a note.`);
        if (!clean(s.note)) return fail("Write why a different serial is accepted.");
      }
      const error = await moveUnit(ctx, unit, "return_received", { actor, at, refType: "rma", refId: number, patch: { condition: s.condition }, text: `Back in the warehouse on ${number}. Condition: ${CONDITION_LABELS[s.condition]}.${s.note ? ` ${clean(s.note)}` : ""}` });
      if (error) return fail(error);
      rma.receivedAt = at;
      rma.receivedCondition = s.condition;
      rma.status = "received";
      add(`Received back${normalizeSerial(s.serial) !== unit.serialNorm ? ` (different serial ${s.serial}, accepted)` : ""}. ${CONDITION_LABELS[s.condition]}.`);
      for (const link of await ctx.wms.listRecords("link", { unitId: unit.id, status: "active" })) await ctx.wms.saveRecord("link", { ...link, active: false });
      break;
    }
    case "dispose": {
      if (!rma.receivedAt) return fail("Receive the unit back first.");
      const choice = DISPOSITIONS.find((d) => d.to === s.to);
      if (!choice) return fail("Choose what happens to the returned unit.");
      if (s.to === "written_off" && !supervisor) return fail("Only procurement or admin can write off a unit.");
      if ((s.to === "written_off" || s.to === "demo_deployed") && !clean(s.note)) return fail("Add a note.");
      let error: string | null = null;
      if (s.to === "rtv_pending" && unit.status === "return_received") error = await moveUnit(ctx, unit, "rtv_pending", { actor, at, refType: "rma", refId: number, text: `${choice.label} (${number}).` });
      else if (s.to === "written_off") error = (await moveUnit(ctx, unit, "defective", { actor, at, refType: "rma", refId: number, text: `Checked: not sellable (${number}).` })) ?? (await moveUnit(ctx, unit, "written_off", { actor, at, refType: "rma", refId: number, text: `Written off: ${clean(s.note)} (${number}).` }));
      else error = await moveUnit(ctx, unit, s.to, { actor, at, refType: "rma", refId: number, patch: s.to === "open_box_available" ? { condition: "open_box" } : undefined, text: `${choice.label}${s.note ? `: ${clean(s.note)}` : ""} (${number}).` });
      if (error) return fail(error);
      rma.disposition = choice.label;
      add(`Returned unit: ${choice.label}.${s.note ? ` ${clean(s.note)}` : ""}`);
      break;
    }
    case "replace": {
      if (rma.replacementUnitId) return fail("A replacement was already sent.");
      if (rma.status === "rejected") return fail("This return was rejected.");
      const replacement = await unitBySerial(ctx, s.serial);
      if (!replacement || !SELLABLE.includes(replacement.status)) return fail("Scan a unit that is in stock and ready to sell.");
      if (replacement.sku !== rma.sku && rma.type !== "wrong_item") return fail(`The replacement is ${replacement.sku}, but the return is for ${rma.sku}.`);
      const c = await checkCarrier(ctx, s);
      if (!c.ok) return c;
      const shipped = await ship(ctx, [replacement], c.value, { kind: "replacement", orderId: rma.orderId, rmaNumber: number }, actor, now);
      if (!shipped.ok) return shipped;
      for (const link of await ctx.wms.listRecords("link", { unitId: unit.id, status: "active" })) await ctx.wms.saveRecord("link", { ...link, active: false });
      rma.replacementUnitId = replacement.id;
      rma.replacementShipment = shipped.value.number;
      rma.status = "replacement_sent";
      add(`Replacement ${replacement.serial} sent on ${shipped.value.number}${c.value.awb ? ` (AWB ${c.value.awb})` : ""}.`);
      if (rma.orderId) await ctx.ops.appendEvent({ orderId: rma.orderId, lineId: null, type: "note", actor: actor.name, summary: `Replacement ${replacement.serial} sent for ${unit.serial} (${number}, ${shipped.value.number}).` });
      break;
    }
    case "money": {
      const vals = [s.refundMinor, s.shippingCostMinor, s.repairCostMinor, s.recoveredMinor];
      if (vals.some((v) => v != null && (!Number.isInteger(v) || v < 0 || v > 100_000_000_00))) return fail("Amounts should be in rupees.");
      if (s.refundMinor != null) rma.refundMinor = s.refundMinor;
      if (s.shippingCostMinor != null) rma.shippingCostMinor = s.shippingCostMinor;
      if (s.repairCostMinor != null) rma.repairCostMinor = s.repairCostMinor;
      if (s.recoveredMinor != null) rma.recoveredMinor = s.recoveredMinor;
      if (s.refundMinor && rma.status !== "closed") rma.status = "refund_done";
      add("Costs updated.");
      break;
    }
    case "close":
      if (rma.status === "open") return fail("Approve or reject it first.");
      rma.status = "closed";
      rma.closedAt = at;
      add(`Closed.${s.note ? ` ${clean(s.note)}` : ""}`);
      break;
  }
  await ctx.wms.saveRecord("rma", rma);
  return { ok: true, value: rma, message: `${number}: ${rma.history.at(-1)!.text}` };
}

/** What a return cost us: refund, shipping, repair and the replacement unit, minus what the brand gave back. */
export async function rmaNetCost(ctx: Wms, rma: Rma): Promise<number> {
  const replacement = rma.replacementUnitId ? await ctx.wms.getUnit(rma.replacementUnitId) : null;
  return rma.refundMinor + rma.shippingCostMinor + rma.repairCostMinor + (replacement?.unitCostMinor ?? 0) - rma.recoveredMinor;
}

/** Sends units back to the vendor (RTV): out of stock, a shipment with AWB, and the brand's credit note shared over their returns. */
export async function sendToVendor(ctx: Wms, input: { serials: string[]; vendor: string; creditNoteMinor: number | null } & Carrier, actor: Actor, now = new Date()): Promise<Result<Shipment>> {
  if (!(await canSeeCost(ctx.ops, actor))) return fail("Only procurement or admin can send units back to a vendor.");
  const vendor = clean(input.vendor, 80);
  if (!vendor) return fail("Choose the vendor.");
  if (!input.serials.length) return fail("Pick at least one unit.");
  const units: WmsUnit[] = [];
  for (const serial of input.serials) {
    const u = await unitBySerial(ctx, serial);
    if (!u || !["rtv_pending", "defective", "damaged", "quarantine"].includes(u.status)) return fail(`${serial} isn't waiting to go back to a vendor.`);
    if (u.status !== "rtv_pending") {
      const error = await moveUnit(ctx, u, "rtv_pending", { actor, refType: "rtv", refId: null, text: "Set aside to go back to the vendor." });
      if (error) return fail(error);
    }
    units.push(u);
  }
  const c = await checkCarrier(ctx, input);
  if (!c.ok) return c;
  const shipped = await ship(ctx, units, c.value, { kind: "rtv", orderId: null, rmaNumber: null, vendor, creditNoteMinor: input.creditNoteMinor, to: "returned_to_vendor" }, actor, now);
  if (!shipped.ok) return shipped;
  // The credit note pays back the returns these units came from.
  if (input.creditNoteMinor && input.creditNoteMinor > 0) {
    const share = Math.floor(input.creditNoteMinor / units.length);
    for (const u of units) {
      for (const rma of await ctx.wms.listRecords("rma", { unitId: u.id })) {
        if (rma.unitId !== u.id) continue;
        rma.recoveredMinor += share;
        rma.history.push({ at: now.toISOString(), by: actor.name, text: `Vendor credit note: ₹${(share / 100).toLocaleString("en-IN")} on ${shipped.value.number}.` });
        await ctx.wms.saveRecord("rma", rma);
      }
    }
  }
  return { ok: true, value: shipped.value, message: `${shipped.value.number}: ${units.length} unit${units.length === 1 ? "" : "s"} back to ${vendor}.` };
}

// ── Phase 3: one unit's status (quality check, demo, hub moves, write-off) ───

export const UNIT_CHOICES: UnitStatus[] = ["available", "open_box_available", "quarantine", "defective", "damaged", "rtv_pending", "demo_deployed", "transfer_in_transit", "lost", "written_off"];
const NEEDS_NOTE: UnitStatus[] = ["damaged", "defective", "lost", "written_off", "demo_deployed", "quarantine"];

/** The statuses this unit can be set to by hand from its page. */
export function choicesFor(unit: WmsUnit): UnitStatus[] {
  return UNIT_CHOICES.filter((to) => canMove(unit.status, to));
}

export async function setUnitStatus(ctx: Wms, unitId: string, input: { to: UnitStatus; note: string | null; hub: string | null }, actor: Actor): Promise<Result<WmsUnit>> {
  if (!(await canAct(ctx.ops, actor, "inventory"))) return fail("Only the warehouse can change a unit.");
  const unit = await ctx.wms.getUnit(unitId);
  if (!unit) return fail("Unit not found.");
  if (!UNIT_CHOICES.includes(input.to)) return fail("Choose a status.");
  if (SUPERVISOR_ONLY.includes(input.to) && !(await canSeeCost(ctx.ops, actor))) return fail("Only procurement or admin can mark a unit lost or written off.");
  const note = clean(input.note, 200);
  if (NEEDS_NOTE.includes(input.to) && !note) return fail(input.to === "demo_deployed" ? "Write where the demo unit goes (brand, store or person)." : "Add a note saying why.");
  let hub = unit.hub;
  if (input.to === "transfer_in_transit" || unit.status === "transfer_in_transit") {
    const hubs = await activeNames(ctx, "hub");
    if (!input.hub || !hubs.includes(input.hub)) return fail("Choose the hub.");
    if (input.to === "transfer_in_transit" && input.hub === unit.hub) return fail("It's already at that hub.");
    if (unit.status === "transfer_in_transit") hub = input.hub;
  }
  const text =
    input.to === "transfer_in_transit"
      ? `Moving from ${unit.hub ?? "?"} to ${input.hub}.${note ? ` ${note}` : ""}`
      : unit.status === "transfer_in_transit"
        ? `Arrived at ${hub}.${note ? ` ${note}` : ""}`
        : input.to === "demo_deployed"
          ? `Out as a demo: ${note}.`
          : `${UNIT_STATUS_LABELS[input.to]}.${note ? ` ${note}` : ""}`;
  const error = await moveUnit(ctx, unit, input.to, { actor, refType: "unit", refId: unit.id, patch: { hub, ...(input.to === "transfer_in_transit" ? { remark: `To ${input.hub}` } : {}) }, text });
  if (error) return fail(error);
  return { ok: true, value: unit, message: `${unit.serial}: ${text}` };
}

// ── Phase 4: stock counts ────────────────────────────────────────────────────

export async function startCount(ctx: Wms, hub: string, actor: Actor, now = new Date()): Promise<Result<StockCount>> {
  if (!(await canAct(ctx.ops, actor, "inventory"))) return fail("Only the warehouse can count stock.");
  if (!(await activeNames(ctx, "hub")).includes(hub)) return fail("Choose the hub.");
  const open = (await ctx.wms.listRecords("count", { status: "open" })).find((c) => c.hub === hub);
  if (open) return { ok: true, value: open, message: `${open.number} is already open for ${hub}.` };
  const count: StockCount = { number: pad("CNT", await ctx.wms.nextNumber("count")), hub, status: "open", scans: [], result: null, createdAt: now.toISOString(), createdBy: actor.name, closedAt: null, closedBy: null };
  await ctx.wms.saveRecord("count", count);
  return { ok: true, value: count, message: `${count.number} started for ${hub}. Scan every unit you find.` };
}

export async function countScan(ctx: Wms, number: string, serial: string, actor: Actor): Promise<Result<{ known: boolean; total: number }>> {
  if (!(await canAct(ctx.ops, actor, "inventory"))) return fail("Only the warehouse can count stock.");
  const count = await ctx.wms.getRecord("count", number);
  if (!count || count.status !== "open") return fail("This count is closed.");
  const norm = normalizeSerial(serial);
  if (!norm) return fail("The scan was empty.");
  if (count.scans.includes(norm)) return fail("Already counted.");
  count.scans.push(norm);
  await ctx.wms.saveRecord("count", count);
  const known = (await ctx.wms.unitsBySerial(norm)).length > 0;
  return { ok: true, value: { known, total: count.scans.length }, message: known ? "Counted." : "Counted. This serial isn't in the records: it shows as “not in records” at the end." };
}

/** Compares what was found with what should be at the hub. Blind: nobody sees the expected list before this. */
export async function finishCount(ctx: Wms, number: string, actor: Actor, now = new Date()): Promise<Result<StockCount>> {
  if (!(await canAct(ctx.ops, actor, "inventory"))) return fail("Only the warehouse can count stock.");
  const count = await ctx.wms.getRecord("count", number);
  if (!count || count.status !== "open") return fail("This count is closed.");
  const expected = (await ctx.wms.listUnits({ statuses: ["available", "open_box_available", "quarantine", "reserved", "received", "return_received", "defective", "damaged", "rtv_pending"] })).filter((u) => (u.hub ?? "") === count.hub);
  const found = new Set(count.scans);
  const seen = await ctx.wms.unitsBySerials(count.scans);
  count.result = {
    expected: expected.length,
    found: count.scans.length,
    missing: expected.filter((u) => !found.has(u.serialNorm)).map((u) => u.id),
    unexpected: count.scans.filter((n) => !seen.some((u) => u.serialNorm === n || u.altIds.includes(n))),
    elsewhere: seen.filter((u) => found.has(u.serialNorm) && !expected.some((e) => e.id === u.id)).map((u) => u.id),
  };
  count.status = "closed";
  count.closedAt = now.toISOString();
  count.closedBy = actor.name;
  await ctx.wms.saveRecord("count", count);
  const r = count.result;
  return { ok: true, value: count, message: `${number}: ${r.found} found of ${r.expected} expected. ${r.missing.length} missing, ${r.elsewhere.length} found here but recorded elsewhere, ${r.unexpected.length} not in records.` };
}

/** Fixes a closed count: units recorded at another hub move here; missing ones are marked lost (procurement or admin). */
export async function settleCount(ctx: Wms, number: string, input: { moveHere: boolean; markLost: boolean; note: string | null }, actor: Actor): Promise<Result<StockCount>> {
  const count = await ctx.wms.getRecord("count", number);
  if (!count?.result) return fail("Finish the count first.");
  const note = clean(input.note, 200);
  let moved = 0;
  let lost = 0;
  if (input.moveHere) {
    if (!(await canAct(ctx.ops, actor, "inventory"))) return fail("Only the warehouse can fix a count.");
    for (const id of count.result.elsewhere) {
      const u = await ctx.wms.getUnit(id);
      if (!u || !isOnHand(u.status) || u.hub === count.hub) continue;
      await ctx.wms.updateUnit(u.id, { hub: count.hub });
      await ctx.wms.addUnitEvents([{ unitId: u.id, at: new Date().toISOString(), by: actor.name, kind: "note", fromStatus: null, toStatus: null, refType: "count", refId: number, text: `Found at ${count.hub} in count ${number} (was recorded at ${u.hub ?? "no hub"}).` }]);
      moved++;
    }
  }
  if (input.markLost) {
    if (!(await canSeeCost(ctx.ops, actor))) return fail("Only procurement or admin can mark units lost.");
    if (!note) return fail("Write what was checked before marking units lost.");
    for (const id of count.result.missing) {
      const u = await ctx.wms.getUnit(id);
      if (!u || !canMove(u.status, "lost")) continue;
      const error = await moveUnit(ctx, u, "lost", { actor, refType: "count", refId: number, text: `Not found in count ${number}: marked lost. ${note}` });
      if (!error) lost++;
    }
  }
  return { ok: true, value: count, message: `${number}: ${moved} moved to ${count.hub}, ${lost} marked lost.` };
}

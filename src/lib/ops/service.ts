import { isoDateInIst } from "@/lib/format";
import { formatInrFromMinor } from "@/lib/format";
import type { OpsStore } from "@/lib/ops/store";
import {
  OPEN_STAGES,
  ROLES,
  STAGE_LABELS,
  type NewOrderInput,
  type OrderDetail,
  type OrderLine,
  type OrderStage,
  type PaymentKind,
  type Person,
  type Role,
} from "@/lib/ops/types";

/** Who pressed the button. `slackUserId` is null for the dashboard. */
export type Actor = { name: string; slackUserId: string | null };

export type Result<T = OrderDetail> = { ok: true; value: T; message: string } | { ok: false; error: string };

const DAY = 24 * 60 * 60 * 1000;

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

async function done(store: OpsStore, orderId: string, message: string): Promise<Result> {
  const order = await store.getOrder(orderId);
  if (!order) return fail("Order not found.");
  return { ok: true, value: order, message };
}

async function log(store: OpsStore, orderId: string, actor: Actor, type: string, summary: string, lineId: string | null = null) {
  await store.appendEvent({ orderId, lineId, type, actor: actor.name, summary });
}

/** Everyone can act while the roles table is empty, so a fresh setup is not locked out. */
export async function canAct(store: OpsStore, actor: Actor, role: Role): Promise<boolean> {
  if (!actor.slackUserId) return true;
  const people = await store.people();
  if (!people.length) return true;
  const person = people.find((p) => p.slackUserId === actor.slackUserId);
  if (!person) return false;
  return person.roles.includes(role) || person.roles.includes("admin");
}

export function parseRoles(raw: string): Role[] {
  return raw
    .split(/[,\s]+/)
    .map((r) => r.trim().toLowerCase())
    .filter((r): r is Role => (ROLES as readonly string[]).includes(r));
}

export async function savePerson(store: OpsStore, person: Person): Promise<void> {
  await store.upsertPerson(person);
}

// ── Stage calculation ────────────────────────────────────────────────────────

/** After inventory decisions, the order stage follows from its lines. */
export function stageFromLines(lines: OrderLine[]): OrderStage {
  const live = lines.filter((l) => l.status !== "cancelled");
  if (!live.length) return "cancelled";
  if (live.every((l) => l.status === "rejected")) return "on_hold";
  if (live.some((l) => l.status === "pending")) return "awaiting_inventory";
  if (live.some((l) => l.status === "awaiting_po" || l.status === "procuring")) return "awaiting_stock";
  return "ready_to_dispatch";
}

async function settleStage(store: OpsStore, orderId: string): Promise<OrderStage | null> {
  const order = await store.getOrder(orderId);
  if (!order) return null;
  if (!["awaiting_inventory", "awaiting_stock", "on_hold"].includes(order.stage)) return order.stage;
  const next = stageFromLines(order.lines);
  if (next !== order.stage) await store.updateOrder(orderId, { stage: next, holdReason: next === "on_hold" ? "Every product was rejected by inventory." : null });
  return next;
}

// ── 1. Sale ──────────────────────────────────────────────────────────────────

export function validateNewOrder(input: NewOrderInput): string | null {
  if (!input.customerName.trim()) return "Customer name is required.";
  if (!input.lines.length) return "Add at least one product.";
  if (input.phone && !/^\+?\d[\d\s-]{8,14}$/.test(input.phone.trim())) return "Phone number looks wrong.";
  for (const line of input.lines) {
    if (!line.productName.trim()) return "Every product needs a name.";
    if (!Number.isFinite(line.offeredPriceMinor) || line.offeredPriceMinor <= 0) return "Every product needs an offered price.";
    if (line.offeredPriceMinor > 1_000_000_000) return "Offered price is above ₹1 crore. Check the number.";
  }
  return null;
}

export async function createOrder(store: OpsStore, input: NewOrderInput, actor: Actor): Promise<Result> {
  const problem = validateNewOrder(input);
  if (problem) return fail(problem);
  const lines = await Promise.all(
    input.lines.map(async (line) => {
      if (!line.sku) return line;
      const product = await store.getProduct(line.sku);
      return { ...line, productName: product?.name ?? line.productName, listPriceMinor: line.listPriceMinor ?? product?.listPriceMinor ?? null };
    }),
  );
  const order = await store.insertOrder({ ...input, lines, stage: input.stage ?? "awaiting_payment" });
  if (!order.events.length) {
    const total = formatInrFromMinor(order.offeredTotalMinor);
    await log(store, order.id, actor, "created", `Sale posted by ${input.poc ?? actor.name}: ${order.lines.length} product(s), ${total}.`);
  }
  return done(store, order.id, `Order ${order.id} created.`);
}

// ── 2. RevOps ────────────────────────────────────────────────────────────────

export async function recordPayment(
  store: OpsStore,
  orderId: string,
  input: { amountMinor: number; mode: string; kind: PaymentKind; reference: string | null; clear: boolean; codDueMinor?: number | null },
  actor: Actor,
): Promise<Result> {
  if (!(await canAct(store, actor, "revops"))) return fail("Only RevOps can verify payments.");
  const order = await store.getOrder(orderId);
  if (!order) return fail("Order not found.");
  if (order.stage === "cancelled") return fail("This order is cancelled.");
  if (!Number.isFinite(input.amountMinor) || input.amountMinor <= 0) return fail("Enter the amount received.");
  if (!input.mode) return fail("Choose the payment mode.");
  await store.insertPayment({ orderId, amountMinor: input.amountMinor, mode: input.mode, kind: input.kind, reference: input.reference, status: "verified", recordedBy: actor.name });
  const paid = order.paidMinor + input.amountMinor;
  const balance = Math.max(0, order.offeredTotalMinor - paid);
  const codDue = input.codDueMinor != null ? Math.max(0, input.codDueMinor) : balance;
  await store.updateOrder(orderId, { paidMinor: paid, codDueMinor: codDue });
  const ref = input.reference ? ` (ref ${input.reference})` : "";
  await log(store, orderId, actor, "payment_verified", `${formatInrFromMinor(input.amountMinor)} ${input.kind} by ${input.mode}${ref} verified. Balance ${formatInrFromMinor(balance)}.`);
  if (input.clear && order.stage === "awaiting_payment") {
    await store.updateOrder(orderId, { stage: "awaiting_inventory" }, "awaiting_payment");
    await log(store, orderId, actor, "stage", `Cleared for fulfilment. Sent to inventory.`);
  }
  return done(store, orderId, input.clear ? "Payment verified. Sent to inventory." : "Payment recorded.");
}

/** RevOps can release an order without money in hand, e.g. approved finance or a trusted repeat customer. */
export async function clearForFulfilment(store: OpsStore, orderId: string, reason: string, actor: Actor): Promise<Result> {
  if (!(await canAct(store, actor, "revops"))) return fail("Only RevOps can clear an order.");
  if (!reason.trim()) return fail("Say why the order is cleared without a payment.");
  const order = await store.getOrder(orderId);
  if (!order) return fail("Order not found.");
  const moved = await store.updateOrder(orderId, { stage: "awaiting_inventory", codDueMinor: Math.max(0, order.offeredTotalMinor - order.paidMinor) }, "awaiting_payment");
  if (!moved) return fail(`This order is at “${STAGE_LABELS[order.stage]}”, not payment check.`);
  await log(store, orderId, actor, "stage", `Cleared without payment: ${reason.trim()}`);
  return done(store, orderId, "Cleared. Sent to inventory.");
}

// ── 3. Inventory ─────────────────────────────────────────────────────────────

export type LineDecision =
  | { type: "reserve" }
  | { type: "hold_po"; poId: string }
  | { type: "procure"; vendor: string; costMinor: number | null; eta: string | null }
  | { type: "brand_direct" }
  | { type: "reject"; reason: string };

export async function decideLine(store: OpsStore, lineId: string, decision: LineDecision, actor: Actor): Promise<Result> {
  if (!(await canAct(store, actor, "inventory"))) return fail("Only the inventory team can decide stock.");
  const line = await store.getLine(lineId);
  if (!line) return fail("Product line not found.");
  const order = await store.getOrder(line.orderId);
  if (!order) return fail("Order not found.");
  if (order.stage === "awaiting_payment") return fail("RevOps has not cleared this order yet.");
  if (!["awaiting_inventory", "awaiting_stock", "on_hold"].includes(order.stage)) return fail(`This order is at “${STAGE_LABELS[order.stage]}”. Stock can no longer be changed.`);
  if (!["pending", "rejected", "awaiting_po", "procuring"].includes(line.status)) return fail(`This product is already ${line.status.replace("_", " ")}.`);
  const label = `${line.productName}${line.sku ? ` (${line.sku})` : ""}`;
  if (line.status === "procuring" && line.procurementId && decision.type !== "procure") {
    await store.updateProcurement(line.procurementId, { status: "cancelled" }, ["requested", "ordered"]);
  }

  switch (decision.type) {
    case "reserve": {
      const result = await store.reserveLine(lineId);
      if (result === "no_sku") return fail("This product has no SKU. Map it to a SKU before reserving.");
      if (result === "insufficient") {
        const level = line.sku ? await store.stockFor(line.sku) : null;
        return fail(`Not enough free stock for ${label}. Available ${level?.available ?? 0}.`);
      }
      if (result === "missing") return fail("Product line not found.");
      await log(store, order.id, actor, "reserved", `Reserved ${line.qty} × ${label} from stock.`, lineId);
      break;
    }
    case "hold_po": {
      const po = await store.getPurchaseOrder(decision.poId);
      if (!po || po.status !== "open") return fail("That purchase order is not open.");
      if (line.sku && po.sku !== line.sku) return fail("That purchase order is for a different SKU.");
      await store.updateLine(lineId, { status: "awaiting_po", poId: po.id });
      await log(store, order.id, actor, "held_on_po", `${label} held on ${po.poNumber}${po.eta ? `, ETA ${po.eta}` : ""}.`, lineId);
      break;
    }
    case "procure": {
      if (!decision.vendor.trim()) return fail("Enter the vendor.");
      const request = await store.insertProcurement({
        orderId: order.id,
        lineId,
        sku: line.sku,
        productName: line.productName,
        vendor: decision.vendor.trim(),
        costMinor: decision.costMinor,
        eta: decision.eta,
        status: "requested",
        poNumber: null,
      });
      await store.updateLine(lineId, { status: "procuring", procurementId: request.id, poId: null });
      await log(store, order.id, actor, "procurement_requested", `Procure ${label} from ${request.vendor}${request.eta ? `, ETA ${request.eta}` : ""}.`, lineId);
      break;
    }
    case "brand_direct": {
      await store.updateLine(lineId, { status: "brand_direct", poId: null });
      await log(store, order.id, actor, "brand_direct", `${label} will be shipped by the brand directly.`, lineId);
      break;
    }
    case "reject": {
      if (!decision.reason.trim()) return fail("Give a reason for rejecting.");
      await store.updateLine(lineId, { status: "rejected", rejectReason: decision.reason.trim() });
      await log(store, order.id, actor, "rejected", `${label} rejected: ${decision.reason.trim()}`, lineId);
      break;
    }
  }
  const stage = await settleStage(store, order.id);
  return done(store, order.id, stage ? `Now ${STAGE_LABELS[stage].toLowerCase()}.` : "Saved.");
}

/** Map a free-text product to a catalogue SKU so stock can be checked. */
export async function setLineSku(store: OpsStore, lineId: string, sku: string, actor: Actor): Promise<Result> {
  if (!(await canAct(store, actor, "inventory"))) return fail("Only the inventory team can map SKUs.");
  const line = await store.getLine(lineId);
  if (!line) return fail("Product line not found.");
  if (line.status !== "pending" && line.status !== "rejected") return fail("Change the SKU only before stock is decided.");
  const product = await store.getProduct(sku);
  if (!product) return fail(`SKU ${sku} is not in the catalogue.`);
  await store.updateLine(lineId, { sku: product.sku, productName: product.name });
  await log(store, line.orderId, actor, "sku_mapped", `“${line.productName}” mapped to ${product.sku}.`, lineId);
  return done(store, line.orderId, "SKU saved.");
}

// ── Procurement ──────────────────────────────────────────────────────────────

export async function markProcurementOrdered(store: OpsStore, requestId: string, input: { poNumber: string | null; eta: string | null }, actor: Actor): Promise<Result> {
  if (!(await canAct(store, actor, "procurement"))) return fail("Only procurement can update this.");
  const request = await store.getProcurement(requestId);
  if (!request) return fail("Procurement request not found.");
  const ok = await store.updateProcurement(requestId, { status: "ordered", poNumber: input.poNumber, eta: input.eta ?? request.eta }, ["requested", "ordered"]);
  if (!ok) return fail("This request is already closed.");
  await log(store, request.orderId, actor, "procurement_ordered", `${request.productName} ordered from ${request.vendor}${input.poNumber ? ` on ${input.poNumber}` : ""}${input.eta ? `, ETA ${input.eta}` : ""}.`, request.lineId);
  return done(store, request.orderId, "Marked ordered.");
}

/** Goods arrived for one customer: add stock, reserve it for that line, and move the order on. */
export async function receiveProcurement(store: OpsStore, requestId: string, input: { serialNo: string | null; unitCostMinor: number | null }, actor: Actor): Promise<Result> {
  if (!(await canAct(store, actor, "inventory")) && !(await canAct(store, actor, "procurement"))) return fail("Only inventory or procurement can receive goods.");
  const request = await store.getProcurement(requestId);
  if (!request) return fail("Procurement request not found.");
  const line = await store.getLine(request.lineId);
  if (!line) return fail("Product line not found.");
  if (!line.sku) return fail("Map this product to a SKU before receiving it.");
  const claimed = await store.updateProcurement(requestId, { status: "received" }, ["requested", "ordered"]);
  if (!claimed) return fail("This request was already received or cancelled.");
  await store.addMovement({ sku: line.sku, qty: line.qty, kind: "inward", refType: "procurement", refId: requestId, serialNo: input.serialNo, unitCostMinor: input.unitCostMinor ?? request.costMinor, note: `For ${request.orderId}`, actor: actor.name });
  await store.updateLine(line.id, { status: "pending" });
  const result = await store.reserveLine(line.id);
  await log(store, request.orderId, actor, "goods_received", `${line.productName} received from ${request.vendor}${result === "ok" ? " and reserved" : ""}.`, line.id);
  await settleStage(store, request.orderId);
  return done(store, request.orderId, "Received and reserved.");
}

/** Brand PO arrived (fully or partly). Lines held on this PO are reserved oldest first. */
export async function receivePurchaseOrder(store: OpsStore, poId: string, input: { qty: number; serials: string[]; unitCostMinor: number | null }, actor: Actor): Promise<Result<{ reserved: string[] }>> {
  if (!(await canAct(store, actor, "inventory"))) return fail("Only inventory can receive goods.");
  const po = await store.getPurchaseOrder(poId);
  if (!po || po.status !== "open") return fail("Purchase order is not open.");
  const pending = po.qtyOrdered - po.qtyReceived;
  if (!Number.isInteger(input.qty) || input.qty <= 0 || input.qty > pending) return fail(`Receive between 1 and ${pending} units.`);
  for (let i = 0; i < input.qty; i += 1) {
    await store.addMovement({ sku: po.sku, qty: 1, kind: "inward", refType: "po", refId: po.poNumber, serialNo: input.serials[i] ?? null, unitCostMinor: input.unitCostMinor, note: po.vendor, actor: actor.name });
  }
  const received = po.qtyReceived + input.qty;
  await store.updatePurchaseOrder(poId, { qtyReceived: received, status: received >= po.qtyOrdered ? "closed" : "open" });
  const waiting = (await store.linesWaitingOnPo(poId)).sort((a, b) => a.orderId.localeCompare(b.orderId));
  const reserved: string[] = [];
  for (const line of waiting) {
    await store.updateLine(line.id, { status: "pending" });
    const result = await store.reserveLine(line.id);
    if (result !== "ok") {
      await store.updateLine(line.id, { status: "awaiting_po", poId });
      continue;
    }
    reserved.push(line.orderId);
    await log(store, line.orderId, actor, "reserved", `${line.productName} reserved from ${po.poNumber} on arrival.`, line.id);
    await settleStage(store, line.orderId);
  }
  return { ok: true, value: { reserved }, message: `${input.qty} received on ${po.poNumber}.${reserved.length ? ` Reserved for ${reserved.join(", ")}.` : ""}` };
}

// ── 4. Logistics ─────────────────────────────────────────────────────────────

export async function outForDelivery(store: OpsStore, orderId: string, input: { driver: string; serials: Record<string, string>; expectedDate: string | null }, actor: Actor): Promise<Result> {
  if (!(await canAct(store, actor, "logistics"))) return fail("Only logistics can dispatch.");
  if (!input.driver.trim()) return fail("Enter who is delivering.");
  const order = await store.getOrder(orderId);
  if (!order) return fail("Order not found.");
  const moved = await store.updateOrder(orderId, { stage: "out_for_delivery", driver: input.driver.trim(), dispatchedAt: new Date().toISOString(), expectedDeliveryDate: input.expectedDate }, "ready_to_dispatch");
  if (!moved) return fail(`This order is at “${STAGE_LABELS[order.stage]}”, not ready to dispatch.`);
  for (const line of order.lines) {
    if (line.status !== "reserved") continue;
    const serial = input.serials[line.id]?.trim() || null;
    await store.consumeReservation(line.id);
    await store.addMovement({ sku: line.sku!, qty: -line.qty, kind: "dispatch", refType: "order", refId: orderId, serialNo: serial, unitCostMinor: null, note: input.driver.trim(), actor: actor.name });
    await store.updateLine(line.id, { status: "dispatched", serialNo: serial });
  }
  await log(store, orderId, actor, "out_for_delivery", `Out for delivery with ${input.driver.trim()}.${order.codDueMinor ? ` Collect ${formatInrFromMinor(order.codDueMinor)}.` : ""}`);
  return done(store, orderId, "Out for delivery.");
}

export async function markDelivered(store: OpsStore, orderId: string, input: { collectedMinor: number; mode: string | null }, actor: Actor, now = new Date()): Promise<Result> {
  if (!(await canAct(store, actor, "logistics"))) return fail("Only logistics can mark delivered.");
  const order = await store.getOrder(orderId);
  if (!order) return fail("Order not found.");
  const moved = await store.updateOrder(orderId, { stage: "delivered", deliveredAt: now.toISOString() }, "out_for_delivery");
  if (!moved) return fail(`This order is at “${STAGE_LABELS[order.stage]}”, not out for delivery.`);
  if (input.collectedMinor > 0) {
    await store.insertPayment({ orderId, amountMinor: input.collectedMinor, mode: input.mode ?? "Cash", kind: "cod", reference: null, status: "verified", recordedBy: actor.name });
    await store.updateOrder(orderId, { paidMinor: order.paidMinor + input.collectedMinor, codDueMinor: Math.max(0, order.codDueMinor - input.collectedMinor) });
  }
  for (const line of order.lines) {
    if (line.status === "brand_direct") await store.updateLine(line.id, { status: "dispatched" });
    if (line.status === "cancelled" || line.status === "rejected") continue;
    const product = line.sku ? await store.getProduct(line.sku) : null;
    const wantsInstall = product?.needsInstallation || /^added$/i.test(line.installation ?? "");
    if (!wantsInstall) continue;
    await store.insertInstallation({
      orderId,
      lineId: line.id,
      sku: line.sku,
      productName: line.productName,
      customerName: order.customerName,
      phone: order.phone,
      address: order.shippingAddress,
      status: "pending",
      dueDate: isoDateInIst(new Date(now.getTime() + DAY)),
      doneAt: null,
      technician: null,
      note: null,
    });
  }
  await log(store, orderId, actor, "delivered", `Delivered.${input.collectedMinor ? ` Collected ${formatInrFromMinor(input.collectedMinor)}.` : ""}`);
  return done(store, orderId, "Delivered.");
}

export async function completeInstallation(store: OpsStore, installationId: string, input: { technician: string; note: string | null; notRequired?: boolean }, actor: Actor): Promise<Result<null>> {
  if (!(await canAct(store, actor, "installation")) && !(await canAct(store, actor, "logistics"))) return fail("Only installation or logistics can close this.");
  const all = await store.listInstallations({ status: "all" });
  const item = all.find((i) => i.id === installationId);
  if (!item) return fail("Installation not found.");
  if (item.status !== "pending") return fail("This installation is already closed.");
  await store.updateInstallation(installationId, { status: input.notRequired ? "not_required" : "done", doneAt: new Date().toISOString(), technician: input.technician.trim() || actor.name, note: input.note });
  await log(store, item.orderId, actor, "installation", input.notRequired ? `Installation not required for ${item.productName}.` : `${item.productName} installed by ${input.technician.trim() || actor.name}.`, item.lineId);
  return { ok: true, value: null, message: "Installation closed." };
}

// ── Any stage ────────────────────────────────────────────────────────────────

export async function cancelOrder(store: OpsStore, orderId: string, reason: string, actor: Actor): Promise<Result> {
  if (!reason.trim()) return fail("Give a reason for cancelling.");
  const order = await store.getOrder(orderId);
  if (!order) return fail("Order not found.");
  if (!(await canAct(store, actor, "revops")) && !(await canAct(store, actor, "sales"))) return fail("Only sales or RevOps can cancel.");
  const cancellable = OPEN_STAGES.filter((s) => s !== "out_for_delivery");
  const moved = await store.updateOrder(orderId, { stage: "cancelled", cancelReason: reason.trim() }, cancellable);
  if (!moved) return fail(`An order at “${STAGE_LABELS[order.stage]}” cannot be cancelled here.`);
  for (const line of order.lines) {
    await store.releaseReservation(line.id);
    if (line.procurementId) await store.updateProcurement(line.procurementId, { status: "cancelled" }, ["requested", "ordered"]);
    await store.updateLine(line.id, { status: "cancelled" });
  }
  await log(store, orderId, actor, "cancelled", `Cancelled: ${reason.trim()}. Reserved stock released.`);
  return done(store, orderId, "Order cancelled.");
}

export async function setShopifyId(store: OpsStore, orderId: string, shopifyId: string, actor: Actor): Promise<Result> {
  const clean = shopifyId.trim().replace(/^PIK/i, "#PIK");
  if (!/^#?PIK\d{3,}$/i.test(clean)) return fail("Shopify order numbers look like #PIK3918.");
  const value = clean.startsWith("#") ? clean.toUpperCase() : `#${clean.toUpperCase()}`;
  const ok = await store.updateOrder(orderId, { shopifyOrderId: value });
  if (!ok) return fail("Order not found.");
  await log(store, orderId, actor, "shopify", `Linked to Shopify ${value}.`);
  return done(store, orderId, `Linked to ${value}.`);
}

export async function addNote(store: OpsStore, orderId: string, note: string, actor: Actor): Promise<Result> {
  if (!note.trim()) return fail("Write a note.");
  const order = await store.getOrder(orderId);
  if (!order) return fail("Order not found.");
  await log(store, orderId, actor, "note", note.trim().slice(0, 500));
  return done(store, orderId, "Note added.");
}

/** What the next step is and who owns it. Used by Slack cards, the dashboard, and the assistant. */
export function nextStep(order: OrderDetail): string {
  switch (order.stage) {
    case "awaiting_payment":
      return "RevOps: verify the payment against the bank.";
    case "awaiting_inventory": {
      const pending = order.lines.filter((l) => l.status === "pending").length;
      return `Inventory: decide stock for ${pending} product${pending === 1 ? "" : "s"}.`;
    }
    case "awaiting_stock":
      return "Procurement: goods are on order. Receive them when they arrive.";
    case "ready_to_dispatch":
      return "Logistics: assign a delivery person and dispatch.";
    case "out_for_delivery":
      return order.codDueMinor ? `Logistics: deliver and collect ${formatInrFromMinor(order.codDueMinor)}.` : "Logistics: confirm delivery.";
    case "on_hold":
      return `Sales: ${order.holdReason ?? "resolve the hold"}`;
    case "delivered":
      return order.installations.some((i) => i.status === "pending") ? "Installation: install at the customer." : "Done.";
    case "cancelled":
      return "Cancelled.";
  }
}

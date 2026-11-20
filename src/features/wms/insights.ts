// Warehouse numbers: replenishment (phase 4), the daily movement report (phase 2), the management dashboard (phase 4)
// and the switch-over from the team sheet (phase 5). Reads only, except `createOpeningUnits`.

import { randomUUID } from "node:crypto";
import { canAct, type Actor, type Result } from "@/lib/ops/service";
import type { StockLevel, StockMovement } from "@/lib/ops/types";
import { internalSerial, isInternalSerial, normalizeSerial } from "./domain/serial";
import { ageBucket, AGE_BUCKETS, reorderRow, REORDER, type ReorderOut, type ReorderStatus } from "./domain/replenish";
import { stockTotals, unitStock } from "./domain/stock";
import type { WmsUnit } from "./domain/types";
import { isOnHand, ON_HAND, TERMINAL } from "./domain/unit";
import { rmaNetCost } from "./flows";
import { canSeeCost, listPos, type Wms } from "./service";

const DAY = 86_400_000;
const istDayStart = (date: string) => new Date(`${date}T00:00:00+05:30`);
const istToday = (now: Date) => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);

async function allLevels(ctx: Wms): Promise<StockLevel[]> {
  return ctx.ops.stockLevels({ only: "all", limit: 100_000 });
}

// ── Replenishment ────────────────────────────────────────────────────────────

export type ReorderRowView = ReorderOut & { sku: string; name: string; brand: string | null; channel: string | null; warehouse: number; inTransit: number; sold7: number; sold30: number; costMinor: number | null; reorderValueMinor: number | null };

/** Per product: stock, on the way, sold in 7 and 30 days (customer dispatches, not replacements), cover days and what to order. */
export async function replenishment(ctx: Wms, now = new Date()): Promise<ReorderRowView[]> {
  const [levels, moves] = await Promise.all([allLevels(ctx), ctx.ops.movementsSince(new Date(now.getTime() - 120 * DAY).toISOString(), ["dispatch"], 200_000)]);
  const sold7 = new Map<string, number>();
  const sold30 = new Map<string, number>();
  const last = new Map<string, number>();
  for (const m of moves) {
    if (m.qty >= 0 || m.refType === "replacement") continue;
    const t = new Date(m.createdAt).getTime();
    const units = -m.qty;
    if (now.getTime() - t <= 7 * DAY) sold7.set(m.sku, (sold7.get(m.sku) ?? 0) + units);
    if (now.getTime() - t <= 30 * DAY) sold30.set(m.sku, (sold30.get(m.sku) ?? 0) + units);
    if (t > (last.get(m.sku) ?? 0)) last.set(m.sku, t);
  }
  const rows: ReorderRowView[] = [];
  for (const l of levels) {
    const s30 = sold30.get(l.sku) ?? 0;
    if (l.onHand <= 0 && s30 === 0 && l.incoming <= 0) continue;
    const seen = last.get(l.sku);
    const out = reorderRow({ warehouse: l.available, inTransit: l.incoming, sold7: sold7.get(l.sku) ?? 0, sold30: s30, daysSinceSale: seen ? Math.floor((now.getTime() - seen) / DAY) : null });
    rows.push({ ...out, sku: l.sku, name: l.name, brand: l.brand, channel: l.channel, warehouse: l.available, inTransit: l.incoming, sold7: sold7.get(l.sku) ?? 0, sold30: s30, costMinor: l.unitCostMinor, reorderValueMinor: l.unitCostMinor != null ? out.suggested * l.unitCostMinor : null });
  }
  const order: ReorderStatus[] = ["out_of_stock", "reorder_now", "approaching", "overstock", "dead", "non_moving", "healthy"];
  return rows.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || b.sold30 - a.sold30);
}

// ── Daily movement (replaces the 750-column "In warehouse" tab) ──────────────

export type MovementRow = { sku: string; name: string; opening: number; inward: number; dispatch: number; returns: number; adjust: number; closing: number };

/** For one IST day, per product: opening, in, out, returns, corrections, closing. Closing of a day is the next day's opening. */
export async function dailyMovement(ctx: Wms, date: string, all = false): Promise<MovementRow[]> {
  const start = istDayStart(date);
  const end = new Date(start.getTime() + DAY);
  const [levels, moves] = await Promise.all([allLevels(ctx), ctx.ops.movementsSince(start.toISOString(), ["opening", "inward", "dispatch", "return", "rtv", "adjust"], 500_000)]);
  const after = new Map<string, number>();
  const day = new Map<string, { inward: number; dispatch: number; returns: number; adjust: number }>();
  for (const m of moves) {
    const t = new Date(m.createdAt).getTime();
    if (t >= end.getTime()) {
      after.set(m.sku, (after.get(m.sku) ?? 0) + m.qty);
      continue;
    }
    const d = day.get(m.sku) ?? { inward: 0, dispatch: 0, returns: 0, adjust: 0 };
    const k: StockMovement["kind"] = m.kind;
    if (k === "inward" || k === "opening") d.inward += m.qty;
    else if (k === "dispatch") d.dispatch += -m.qty;
    else if (k === "return") d.returns += m.qty;
    else d.adjust += m.qty;
    day.set(m.sku, d);
  }
  const rows: MovementRow[] = [];
  for (const l of levels) {
    const closing = l.onHand - (after.get(l.sku) ?? 0);
    const d = day.get(l.sku) ?? { inward: 0, dispatch: 0, returns: 0, adjust: 0 };
    const opening = closing - d.inward + d.dispatch - d.returns - d.adjust;
    if (!all && !day.has(l.sku)) continue;
    if (all && !closing && !opening && !day.has(l.sku)) continue;
    rows.push({ sku: l.sku, name: l.name, opening, ...d, closing });
  }
  return rows.sort((a, b) => b.inward + b.dispatch - (a.inward + a.dispatch) || a.name.localeCompare(b.name));
}

// ── Management dashboard ─────────────────────────────────────────────────────

export type Attention = { text: string; href: string; tone: "bad" | "warn" };

export type Dashboard = {
  showCost: boolean;
  units: { onHand: number; available: number; onHold: number; valueMinor: number; noCost: number };
  ledger: { onHand: number; reserved: number; incoming: number; valueMinor: number };
  today: { inward: number; dispatch: number; returns: number };
  health: Record<ReorderStatus, number> & { reorderValueMinor: number; fast: number };
  ageing: Array<{ label: string; units: number; valueMinor: number }>;
  procurement: { openPos: number; overdue: number; expected: number; fillRate: number | null };
  fulfilment: { shipped30: number; delivered30: number; onRoad: number; avgDays: number | null; failed30: number };
  returns: { open: number; netCostMinor: number; avgAgeDays: number | null; rtvValueMinor: number };
  quality: { scanned: number; typed: number; noBarcode: number; opening: number; total: number; noCost: number };
  people: Array<{ name: string; received: number; dispatched: number }>;
  attention: Attention[];
};

export async function dashboard(ctx: Wms, actor: Actor, now = new Date()): Promise<Dashboard> {
  const today = istToday(now);
  const todayStart = istDayStart(today).toISOString();
  const [showCost, units, levels, todayMoves, reorder, pos, shipments, rmas] = await Promise.all([
    canSeeCost(ctx.ops, actor),
    ctx.wms.listUnits({ limit: 100_000 }),
    allLevels(ctx),
    ctx.ops.movementsSince(todayStart, ["inward", "dispatch", "return"], 50_000),
    replenishment(ctx, now),
    listPos(ctx),
    ctx.wms.listRecords("shipment", { limit: 5000 }),
    ctx.wms.listRecords("rma", { limit: 5000 }),
  ]);
  const t = stockTotals(unitStock(units));
  const onHand = units.filter((u) => isOnHand(u.status));

  const health = { out_of_stock: 0, reorder_now: 0, approaching: 0, healthy: 0, overstock: 0, non_moving: 0, dead: 0, reorderValueMinor: 0, fast: 0 };
  for (const r of reorder) {
    health[r.status] += 1;
    if (r.movement === "fast") health.fast += 1;
    if (r.status === "reorder_now" || r.status === "out_of_stock") health.reorderValueMinor += r.reorderValueMinor ?? 0;
  }

  const ageing = AGE_BUCKETS.map((b) => ({ label: b.label, units: 0, valueMinor: 0 }));
  for (const u of onHand) {
    const i = ageBucket(Math.floor((now.getTime() - new Date(u.receivedAt).getTime()) / DAY));
    ageing[i].units += 1;
    ageing[i].valueMinor += u.unitCostMinor ?? 0;
  }

  const open = pos.filter((p) => p.open);
  const closed = pos.filter((p) => !p.open && p.ordered > 0);
  const since30 = now.getTime() - 30 * DAY;
  const recent = shipments.filter((s) => s.kind !== "rtv" && new Date(s.dispatchedAt).getTime() >= since30);
  const delivered = recent.filter((s) => s.deliveredAt);
  const days = delivered.map((s) => (new Date(s.deliveredAt!).getTime() - new Date(s.dispatchedAt).getTime()) / DAY);
  const openRmas = rmas.filter((r) => r.status !== "closed" && r.status !== "rejected");
  let net = 0;
  for (const r of rmas) net += await rmaNetCost(ctx, r);

  const people = new Map<string, { name: string; received: number; dispatched: number }>();
  const person = (name: string) => people.get(name) ?? people.set(name, { name, received: 0, dispatched: 0 }).get(name)!;
  for (const u of units) if (u.serialSource !== "opening" && new Date(u.receivedAt).getTime() >= since30) person(u.receivedBy).received += 1;
  for (const s of recent) person(s.dispatchedBy).dispatched += s.unitIds.length;

  const attention: Attention[] = [];
  const overdue = open.filter((p) => p.eta && p.eta < today);
  if (overdue.length) attention.push({ text: `${overdue.length} PO${overdue.length === 1 ? " is" : "s are"} past the ETA`, href: "/wms/po", tone: "bad" });
  const held = onHand.filter((u) => ["quarantine", "return_received", "received"].includes(u.status) && now.getTime() - new Date(u.updatedAt).getTime() > 3 * DAY);
  if (held.length) attention.push({ text: `${held.length} unit${held.length === 1 ? "" : "s"} waiting for a check for over 3 days`, href: "/wms/units?status=hold", tone: "warn" });
  const stuck = shipments.filter((s) => s.status === "dispatched" && now.getTime() - new Date(s.dispatchedAt).getTime() > 5 * DAY);
  if (stuck.length) attention.push({ text: `${stuck.length} shipment${stuck.length === 1 ? "" : "s"} on the road for over 5 days`, href: "/wms/dispatch#road", tone: "warn" });
  const oldRmas = openRmas.filter((r) => now.getTime() - new Date(r.createdAt).getTime() > 7 * DAY);
  if (oldRmas.length) attention.push({ text: `${oldRmas.length} return${oldRmas.length === 1 ? "" : "s"} open for over a week`, href: "/wms/returns", tone: "warn" });
  if (health.out_of_stock + health.reorder_now) attention.push({ text: `${health.out_of_stock + health.reorder_now} product${health.out_of_stock + health.reorder_now === 1 ? "" : "s"} to reorder now`, href: "/wms/reorder", tone: "bad" });

  return {
    showCost,
    units: showCost ? t : { ...t, valueMinor: 0 },
    ledger: {
      onHand: levels.reduce((s, l) => s + Math.max(0, l.onHand), 0),
      reserved: levels.reduce((s, l) => s + l.reserved, 0),
      incoming: levels.reduce((s, l) => s + Math.max(0, l.incoming), 0),
      valueMinor: showCost ? levels.reduce((s, l) => s + Math.max(0, l.onHand) * (l.unitCostMinor ?? 0), 0) : 0,
    },
    today: {
      inward: todayMoves.filter((m) => m.kind === "inward").reduce((s, m) => s + m.qty, 0),
      dispatch: todayMoves.filter((m) => m.kind === "dispatch").reduce((s, m) => s - m.qty, 0),
      returns: todayMoves.filter((m) => m.kind === "return").reduce((s, m) => s + m.qty, 0),
    },
    health: showCost ? health : { ...health, reorderValueMinor: 0 },
    ageing: showCost ? ageing : ageing.map((a) => ({ ...a, valueMinor: 0 })),
    procurement: {
      openPos: open.length,
      overdue: overdue.length,
      expected: open.reduce((s, p) => s + Math.max(0, p.ordered - p.received), 0),
      fillRate: closed.length ? Math.round((closed.reduce((s, p) => s + Math.min(p.received, p.ordered), 0) / closed.reduce((s, p) => s + p.ordered, 0)) * 100) : null,
    },
    fulfilment: { shipped30: recent.length, delivered30: delivered.length, onRoad: shipments.filter((s) => s.status === "dispatched").length, avgDays: days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : null, failed30: recent.filter((s) => s.status === "failed" || s.status === "returned").length },
    returns: {
      open: openRmas.length,
      netCostMinor: showCost ? net : 0,
      avgAgeDays: openRmas.length ? Math.round(openRmas.reduce((s, r) => s + (now.getTime() - new Date(r.createdAt).getTime()) / DAY, 0) / openRmas.length) : null,
      rtvValueMinor: showCost ? units.filter((u) => u.status === "rtv_pending").reduce((s, u) => s + (u.unitCostMinor ?? 0), 0) : 0,
    },
    quality: {
      scanned: units.filter((u) => u.serialSource === "scan").length,
      typed: units.filter((u) => u.serialSource === "manual").length,
      noBarcode: units.filter((u) => u.serialSource === "internal").length,
      opening: units.filter((u) => u.serialSource === "opening").length,
      total: units.length,
      noCost: onHand.filter((u) => u.unitCostMinor == null).length,
    },
    people: [...people.values()].sort((a, b) => b.received + b.dispatched - (a.received + a.dispatched)).slice(0, 12),
    attention,
  };
}

// ── Switch-over from the team sheet (phase 5) ────────────────────────────────

export type OpeningRow = { sku: string; name: string; onHand: number; serials: string[]; placeholders: number; costMinor: number | null; alreadyUnits: number };
export type OpeningPlan = { rows: OpeningRow[]; units: number; withSerial: number; placeholders: number; valueMinor: number; duplicates: Array<{ serial: string; skus: string[] }>; negative: Array<{ sku: string; onHand: number }> };

/**
 * What the switch-over would create: one unit per unit the ledger says is in stock today (the team sheet's stock),
 * with its serial when the sheet had one, and an EPIK label (to check) when it didn't. Units already in the
 * warehouse screens are left alone, so running it twice adds nothing.
 */
export async function openingPlan(ctx: Wms): Promise<OpeningPlan> {
  const levels = (await allLevels(ctx)).filter((l) => l.onHand !== 0);
  const units = await ctx.wms.listUnits({ limit: 200_000 });
  const live = units.filter((u) => !TERMINAL.includes(u.status));
  const rows: OpeningRow[] = [];
  const serialSkus = new Map<string, Set<string>>();
  const negative: OpeningPlan["negative"] = [];
  for (const l of levels) {
    if (l.onHand < 0) {
      negative.push({ sku: l.sku, onHand: l.onHand });
      continue;
    }
    const moves = await ctx.ops.listMovements(l.sku, 20_000);
    const net = new Map<string, { qty: number; cost: number | null; raw: string }>();
    for (const m of [...moves].reverse()) {
      if (!m.serialNo) continue;
      const norm = normalizeSerial(m.serialNo);
      if (!norm) continue;
      const cur = net.get(norm) ?? { qty: 0, cost: null, raw: m.serialNo };
      cur.qty += m.qty > 0 ? 1 : -1;
      if (m.qty > 0 && m.unitCostMinor != null) cur.cost = m.unitCostMinor;
      net.set(norm, cur);
    }
    const inStock = [...net.entries()].filter(([, v]) => v.qty > 0);
    for (const [norm] of inStock) serialSkus.set(norm, (serialSkus.get(norm) ?? new Set()).add(l.sku));
    const mine = live.filter((u) => u.sku === l.sku && isOnHand(u.status));
    const have = new Set(mine.map((u) => u.serialNorm));
    const serials = inStock.filter(([norm]) => !have.has(norm)).map(([, v]) => v.raw).slice(0, Math.max(0, l.onHand - mine.length));
    const placeholders = Math.max(0, l.onHand - Math.min(l.onHand, inStock.length) - mine.filter((u) => u.serialSource === "opening" && isInternalSerial(u.serial)).length);
    if (!serials.length && !placeholders) continue;
    rows.push({ sku: l.sku, name: l.name, onHand: l.onHand, serials, placeholders, costMinor: l.unitCostMinor, alreadyUnits: mine.length });
  }
  const duplicates = [...serialSkus.entries()].filter(([, s]) => s.size > 1).map(([serial, s]) => ({ serial, skus: [...s] }));
  const withSerial = rows.reduce((s, r) => s + r.serials.length, 0);
  const placeholders = rows.reduce((s, r) => s + r.placeholders, 0);
  return {
    rows: rows.sort((a, b) => b.serials.length + b.placeholders - (a.serials.length + a.placeholders)),
    units: withSerial + placeholders,
    withSerial,
    placeholders,
    valueMinor: rows.reduce((s, r) => s + (r.serials.length + r.placeholders) * (r.costMinor ?? 0), 0),
    duplicates,
    negative,
  };
}

/** Creates the opening units. Stock numbers don't change (the ledger already has this stock); units just get records. */
export async function createOpeningUnits(ctx: Wms, actor: Actor, now = new Date()): Promise<Result<{ created: number }>> {
  if (!(await canAct(ctx.ops, actor, "admin"))) return fail("Only admin can run the switch-over.");
  const plan = await openingPlan(ctx);
  const dupes = new Set(plan.duplicates.map((d) => d.serial));
  const at = now.toISOString();
  const total = plan.placeholders;
  let next = total ? await ctx.wms.nextNumber("internal_serial", total) : 0;
  const batch: WmsUnit[] = [];
  for (const r of plan.rows) {
    const base = { sku: r.sku, altIds: [], status: "available" as const, condition: "good" as const, hub: "HSR HQ", ownership: null, billedTo: null, unitCostMinor: r.costMinor, gstRate: null, poNumber: null, grnNumber: null, vendor: null, invoiceNo: null, photos: [], receivedAt: at, receivedBy: "Opening stock", updatedAt: at, serialSource: "opening" as const };
    for (const serial of r.serials) {
      if (dupes.has(normalizeSerial(serial))) continue;
      batch.push({ ...base, id: randomUUID(), serial, serialNorm: normalizeSerial(serial), remark: "Opening stock from the team sheet" });
    }
    for (let i = 0; i < r.placeholders; i++) {
      const serial = internalSerial(next++);
      batch.push({ ...base, id: randomUUID(), serial, serialNorm: normalizeSerial(serial), remark: "Opening stock: the sheet had no serial. Check the box and relabel." });
    }
  }
  for (let i = 0; i < batch.length; i += 500) {
    const chunk = batch.slice(i, i + 500);
    await ctx.wms.insertUnits(chunk);
    await ctx.wms.addUnitEvents(chunk.map((u) => ({ unitId: u.id, at, by: actor.name, kind: "received" as const, fromStatus: null, toStatus: u.status, refType: "opening", refId: null, text: isInternalSerial(u.serial) ? "Opening stock. The team sheet had no serial for it: EPIK label given, check the box." : "Opening stock, from the team sheet." })));
  }
  return { ok: true, value: { created: batch.length }, message: `${batch.length} units created from today's stock.${plan.duplicates.length ? ` ${plan.duplicates.length} serials are in stock under two products: left out, fix them on the sheet first.` : ""}` };
}

/** Per product: the ledger (team sheet + app) against the units here. Before the switch-over they differ; after, they should match. */
export async function sheetVsWarehouse(ctx: Wms): Promise<Array<{ sku: string; name: string; ledger: number; units: number }>> {
  const [levels, units] = await Promise.all([allLevels(ctx), ctx.wms.listUnits({ statuses: [...ON_HAND, "transfer_in_transit"], limit: 200_000 })]);
  const count = new Map<string, number>();
  for (const u of units) count.set(u.sku, (count.get(u.sku) ?? 0) + 1);
  const name = new Map(levels.map((l) => [l.sku, l.name]));
  const skus = new Set([...levels.filter((l) => l.onHand !== 0).map((l) => l.sku), ...count.keys()]);
  return [...skus]
    .map((sku) => ({ sku, name: name.get(sku) ?? sku, ledger: levels.find((l) => l.sku === sku)?.onHand ?? 0, units: count.get(sku) ?? 0 }))
    .filter((r) => r.ledger !== r.units)
    .sort((a, b) => Math.abs(b.ledger - b.units) - Math.abs(a.ledger - a.units));
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

export { REORDER };

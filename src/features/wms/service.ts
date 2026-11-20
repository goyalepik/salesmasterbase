// Warehouse (WMS) rules. Every warehouse change goes through here: it checks the role, keeps serials unique, writes the
// unit records and their history, and moves stock only through the operations service (`receivePurchaseOrder`), so the
// one stock ledger stays the truth and orders held on a PO still get their units on arrival.

import { randomUUID } from "node:crypto";
import { canAct, createPurchaseOrder, receivePurchaseOrder, type Actor, type Result } from "@/lib/ops/service";
import type { OpsStore } from "@/lib/ops/store";
import type { Product, PurchaseOrder } from "@/lib/ops/types";
import { cleanSerial, internalSerial, normalizeSerial, serialProblem } from "./domain/serial";
import { grnNumber, nextPoNumber, unitStock, type UnitStockRow } from "./domain/stock";
import type { Grn, GrnLine, MasterKind, Ownership, PoLineTerms, SerialSource, UnitEvent, WmsMaster, WmsPoHeader, WmsUnit } from "./domain/types";
import { MASTER_KINDS } from "./domain/types";
import { CONDITION_LABELS, isCondition, isOnHand, ON_HAND, sellableCondition, TERMINAL, UNIT_STATUS_LABELS, type Condition } from "./domain/unit";
import { SerialTakenError, type WmsStore } from "./store";

export type Wms = { ops: OpsStore; wms: WmsStore };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAIN_HUB = "HSR HQ";

// ── Who may do what ──────────────────────────────────────────────────────────

/** Unit costs and PO prices: procurement and admin. Warehouse operators don't see them. */
export async function canSeeCost(ops: OpsStore, actor: Actor): Promise<boolean> {
  return canAct(ops, actor, "procurement");
}

// ── Managed lists ────────────────────────────────────────────────────────────

export const DEFAULT_MASTERS: Record<MasterKind, string[]> = {
  hub: [MAIN_HUB, "HQ", "Hebbal", "Jayanagar", "Kengeri", "Mahadevpura", "Hosa Road", "Gurugram Hub"],
  vendor: ["Devi International", "Croma", "Vijay Sales", "Amazon"],
  billing_entity: ["Curioso", "Vivavilla", "Navkar"],
  logistics_partner: ["Delhivery", "Blue Dart", "Shiprocket", "Porter"],
  payment_term: ["Credit", "CnC", "SOR", "Advance", "Net 15", "Net 30", "Net 45", "Net 60", "Payment pending"],
  delay_reason: ["Commercials", "Documents pending from EPIK", "PO required on mail", "E-way bill", "Brand audit"],
};

/** Fills the lists the first time (and adds vendors already on POs). Safe to call on every page. */
export async function ensureMasters(ctx: Wms): Promise<WmsMaster[]> {
  const existing = await ctx.wms.listMasters();
  if (existing.length) return existing;
  const poVendors = [...new Set((await ctx.ops.listPurchaseOrders({ status: "all" })).map((p) => p.vendor?.trim()).filter((v): v is string => !!v))];
  const items = MASTER_KINDS.flatMap((kind) => DEFAULT_MASTERS[kind].map((name) => ({ kind, name })));
  for (const name of poVendors) items.push({ kind: "vendor", name });
  await ctx.wms.addMasters(items);
  return ctx.wms.listMasters();
}

export async function activeNames(ctx: Wms, kind: MasterKind): Promise<string[]> {
  return (await ensureMasters(ctx)).filter((m) => m.kind === kind && m.active).map((m) => m.name);
}

export async function addMaster(ctx: Wms, kind: MasterKind, rawName: string, actor: Actor): Promise<Result<null>> {
  if (!(await canAct(ctx.ops, actor, "procurement"))) return fail("Only procurement or admin can change the lists.");
  if (!MASTER_KINDS.includes(kind)) return fail("Choose a list.");
  const name = rawName.replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 60) return fail("Enter a name of 2 to 60 characters.");
  const all = await ensureMasters(ctx);
  const same = all.find((m) => m.kind === kind && m.name.toLowerCase() === name.toLowerCase());
  if (same?.active) return fail(`${same.name} is already on the list.`);
  if (same) {
    await ctx.wms.setMasterActive(same.id, true);
    return { ok: true, value: null, message: `${same.name} is back on the list.` };
  }
  await ctx.wms.addMasters([{ kind, name }]);
  return { ok: true, value: null, message: `${name} added.` };
}

export async function setMasterActive(ctx: Wms, id: string, active: boolean, actor: Actor): Promise<Result<null>> {
  if (!(await canAct(ctx.ops, actor, "procurement"))) return fail("Only procurement or admin can change the lists.");
  const ok = await ctx.wms.setMasterActive(id, active);
  return ok ? { ok: true, value: null, message: active ? "Back on the list." : "Taken off the list. Old records keep the name." } : fail("Not found.");
}

// ── Purchase orders ──────────────────────────────────────────────────────────

export type NewPoLine = { sku: string; qty: number; unitCostMinor: number | null; ownership: Ownership | null };
export type NewPo = {
  poNumber: string | null;
  vendor: string;
  hub: string;
  billedTo: string | null;
  paymentTerms: string | null;
  priority: WmsPoHeader["priority"];
  eta: string | null;
  notes: string | null;
  lines: NewPoLine[];
};

/** Creates a PO: its lines are ordinary purchase order lines (so the old screens and order holds see them), and the header keeps vendor, hub, billing, terms and prices. */
export async function createPo(ctx: Wms, input: NewPo, actor: Actor, now = new Date()): Promise<Result<WmsPoHeader>> {
  if (!(await canAct(ctx.ops, actor, "procurement"))) return fail("Only procurement or admin can raise a PO.");
  await ensureMasters(ctx);
  const vendor = input.vendor.replace(/\s+/g, " ").trim();
  if (vendor.length < 2) return fail("Choose the vendor.");
  const hubs = await activeNames(ctx, "hub");
  if (!hubs.includes(input.hub)) return fail("Choose the hub the goods come to.");
  if (input.billedTo && !(await activeNames(ctx, "billing_entity")).includes(input.billedTo)) return fail("Choose who the bill is in the name of.");
  if (input.eta && !DATE_RE.test(input.eta)) return fail("ETA should be a date.");
  if (!input.lines.length) return fail("Add at least one product.");
  for (const line of input.lines) {
    if (line.unitCostMinor != null && (!Number.isInteger(line.unitCostMinor) || line.unitCostMinor <= 0 || line.unitCostMinor > 10_000_000_00)) return fail(`The price for ${line.sku} looks wrong.`);
  }
  const allLines = await ctx.ops.listPurchaseOrders({ status: "all" });
  const headers = await ctx.wms.listPoHeaders();
  const poNumber = (input.poNumber?.trim().toUpperCase() || nextPoNumber([...allLines.map((p) => p.poNumber), ...headers.map((h) => h.poNumber)], now));
  if (headers.some((h) => h.poNumber === poNumber) || allLines.some((p) => p.poNumber === poNumber)) return fail(`${poNumber} already exists. Leave the number empty to get the next one.`);

  const created = await createPurchaseOrder(ctx.ops, { poNumber, vendor, eta: input.eta, lines: input.lines.map((l) => ({ sku: l.sku, qty: l.qty })) }, actor);
  if (!created.ok) return created;

  const products = new Map<string, Product | null>();
  for (const l of input.lines) products.set(l.sku, await ctx.ops.getProduct(l.sku));
  const lines: PoLineTerms[] = input.lines.map((l) => ({ sku: l.sku, unitCostMinor: l.unitCostMinor, gstRate: products.get(l.sku)?.gstRate ?? null, ownership: l.ownership ?? products.get(l.sku)?.channel ?? null }));
  const header: WmsPoHeader = {
    poNumber,
    vendor,
    hub: input.hub,
    billedTo: input.billedTo,
    paymentTerms: input.paymentTerms,
    priority: input.priority,
    eta: input.eta,
    notes: input.notes,
    lines,
    createdBy: actor.name,
    createdAt: now.toISOString(),
  };
  await ctx.wms.savePoHeader(header);
  if (!(await activeNames(ctx, "vendor")).some((v) => v.toLowerCase() === vendor.toLowerCase())) await ctx.wms.addMasters([{ kind: "vendor", name: vendor }]);
  const units = input.lines.reduce((s, l) => s + l.qty, 0);
  return { ok: true, value: header, message: `${poNumber} raised: ${units} unit${units === 1 ? "" : "s"} from ${vendor}.` };
}

export type PoSummary = {
  poNumber: string;
  vendor: string | null;
  hub: string | null;
  eta: string | null;
  open: boolean;
  ordered: number;
  received: number;
  products: number;
  valueMinor: number | null;
  createdAt: string;
  /** Raised in the warehouse screens (has a header with prices), or an older PO from the Purchase orders page. */
  hasHeader: boolean;
};

/** Every PO, one row each: open ones first (soonest ETA), then the rest newest first. */
export async function listPos(ctx: Wms): Promise<PoSummary[]> {
  const [lines, headers] = await Promise.all([ctx.ops.listPurchaseOrders({ status: "all" }), ctx.wms.listPoHeaders()]);
  const byNumber = new Map<string, PurchaseOrder[]>();
  for (const l of lines) byNumber.set(l.poNumber, [...(byNumber.get(l.poNumber) ?? []), l]);
  const headerOf = new Map(headers.map((h) => [h.poNumber, h]));
  const rows: PoSummary[] = [];
  for (const [poNumber, group] of byNumber) {
    const h = headerOf.get(poNumber);
    const cost = new Map((h?.lines ?? []).map((l) => [l.sku, l.unitCostMinor]));
    const priced = group.every((l) => cost.get(l.sku) != null);
    rows.push({
      poNumber,
      vendor: h?.vendor ?? group[0].vendor,
      hub: h?.hub ?? null,
      eta: h?.eta ?? group.map((l) => l.eta).filter(Boolean).sort()[0] ?? null,
      open: group.some((l) => l.status === "open"),
      ordered: group.reduce((s, l) => s + l.qtyOrdered, 0),
      received: group.reduce((s, l) => s + l.qtyReceived, 0),
      products: group.length,
      valueMinor: h && priced ? group.reduce((s, l) => s + (cost.get(l.sku) ?? 0) * l.qtyOrdered, 0) : null,
      createdAt: h?.createdAt ?? group.map((l) => l.createdAt).sort()[0],
      hasHeader: !!h,
    });
  }
  return rows.sort((a, b) => Number(b.open) - Number(a.open) || (a.open ? (a.eta ?? "9999").localeCompare(b.eta ?? "9999") : b.createdAt.localeCompare(a.createdAt)));
}

export type PoLineView = PurchaseOrder & { pending: number; terms: PoLineTerms | null; product: Product | null };
export type PoView = { poNumber: string; header: WmsPoHeader | null; lines: PoLineView[]; units: WmsUnit[]; grns: Grn[] };

export async function poView(ctx: Wms, poNumber: string): Promise<PoView | null> {
  const lines = (await ctx.ops.listPurchaseOrders({ status: "all" })).filter((l) => l.poNumber === poNumber);
  if (!lines.length) return null;
  const [header, units, grns] = await Promise.all([ctx.wms.getPoHeader(poNumber), ctx.wms.listUnits({ poNumber }), ctx.wms.listGrns({ poNumber })]);
  const views: PoLineView[] = [];
  for (const l of lines) {
    views.push({ ...l, pending: l.status === "open" ? Math.max(0, l.qtyOrdered - l.qtyReceived) : 0, terms: header?.lines.find((t) => t.sku === l.sku) ?? null, product: await ctx.ops.getProduct(l.sku) });
  }
  return { poNumber, header, lines: views.sort((a, b) => a.sku.localeCompare(b.sku)), units, grns };
}

// ── Scanning ─────────────────────────────────────────────────────────────────

export type ScanCheck =
  | { ok: true; serial: string; serialNorm: string; warning: string | null }
  | { ok: false; reason: string; kind: "format" | "batch" | "in_stock" | "left" };

const when = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

/**
 * Checks one scanned serial before it joins a receipt: readable, not scanned twice on this receipt, not already in
 * stock for this SKU (from the warehouse or from the team sheet), and not a unit that went out (that's a return).
 */
export async function checkScan(ctx: Wms, input: { sku: string; serial: string; batch: string[] }): Promise<ScanCheck> {
  const serial = cleanSerial(input.serial);
  const problem = serialProblem(serial);
  if (problem) return { ok: false, reason: problem, kind: "format" };
  const serialNorm = normalizeSerial(serial);
  if (input.batch.map(normalizeSerial).includes(serialNorm)) return { ok: false, reason: "Already scanned on this receipt.", kind: "batch" };
  return verdict(ctx, input.sku, serial, serialNorm, await ctx.wms.unitsBySerial(serialNorm));
}

async function verdict(ctx: Wms, sku: string, serial: string, serialNorm: string, matches: WmsUnit[]): Promise<ScanCheck> {
  const live = matches.filter((u) => !TERMINAL.includes(u.status));
  const same = live.find((u) => u.sku === sku);
  if (same && isOnHand(same.status)) return { ok: false, reason: `Already in stock: received ${when(same.receivedAt)}${same.grnNumber ? ` on ${same.grnNumber}` : ""}.`, kind: "in_stock" };
  if (same) return { ok: false, reason: `This serial went out before (${UNIT_STATUS_LABELS[same.status].toLowerCase()}). If it's a return, don't receive it here.`, kind: "left" };
  const sheetStock = await ctx.ops.serialsInStock([serial, serialNorm]);
  if (sheetStock.size) return { ok: false, reason: "Already in stock (from the team sheet).", kind: "in_stock" };
  if ((await ctx.ops.serialHasMovement(serial, "dispatch")) || (serial !== serialNorm && (await ctx.ops.serialHasMovement(serialNorm, "dispatch")))) {
    return { ok: false, reason: "This serial was dispatched to a customer before. If it's a return, don't receive it here.", kind: "left" };
  }
  const other = live.find((u) => u.sku !== sku);
  return { ok: true, serial, serialNorm, warning: other ? `The same serial is on another product (${other.sku}). Check you picked the right product.` : null };
}

// ── Goods receipt (GRN) ──────────────────────────────────────────────────────

export type GrnItem = { sku: string; serial: string | null; serialSource: SerialSource; condition: Condition; remark: string | null; photo: string | null; altId: string | null };
export type GrnInput = {
  /** Made by the phone for this receipt, so pressing Save twice (or a retry) never adds stock twice. */
  clientId: string;
  poNumber: string;
  invoiceNo: string | null;
  invoicePending: boolean;
  notes: string | null;
  items: GrnItem[];
  /** Products received by count only (accessories): no serials. */
  counts: Array<{ sku: string; qty: number }>;
};

const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_PHOTO = 700_000;

/**
 * Receives goods against a PO: every serial checked again on the server, units created (all or nothing), stock added to
 * the ledger through the PO receipt, history written. Damaged or defective units go on hold (on hand, not sellable).
 */
export async function submitGrn(ctx: Wms, input: GrnInput, actor: Actor, now = new Date()): Promise<Result<Grn & { reserved: string[] }>> {
  if (!(await canAct(ctx.ops, actor, "inventory"))) return fail("Only the warehouse team can receive goods.");
  if (!/^[A-Za-z0-9-]{8,64}$/.test(input.clientId)) return fail("Refresh the page and try again.");
  const invoiceNo = input.invoiceNo?.replace(/\s+/g, " ").trim().slice(0, 40) || null;
  if (!invoiceNo && !input.invoicePending) return fail("Enter the invoice number, or tick “Invoice not here yet”.");
  if (!input.items.length && !input.counts.some((c) => c.qty > 0)) return fail("Scan at least one unit.");

  const lines = (await ctx.ops.listPurchaseOrders({ status: "all" })).filter((l) => l.poNumber === input.poNumber);
  if (!lines.length) return fail("PO not found.");
  const header = await ctx.wms.getPoHeader(input.poNumber);

  // What each product line gets on this receipt.
  const want = new Map<string, { units: GrnItem[]; count: number }>();
  for (const item of input.items) {
    if (!isCondition(item.condition)) return fail("Choose a condition for every unit.");
    const w = want.get(item.sku) ?? { units: [], count: 0 };
    w.units.push(item);
    want.set(item.sku, w);
  }
  for (const c of input.counts) {
    if (!Number.isInteger(c.qty) || c.qty < 0 || c.qty > 10_000) return fail("Counts should be whole numbers.");
    if (!c.qty) continue;
    const w = want.get(c.sku) ?? { units: [], count: 0 };
    w.count += c.qty;
    want.set(c.sku, w);
  }
  for (const [sku, w] of want) {
    const line = lines.find((l) => l.sku === sku);
    if (!line) return fail(`${sku} is not on ${input.poNumber}. Receiving products that aren't on the PO comes later; ask procurement to add it to the PO.`);
    const pending = line.status === "open" ? line.qtyOrdered - line.qtyReceived : 0;
    const total = w.units.length + w.count;
    if (total > pending) return fail(`${sku}: ${total} scanned but only ${pending} still expected on ${input.poNumber}. More than ordered needs procurement to raise the PO first.`);
  }

  // Serials: readable, unique on this receipt, and free (checked again here: the phone's check may be minutes old).
  const scanned = input.items.filter((i) => i.serialSource !== "internal");
  const norms: string[] = [];
  for (const item of scanned) {
    const serial = cleanSerial(item.serial ?? "");
    const problem = serialProblem(serial);
    if (problem) return fail(`${serial || "A unit"}: ${problem}`);
    const norm = normalizeSerial(serial);
    if (norms.includes(norm)) return fail(`${serial} is on this receipt twice.`);
    norms.push(norm);
  }
  const existing = await ctx.wms.unitsBySerials(norms);
  const blocked: string[] = [];
  for (const item of scanned) {
    const serial = cleanSerial(item.serial ?? "");
    const norm = normalizeSerial(serial);
    const v = await verdict(ctx, item.sku, serial, norm, existing.filter((u) => u.serialNorm === norm || u.altIds.includes(norm)));
    if (!v.ok) blocked.push(`${serial}: ${v.reason}`);
  }
  if (blocked.length) return fail(`Not saved. ${blocked.slice(0, 3).join(" ")}${blocked.length > 3 ? ` And ${blocked.length - 3} more.` : ""}`);

  for (const item of input.items) {
    if (item.photo && (!PHOTO_RE.test(item.photo) || item.photo.length > MAX_PHOTO)) return fail("A photo is too big or not a picture. Take it again.");
  }

  // Only now take the receipt, so a refused one can be fixed and saved again.
  if (!(await ctx.ops.claimAction(`wms-grn:${input.clientId}`))) return fail("This receipt was already saved. Open the PO to see it.");

  const internals = input.items.filter((i) => i.serialSource === "internal").length;
  const firstInternal = internals ? await ctx.wms.nextNumber("internal_serial", internals) : 0;
  const number = grnNumber(await ctx.wms.nextNumber("grn"));
  const at = now.toISOString();
  let internalIndex = 0;

  const units: WmsUnit[] = [];
  for (const item of input.items) {
    const line = lines.find((l) => l.sku === item.sku)!;
    const terms = header?.lines.find((t) => t.sku === item.sku) ?? null;
    const serial = item.serialSource === "internal" ? internalSerial(firstInternal + internalIndex++) : cleanSerial(item.serial ?? "");
    const photos = item.photo ? [await ctx.wms.savePhoto(item.photo)] : [];
    const alt = item.altId ? normalizeSerial(item.altId) : "";
    units.push({
      id: randomUUID(),
      sku: item.sku,
      serial,
      serialNorm: normalizeSerial(serial),
      serialSource: item.serialSource,
      altIds: alt ? [alt] : [],
      status: sellableCondition(item.condition) ? "available" : "quarantine",
      condition: item.condition,
      hub: header?.hub ?? MAIN_HUB,
      ownership: terms?.ownership ?? null,
      billedTo: header?.billedTo ?? null,
      unitCostMinor: terms?.unitCostMinor ?? null,
      gstRate: terms?.gstRate ?? null,
      poNumber: input.poNumber,
      grnNumber: number,
      vendor: header?.vendor ?? line.vendor,
      invoiceNo,
      remark: item.remark?.replace(/\s+/g, " ").trim().slice(0, 200) || null,
      photos,
      receivedAt: at,
      receivedBy: actor.name,
      updatedAt: at,
    });
  }

  try {
    await ctx.wms.insertUnits(units);
  } catch (error) {
    await ctx.ops.releaseAction(`wms-grn:${input.clientId}`);
    if (error instanceof SerialTakenError) return fail(`Not saved. ${error.serial} was received by someone else a moment ago. Remove it and save again.`);
    throw error;
  }

  // Stock in, one PO line at a time, through the PO receipt (ledger rows, PO count, orders held on this PO).
  const grnLines: GrnLine[] = [];
  const reserved: string[] = [];
  const kept: string[] = [];
  const problems: string[] = [];
  for (const [sku, w] of want) {
    const line = lines.find((l) => l.sku === sku)!;
    const lineUnits = units.filter((u) => u.sku === sku);
    const qty = lineUnits.length + w.count;
    const cost = header?.lines.find((t) => t.sku === sku)?.unitCostMinor ?? null;
    const done = await receivePurchaseOrder(ctx.ops, line.id, { qty, serials: lineUnits.map((u) => u.serial), unitCostMinor: cost }, actor);
    if (!done.ok) {
      await ctx.wms.deleteUnits(lineUnits.map((u) => u.id));
      problems.push(`${sku}: ${done.error}`);
      continue;
    }
    reserved.push(...done.value.reserved);
    kept.push(...lineUnits.map((u) => u.id));
    grnLines.push({ sku, productName: line.productName ?? sku, pendingBefore: line.qtyOrdered - line.qtyReceived, received: qty, onHold: lineUnits.filter((u) => u.status === "quarantine").length, countOnly: w.count > 0 && !lineUnits.length });
  }
  if (!grnLines.length) {
    await ctx.ops.releaseAction(`wms-grn:${input.clientId}`);
    return fail(`Nothing was received. ${problems.join(" ")}`);
  }

  const events: Array<Omit<UnitEvent, "id">> = units
    .filter((u) => kept.includes(u.id))
    .map((u) => ({
      unitId: u.id,
      at,
      by: actor.name,
      kind: "received" as const,
      fromStatus: null,
      toStatus: u.status,
      refType: "grn",
      refId: number,
      text: `Received on ${number} against ${input.poNumber}${invoiceNo ? `, invoice ${invoiceNo}` : ""}. ${CONDITION_LABELS[u.condition]}${u.status === "quarantine" ? ", kept on hold" : ""}.${u.serialSource === "internal" ? " No barcode: EPIK label printed." : u.serialSource === "manual" ? " Serial typed by hand." : ""}`,
    }));
  await ctx.wms.addUnitEvents(events);

  const grn: Grn = {
    number,
    poNumber: input.poNumber,
    vendor: header?.vendor ?? lines[0].vendor,
    hub: header?.hub ?? MAIN_HUB,
    invoiceNo,
    invoicePending: !invoiceNo,
    notes: input.notes?.trim().slice(0, 300) || null,
    lines: grnLines,
    unitIds: kept,
    receivedBy: actor.name,
    createdAt: at,
  };
  await ctx.wms.insertGrn(grn);

  const total = grnLines.reduce((s, l) => s + l.received, 0);
  const onHold = grnLines.reduce((s, l) => s + l.onHold, 0);
  const message = [
    `${number} saved: ${total} unit${total === 1 ? "" : "s"} received on ${input.poNumber}.`,
    onHold ? `${onHold} on hold (not sellable).` : "",
    reserved.length ? `Booked for ${reserved.join(", ")}.` : "",
    problems.length ? `Not received: ${problems.join(" ")}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return { ok: true, value: { ...grn, reserved }, message };
}

// ── Units, search, stock ─────────────────────────────────────────────────────

export type UnitDetail = { unit: WmsUnit; events: UnitEvent[]; product: Product | null; photoUrls: string[]; showCost: boolean };

export async function unitDetail(ctx: Wms, id: string, actor: Actor): Promise<UnitDetail | null> {
  const unit = await ctx.wms.getUnit(id);
  if (!unit) return null;
  const [events, product, showCost] = await Promise.all([ctx.wms.unitEvents(id), ctx.ops.getProduct(unit.sku), canSeeCost(ctx.ops, actor)]);
  const photoUrls = (await Promise.all(unit.photos.map((p) => ctx.wms.photoUrl(p)))).filter((u): u is string => !!u);
  if (!showCost) unit.unitCostMinor = null;
  return { unit, events, product, photoUrls, showCost };
}

export type SearchHit = { kind: "unit" | "po" | "grn" | "order" | "product" | "sheet"; title: string; detail: string; href: string | null };

/** One box for everything: a serial or IMEI, a PO, a GRN, an order (EPK- or #PIK) or a product. */
export async function search(ctx: Wms, raw: string): Promise<SearchHit[]> {
  const q = raw.replace(/\s+/g, " ").trim().slice(0, 80);
  if (q.length < 2) return [];
  const upper = q.toUpperCase();
  const hits: SearchHit[] = [];

  const norm = normalizeSerial(q);
  for (const u of await ctx.wms.unitsBySerial(norm)) {
    hits.push({ kind: "unit", title: u.serial, detail: `${u.sku} · ${UNIT_STATUS_LABELS[u.status]} · ${u.hub ?? ""}`, href: `/wms/units/${u.id}` });
  }
  if (!hits.length) {
    if ((await ctx.ops.serialsInStock([cleanSerial(q), norm])).size) hits.push({ kind: "sheet", title: cleanSerial(q), detail: "In stock from the team sheet. It has no warehouse record yet.", href: null });
    else if (await ctx.ops.serialHasMovement(cleanSerial(q), "dispatch")) hits.push({ kind: "sheet", title: cleanSerial(q), detail: "Dispatched (from the team sheet).", href: null });
  }

  const pos = [...new Set((await ctx.ops.listPurchaseOrders({ status: "all" })).map((p) => p.poNumber))].filter((n) => n.toUpperCase().includes(upper)).slice(0, 5);
  for (const n of pos) hits.push({ kind: "po", title: n, detail: "Purchase order", href: `/wms/po/${encodeURIComponent(n)}` });

  if (/^GRN-\d+$/.test(upper)) {
    const grn = await ctx.wms.getGrn(upper);
    if (grn) hits.push({ kind: "grn", title: grn.number, detail: `Goods receipt on ${grn.poNumber}`, href: `/wms/po/${encodeURIComponent(grn.poNumber)}#${grn.number}` });
  }
  if (/^EPK-\d+$/.test(upper)) {
    const order = await ctx.ops.getOrder(upper);
    if (order) hits.push({ kind: "order", title: order.id, detail: `${order.customerName} · order`, href: `/orders/${order.id}` });
  }
  const pik = /^#?PIK\d+$/.test(upper) ? (upper.startsWith("#") ? upper : `#${upper}`) : null;
  if (pik) {
    const order = await ctx.ops.findOrderByShopify(pik);
    if (order) hits.push({ kind: "order", title: pik, detail: `${order.id} · ${order.customerName}`, href: `/orders/${order.id}` });
  }
  if (hits.length < 3) {
    for (const p of await ctx.ops.searchProducts(q, 5)) hits.push({ kind: "product", title: p.name, detail: p.sku, href: `/wms/units?sku=${encodeURIComponent(p.sku)}` });
  }
  return hits;
}

export type StockRow = UnitStockRow & { name: string; brand: string | null; ledgerOnHand: number | null };

/** Stock from the units the warehouse has received, with the ledger's total beside it (it also counts team-sheet stock). */
export async function stockOnHand(ctx: Wms, actor: Actor, q = ""): Promise<{ rows: StockRow[]; showCost: boolean }> {
  const [units, levels, showCost] = await Promise.all([ctx.wms.listUnits({ statuses: [...ON_HAND] }), ctx.ops.stockLevels({ only: "all", limit: 100_000 }), canSeeCost(ctx.ops, actor)]);
  const level = new Map(levels.map((l) => [l.sku, l]));
  const needle = q.trim().toLowerCase();
  const rows: StockRow[] = [];
  for (const r of unitStock(units)) {
    const l = level.get(r.sku);
    const name = l?.name ?? (await ctx.ops.getProduct(r.sku))?.name ?? r.sku;
    const row: StockRow = { ...r, name, brand: l?.brand ?? null, ledgerOnHand: l?.onHand ?? null };
    if (needle && !`${r.sku} ${name} ${row.brand ?? ""}`.toLowerCase().includes(needle)) continue;
    if (!showCost) row.valueMinor = 0;
    rows.push(row);
  }
  return { rows, showCost };
}

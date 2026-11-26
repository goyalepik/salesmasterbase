// The whole inventory picture the IMS shows, built from the team sheets plus what people entered in the IMS.
//
//   Stock (what is on the racks) ........ Inventory Masterbase serials, In System = Yes  (+ IMS receipts not yet in it)
//   Received (stock in) ................. Procurement sheet → Inward Sheet               (+ IMS receipts)
//   Dispatched (stock out) .............. Masterbase dispatch dates; delivery status from the Dispatch Tracker (+ IMS updates)
//   Coming .............................. Procurement list PO lines, less units already received on the same PO and SKU
//   Cost ................................ Masterbase Unit Cost, else Tracker COGS per unit, else the SKU's other serials, else PO price
//   Category ............................ categories.ts (name rules, sheet hints, admin choice)
//
// Money here is inventory money only, at cost incl. GST: no sale prices, GMV or margin. Pure: tests use it.

import { latestStatus, poRef, type AppEntries, type Receipt } from "./app";
import { categorise, CATEGORIES, type Category, type CategorySource } from "./categories";
import { skuKey, type CatalogItem, type Dispatch, type Inward, type PoLine, type TrackerStock, type Unit } from "./sheets";

const DAY = 86_400_000;
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const poKey = (v: string | null) => (v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^PO/, "");
const serialKey = (v: string | null | undefined) => (v ?? "").toUpperCase().replace(/\s+/g, "");
const sum = <T>(list: T[], f: (x: T) => number) => list.reduce((s, x) => s + f(x), 0);
const qtyOf = (u: { qty: number }) => Math.max(1, u.qty);

export type Sources = {
  units: Unit[];
  inwards: Inward[];
  dispatches: Dispatch[];
  lines: PoLine[];
  tracker: TrackerStock;
  catalog: CatalogItem[];
};

export type Range = { from: string; to: string; label: string };

// ── Types the screens use ────────────────────────────────────────────────────

export type IncomingState = "overdue" | "this_week" | "later" | "no_date" | "stale";
export const INCOMING_LABELS: Record<IncomingState, string> = { overdue: "Late", this_week: "Due this week", later: "Due later", no_date: "No date yet", stale: "Old, check" };
export type Incoming = PoLine & { received: number; pending: number; state: IncomingState; value: number; appStatus: string | null };

export type Product = {
  sku: string;
  name: string;
  brand: string | null;
  category: Category;
  categorySource: CategorySource;
  terms: string | null;
  inStock: number;
  value: number;
  avgAge: number | null;
  oldestAge: number | null;
  hubs: Record<string, number>;
  trackerUnits: number | null;
  gap: number;
  incoming: number;
  nextEta: string | null;
  inPeriod: number;
  outPeriod: number;
  out30: number;
  lastOut: string | null;
  cover: number | null;
  listPrice: number;
};

export type CategoryRow = { category: Category; units: number; value: number; skus: number; out30: number; cover: number | null };
export type Attention = { kind: "late" | "out" | "low" | "old" | "dead"; title: string; detail: string; href: string; tone: "bad" | "warn" };
export type Check = { id: string; title: string; count: number; detail: string; items?: Array<{ label: string; a: string; b?: string }> };
export type DispatchRow = Dispatch & { appStatus: string | null; appAt: string | null };

export type Snapshot = {
  today: string;
  range: Range;
  products: Product[];
  units: Unit[];
  inwards: Inward[];
  dispatches: DispatchRow[];
  incoming: Incoming[];
  tracker: TrackerStock;
  receipts: Receipt[];
  categories: CategoryRow[];
  history: Array<{ day: string; units: number; value: number }>;
  activity: Array<{ day: string; in: number; out: number }>;
  kpis: Kpis;
  finance: Finance;
  ageing: Array<{ label: string; units: number; value: number }>;
  brands: Array<{ brand: string; units: number; value: number }>;
  attention: Attention[];
  checks: Check[];
  healthScore: number;
};

export type Kpis = {
  unitsInStock: number;
  stockValue: number;
  skusInStock: number;
  /** In the chosen range and the range before it, for the change chips. */
  inUnits: number; inUnitsPrev: number; inValue: number; inValuePrev: number;
  outUnits: number; outUnitsPrev: number; outValue: number; outValuePrev: number;
  /** Stock value at the start of the range (rebuilt from the serials), for the value chip. */
  valueAtStart: number;
  incomingUnits: number; incomingValue: number; incomingLines: number; lateLines: number; staleLines: number;
  in7: number; out7: number; in30: number; out30: number;
  trackerUnits: number;
  costCoverage: number; costFilled: number;
  appUnits: number;
};

export type Finance = {
  stockValue: number;
  cncValue: number;
  sorValue: number;
  byCategory: Array<{ category: Category; value: number; share: number }>;
  byHub: Array<{ hub: string; value: number; units: number }>;
  agedValue: number;
  deadValue: number;
  deadSkus: number;
  months: Array<{ month: string; label: string; receivedCost: number; dispatchedCost: number; net: number; receivedUnits: number; dispatchedUnits: number; sellThrough: number | null }>;
  vendors: Array<{ vendor: string; value: number; units: number }>;
  billedTo: Array<{ entity: string; value: number }>;
  daysOfStock: number | null;
  turns: number | null;
  topCash: Product[];
  slowMovers: Product[];
  trackerValue: number;
  costOfDispatch30: number;
};

const AGE_BANDS = [
  { label: "0–30 days", max: 30 },
  { label: "31–60 days", max: 60 },
  { label: "61–90 days", max: 90 },
  { label: "90+ days", max: Infinity },
];
export const OPENING_BAND = "Opening stock (no date)";

// ── Costs ────────────────────────────────────────────────────────────────────

/**
 * A cost for every unit. Units without one in the Masterbase (mostly stock from before it began) take the Tracker's
 * COGS per unit, else the typical cost of the same SKU's other serials or inwards, else the PO price. Copies only.
 */
export function fillCosts(units: Unit[], lines: PoLine[], tracker: TrackerStock, inwards: Inward[] = []): { units: Unit[]; filled: number } {
  const fromTracker = new Map(tracker.counts.filter((c) => c.costPerUnit > 0).map((c) => [skuKey(c.sku), c.costPerUnit]));
  const known = new Map<string, number[]>();
  for (const u of units) if (u.cost > 0) known.set(skuKey(u.sku), [...(known.get(skuKey(u.sku)) ?? []), u.cost]);
  for (const w of inwards) if (w.sku && w.cost > 0 && !known.has(skuKey(w.sku))) known.set(skuKey(w.sku), [w.cost]);
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const fromPo = new Map<string, number>();
  for (const l of lines) if (l.sku && l.unitPrice > 10) fromPo.set(skuKey(l.sku), l.unitPrice);
  const bySerial = new Map(inwards.filter((w) => w.serial && w.cost > 0).map((w) => [serialKey(w.serial), w.cost]));
  let filled = 0;
  const out = units.map((u) => {
    if (u.cost > 0) return u;
    const k = skuKey(u.sku);
    const cost = (u.serial ? bySerial.get(serialKey(u.serial)) : undefined) ?? fromTracker.get(k) ?? (known.get(k)?.length ? median(known.get(k)!) : undefined) ?? fromPo.get(k);
    if (!cost) return u;
    if (u.inStock) filled += qtyOf(u);
    return { ...u, cost };
  });
  return { units: out, filled };
}

// ── App receipts → units and inwards ─────────────────────────────────────────

/**
 * Bills entered in the IMS become stock. A serial the Masterbase already has, or a line whose invoice and SKU the
 * Inward Sheet already has, is not counted again (the team typed it in the sheet as well).
 */
function receiptsToStock(receipts: Receipt[], sheetUnits: Unit[], sheetInwards: Inward[]): { units: Unit[]; inwards: Inward[] } {
  const serials = new Set(sheetUnits.map((u) => serialKey(u.serial)).filter(Boolean));
  const invoiceSku = new Set(sheetInwards.map((w) => `${(w.invoice ?? "").toUpperCase().replace(/\s+/g, "")}|${skuKey(w.sku)}`));
  const units: Unit[] = [];
  const inwards: Inward[] = [];
  for (const r of receipts) {
    if (r.voided) continue;
    const day = (r.invoiceDate ?? r.at).slice(0, 10);
    r.lines.forEach((l, li) => {
      if (invoiceSku.has(`${r.invoice.toUpperCase().replace(/\s+/g, "")}|${skuKey(l.sku)}`)) return;
      const fresh = l.serials.filter((s) => !serials.has(serialKey(s)));
      const unserialised = Math.max(0, l.qty - l.serials.length);
      const make = (serial: string | null, qty: number, i: number) => {
        units.push({ serial, sku: l.sku, name: l.name, brand: null, terms: r.terms, qty, inStock: true, inwardOn: day, vendor: r.vendor, invoice: r.invoice, po: r.po, cost: l.unitCost, hub: "Koramangala", condition: l.condition, receivedBy: r.by, dispatchedOn: null, price: 0, customer: null, poc: null, returnedToVendor: false, damaged: l.condition === "Damaged" });
        inwards.push({ id: `${r.id}-${li + 1}-${i}`, on: day, po: r.po, invoice: r.invoice, brand: null, vendor: r.vendor, category: null, name: l.name, sku: l.sku, serial, qty, cost: l.unitCost, condition: l.condition, receivedBy: r.by, terms: r.terms, billedTo: r.billedTo, source: "app" });
      };
      fresh.forEach((s, i) => make(s, 1, i));
      if (unserialised) make(null, unserialised, fresh.length);
    });
  }
  return { units, inwards };
}

// ── The snapshot ─────────────────────────────────────────────────────────────

export function defaultRange(today: string): Range {
  return { from: addDays(today, -29), to: today, label: "Last 30 days" };
}

export function buildSnapshot(src: Sources, today: string, opts: { range?: Range; app?: AppEntries; categoryChoices?: Record<string, string> } = {}): Snapshot {
  const range = opts.range ?? defaultRange(today);
  const app = opts.app ?? { receipts: [], statuses: [], ready: false };
  const choices = opts.categoryChoices ?? {};

  // Stock: the Masterbase, plus IMS receipts it doesn't have yet; every unit gets a cost.
  const fromApp = receiptsToStock(app.receipts, src.units, src.inwards);
  const { units, filled: costFilled } = fillCosts([...src.units, ...fromApp.units], src.lines, src.tracker, src.inwards);
  const inwards = [...src.inwards, ...fromApp.inwards].sort((a, b) => (b.on ?? "").localeCompare(a.on ?? ""));
  const stocked = units.filter((u) => u.inStock && !u.returnedToVendor);
  const out = units.filter((u) => !u.inStock && u.dispatchedOn && u.dispatchedOn <= today);

  const span = daysBetween(range.from, range.to) + 1;
  const prev = { from: addDays(range.from, -span), to: addDays(range.from, -1) };
  const inRange = (d: string | null, r: { from: string; to: string }) => !!d && d >= r.from && d <= r.to;
  const within = (d: string | null, n: number) => !!d && d <= today && daysBetween(d, today) < n;

  // Category per SKU: admin choice, else product name, else the sheets' categories.
  const trackerCat = new Map(src.catalog.map((c) => [skuKey(c.sku), c]));
  const inwardCat = new Map<string, string>();
  for (const w of src.inwards) if (w.sku && w.category) inwardCat.set(skuKey(w.sku), w.category);

  // Coming: PO lines not received, less units already received on the same PO and SKU, with IMS status updates.
  const received = new Map<string, number>();
  for (const u of units) if (u.po) received.set(`${poKey(u.po)}|${skuKey(u.sku)}`, (received.get(`${poKey(u.po)}|${skuKey(u.sku)}`) ?? 0) + qtyOf(u));
  const poNotes = latestStatus(app.statuses, "po");
  const incoming: Incoming[] = src.lines
    .filter((l) => l.raised)
    .map((l) => {
      const note = poNotes.get(poRef(l.po, l.sku));
      const eta = note?.eta ?? l.eta;
      const done = /received and grn done|^received$/i.test(note?.status ?? l.grnStatus ?? "");
      const notComing = l.notComing || note?.status === "Not coming";
      const got = l.po && l.sku ? received.get(`${poKey(l.po)}|${skuKey(l.sku)}`) ?? 0 : 0;
      const pending = done || notComing ? 0 : Math.max(0, l.qty - got);
      const ref = l.raisedOn ?? eta;
      const age = ref ? daysBetween(ref, today) : null;
      let state: IncomingState = eta == null ? "no_date" : eta < today ? "overdue" : eta <= addDays(today, 7) ? "this_week" : "later";
      if (!note && (age ?? 0) > 60 && (eta == null || daysBetween(eta, today) > 30)) state = "stale";
      const price = l.unitPrice > 10 ? l.unitPrice : 0;
      return { ...l, eta, received: Math.min(got, l.qty), pending, state, value: price * pending, appStatus: note?.status ?? null };
    })
    .filter((l) => l.pending > 0)
    .sort((a, b) => (a.eta ?? "9999").localeCompare(b.eta ?? "9999"));

  // Products.
  const bySku = new Map<string, Product>();
  const ages = new Map<string, number[]>();
  const touch = (sku: string, name: string, brand: string | null, terms: string | null) => {
    const k = skuKey(sku);
    let p = bySku.get(k);
    if (!p) {
      const pick = categorise(name, [trackerCat.get(k)?.category, inwardCat.get(k)], choices[k]);
      p = { sku, name, brand, category: pick.category, categorySource: pick.source, terms, inStock: 0, value: 0, avgAge: null, oldestAge: null, hubs: {}, trackerUnits: null, gap: 0, incoming: 0, nextEta: null, inPeriod: 0, outPeriod: 0, out30: 0, lastOut: null, cover: null, listPrice: trackerCat.get(k)?.listPrice ?? 0 };
      bySku.set(k, p);
    } else {
      if (p.name === p.sku && name !== sku) p.name = name;
      p.brand ??= brand;
      p.terms ??= terms;
    }
    return p;
  };
  for (const u of units) {
    const p = touch(u.sku, u.name, u.brand, u.terms);
    if (u.inStock && !u.returnedToVendor) {
      p.inStock += qtyOf(u);
      p.value += u.cost * qtyOf(u);
      const hub = u.hub ?? "Hub not filled";
      p.hubs[hub] = (p.hubs[hub] ?? 0) + qtyOf(u);
      if (u.inwardOn) {
        const list = ages.get(skuKey(u.sku)) ?? [];
        for (let i = 0; i < qtyOf(u); i++) list.push(Math.max(0, daysBetween(u.inwardOn, today)));
        ages.set(skuKey(u.sku), list);
      }
    }
    if (!u.inStock && u.dispatchedOn && u.dispatchedOn <= today) {
      if (inRange(u.dispatchedOn, range)) p.outPeriod += 1;
      if (within(u.dispatchedOn, 30)) p.out30 += 1;
      if (!p.lastOut || u.dispatchedOn > p.lastOut) p.lastOut = u.dispatchedOn;
    }
  }
  for (const w of inwards) if (w.sku && inRange(w.on, range)) touch(w.sku, w.name, w.brand, w.terms).inPeriod += w.qty;
  for (const c of src.tracker.counts) touch(c.sku, c.name || c.sku, c.brand, null).trackerUnits = c.units;
  for (const l of incoming) {
    if (!l.sku || l.state === "stale") continue;
    const p = touch(l.sku, l.name, l.brand, l.terms);
    p.incoming += l.pending;
    if (l.eta && l.eta >= today && (!p.nextEta || l.eta < p.nextEta)) p.nextEta = l.eta;
  }
  // "Dreame" and "DREAME" are one brand.
  const spell = new Map<string, Map<string, number>>();
  for (const p of bySku.values()) if (p.brand) {
    const m = spell.get(p.brand.toLowerCase().trim()) ?? new Map<string, number>();
    m.set(p.brand, (m.get(p.brand) ?? 0) + 1);
    spell.set(p.brand.toLowerCase().trim(), m);
  }
  for (const [k, p] of bySku) {
    if (p.brand) p.brand = [...spell.get(p.brand.toLowerCase().trim())!.entries()].sort((x, y) => Number(/[a-z]/.test(y[0])) - Number(/[a-z]/.test(x[0])) || y[1] - x[1])[0][0];
    const list = ages.get(k);
    if (list?.length) { p.avgAge = Math.round(sum(list, (a) => a) / list.length); p.oldestAge = Math.max(...list); }
    p.gap = p.trackerUnits == null ? 0 : p.inStock - p.trackerUnits;
    p.cover = p.out30 > 0 ? Math.round(p.inStock / (p.out30 / 30)) : null;
  }
  const products = [...bySku.values()].sort((a, b) => b.value - a.value || b.inStock - a.inStock);

  // Categories.
  const categories: CategoryRow[] = CATEGORIES.map((category) => {
    const ps = products.filter((p) => p.category === category);
    const units30 = sum(ps, (p) => p.out30);
    const unitsNow = sum(ps, (p) => p.inStock);
    return { category, units: unitsNow, value: sum(ps, (p) => p.value), skus: ps.filter((p) => p.inStock > 0).length, out30: units30, cover: units30 > 0 ? Math.round(unitsNow / (units30 / 30)) : null };
  }).filter((c) => c.units > 0 || c.out30 > 0).sort((a, b) => b.value - a.value);

  // Stock over time, rebuilt from serials (in: inward date, or before the window for opening stock; out: dispatch date).
  const history: Snapshot["history"] = [];
  const everIn = units.filter((u) => !u.returnedToVendor && (u.inStock || u.dispatchedOn));
  for (let i = 89; i >= 0; i--) {
    const day = addDays(today, -i);
    let n = 0, v = 0;
    for (const u of everIn) {
      if (u.inwardOn && u.inwardOn > day) continue;
      if (!u.inStock && u.dispatchedOn && u.dispatchedOn <= day) continue;
      n += qtyOf(u);
      v += u.cost * qtyOf(u);
    }
    history.push({ day, units: n, value: v });
  }

  // Day by day in and out, last 12 weeks (for the heatmap).
  const activity: Snapshot["activity"] = [];
  const inByDay = new Map<string, number>();
  for (const w of inwards) if (w.on) inByDay.set(w.on, (inByDay.get(w.on) ?? 0) + w.qty);
  const outByDay = new Map<string, number>();
  for (const u of out) outByDay.set(u.dispatchedOn!, (outByDay.get(u.dispatchedOn!) ?? 0) + 1);
  for (let i = 83; i >= 0; i--) {
    const day = addDays(today, -i);
    activity.push({ day, in: inByDay.get(day) ?? 0, out: outByDay.get(day) ?? 0 });
  }

  // Ageing.
  const ageing = [...AGE_BANDS.map((b) => ({ label: b.label, units: 0, value: 0 })), { label: OPENING_BAND, units: 0, value: 0 }];
  for (const u of stocked) {
    const i = u.inwardOn ? AGE_BANDS.findIndex((b) => Math.max(0, daysBetween(u.inwardOn!, today)) <= b.max) : AGE_BANDS.length;
    ageing[i].units += qtyOf(u);
    ageing[i].value += u.cost * qtyOf(u);
  }

  const brandMap = new Map<string, { units: number; value: number }>();
  for (const p of products) if (p.inStock) {
    const e = brandMap.get(p.brand ?? "Other") ?? { units: 0, value: 0 };
    e.units += p.inStock; e.value += p.value;
    brandMap.set(p.brand ?? "Other", e);
  }
  const brands = [...brandMap].map(([brand, e]) => ({ brand, ...e })).sort((a, b) => b.value - a.value);

  // Dispatches with the IMS's own status updates.
  const dispatchNotes = latestStatus(app.statuses, "dispatch");
  const dispatches: DispatchRow[] = src.dispatches
    .map((d) => {
      const n = dispatchNotes.get(serialKey(d.serial) || (d.order ?? ""));
      return { ...d, appStatus: n?.status ?? null, appAt: n?.at ?? null };
    })
    .sort((a, b) => (b.on ?? "").localeCompare(a.on ?? ""));

  // Numbers.
  const stockUnits = sum(stocked, qtyOf);
  const stockValue = sum(stocked, (u) => u.cost * qtyOf(u));
  const isSor = (t: string | null) => /sor/i.test(t ?? "");
  const outIn = (r: { from: string; to: string }) => out.filter((u) => inRange(u.dispatchedOn, r));
  const inIn = (r: { from: string; to: string }) => inwards.filter((w) => inRange(w.on, r));
  const late = incoming.filter((l) => l.state === "overdue");
  const live = incoming.filter((l) => l.state !== "stale");
  const cost30 = sum(out.filter((u) => within(u.dispatchedOn, 30)), (u) => u.cost);
  const kpis: Kpis = {
    unitsInStock: stockUnits,
    stockValue,
    skusInStock: products.filter((p) => p.inStock > 0).length,
    inUnits: sum(inIn(range), (w) => w.qty), inUnitsPrev: sum(inIn(prev), (w) => w.qty),
    inValue: sum(inIn(range), (w) => w.cost * w.qty), inValuePrev: sum(inIn(prev), (w) => w.cost * w.qty),
    outUnits: outIn(range).length, outUnitsPrev: outIn(prev).length,
    outValue: sum(outIn(range), (u) => u.cost), outValuePrev: sum(outIn(prev), (u) => u.cost),
    valueAtStart: history.find((h) => h.day === range.from)?.value ?? history[0]?.value ?? stockValue,
    incomingUnits: sum(live, (l) => l.pending), incomingValue: sum(live, (l) => l.value), incomingLines: live.length, lateLines: late.length, staleLines: incoming.length - live.length,
    in7: sum(inwards.filter((w) => within(w.on, 7)), (w) => w.qty), out7: out.filter((u) => within(u.dispatchedOn, 7)).length,
    in30: sum(inwards.filter((w) => within(w.on, 30)), (w) => w.qty), out30: out.filter((u) => within(u.dispatchedOn, 30)).length,
    trackerUnits: sum(src.tracker.counts, (c) => c.units),
    costCoverage: stockUnits ? sum(stocked.filter((u) => u.cost > 0), qtyOf) / stockUnits : 1,
    costFilled,
    appUnits: sum(fromApp.units, qtyOf),
  };

  // Finance (inventory money only).
  const monthKey = (d: string) => d.slice(0, 7);
  const months: Finance["months"] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 - i, 1));
    const m = d.toISOString().slice(0, 7);
    const ins = inwards.filter((w) => w.on && monthKey(w.on) === m);
    const outs = out.filter((u) => monthKey(u.dispatchedOn!) === m);
    const recUnits = sum(ins, (w) => w.qty);
    // Sell-through: of the serials received that month, how many have gone out since.
    const recSerials = units.filter((u) => u.inwardOn && monthKey(u.inwardOn) === m);
    months.push({
      month: m,
      label: d.toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" }),
      receivedCost: sum(ins, (w) => w.cost * w.qty), dispatchedCost: sum(outs, (u) => u.cost), net: sum(ins, (w) => w.cost * w.qty) - sum(outs, (u) => u.cost),
      receivedUnits: recUnits, dispatchedUnits: outs.length,
      sellThrough: recSerials.length ? Math.round((recSerials.filter((u) => !u.inStock).length / recSerials.length) * 100) : null,
    });
  }
  const vendorMap = new Map<string, { value: number; units: number; names: Map<string, number> }>();
  for (const w of inwards) if (w.vendor && inRange(w.on, { from: addDays(today, -89), to: today })) {
    const k = w.vendor.toLowerCase().replace(/[^a-z]/g, "").slice(0, 14);
    const e = vendorMap.get(k) ?? { value: 0, units: 0, names: new Map() };
    e.value += w.cost * w.qty; e.units += w.qty; e.names.set(w.vendor, (e.names.get(w.vendor) ?? 0) + 1);
    vendorMap.set(k, e);
  }
  const billed = new Map<string, number>();
  for (const w of inwards) if (inRange(w.on, { from: addDays(today, -89), to: today })) billed.set(w.billedTo || "Not filled", (billed.get(w.billedTo || "Not filled") ?? 0) + w.cost * w.qty);
  const hubMap = new Map<string, { value: number; units: number }>();
  for (const u of stocked) {
    const e = hubMap.get(u.hub ?? "Hub not filled") ?? { value: 0, units: 0 };
    e.value += u.cost * qtyOf(u); e.units += qtyOf(u);
    hubMap.set(u.hub ?? "Hub not filled", e);
  }
  const dead = products.filter((p) => p.inStock > 0 && (!p.lastOut || daysBetween(p.lastOut, today) > 90) && (p.oldestAge ?? 999) > 90);
  const finance: Finance = {
    stockValue,
    cncValue: sum(stocked.filter((u) => !isSor(u.terms)), (u) => u.cost * qtyOf(u)),
    sorValue: sum(stocked.filter((u) => isSor(u.terms)), (u) => u.cost * qtyOf(u)),
    byCategory: categories.map((c) => ({ category: c.category, value: c.value, share: stockValue ? c.value / stockValue : 0 })),
    byHub: [...hubMap].map(([hub, e]) => ({ hub, ...e })).sort((a, b) => b.value - a.value),
    agedValue: ageing[3].value,
    deadValue: sum(dead, (p) => p.value),
    deadSkus: dead.length,
    months,
    vendors: [...vendorMap.values()].map((e) => ({ vendor: [...e.names.entries()].sort((a, b) => b[1] - a[1])[0][0], value: e.value, units: e.units })).sort((a, b) => b.value - a.value).slice(0, 10),
    billedTo: [...billed].map(([entity, value]) => ({ entity, value })).sort((a, b) => b.value - a.value),
    daysOfStock: cost30 > 0 ? Math.round(stockValue / (cost30 / 30)) : null,
    turns: stockValue > 0 && cost30 > 0 ? Math.round(((cost30 * 12) / stockValue) * 10) / 10 : null,
    topCash: products.filter((p) => p.inStock > 0).slice(0, 10),
    slowMovers: products.filter((p) => p.inStock > 0 && p.out30 === 0).sort((a, b) => b.value - a.value).slice(0, 10),
    trackerValue: sum(src.tracker.counts, (c) => Math.max(0, c.units) * c.costPerUnit),
    costOfDispatch30: cost30,
  };

  // What needs attention (operations only; sheet differences live on the admin Data checks page).
  const outFast = products.filter((p) => p.inStock === 0 && p.out30 >= 2 && p.incoming === 0).sort((a, b) => b.out30 - a.out30);
  const low = products.filter((p) => p.inStock > 0 && p.cover != null && p.cover < 7 && p.incoming === 0);
  const attention: Attention[] = [];
  if (outFast.length) attention.push({ kind: "out", tone: "bad", title: `${outFast.length} selling product${outFast.length === 1 ? "" : "s"} out of stock`, detail: outFast.slice(0, 3).map((p) => p.name.slice(0, 26)).join(", "), href: "/ims/stock?view=out" });
  if (low.length) attention.push({ kind: "low", tone: "warn", title: `${low.length} product${low.length === 1 ? "" : "s"} under a week of stock`, detail: "At the last 30 days' pace, nothing coming", href: "/ims/stock?view=low" });
  if (late.length) attention.push({ kind: "late", tone: "bad", title: `${late.length} PO line${late.length === 1 ? "" : "s"} late`, detail: `${sum(late, (l) => l.pending)} units past their ETA`, href: "/ims/incoming?state=overdue" });
  if (dead.length) attention.push({ kind: "dead", tone: "warn", title: `${dead.length} products not moving`, detail: "In stock 90+ days, nothing sold in 90 days", href: "/ims/stock?view=dead" });

  // Data checks (admin page only).
  const mbSerials = new Set(src.units.map((u) => serialKey(u.serial)).filter(Boolean));
  const inStockSerials = new Set(src.units.filter((u) => u.inStock).map((u) => serialKey(u.serial)).filter(Boolean));
  const gaps = products.filter((p) => p.trackerUnits != null && p.gap !== 0).sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
  const checks: Check[] = [
    { id: "gap", title: "Masterbase and Tracker counts differ", count: gaps.length, detail: `Masterbase ${stockUnits} units, Tracker ${kpis.trackerUnits}.`, items: gaps.slice(0, 40).map((p) => ({ label: p.name, a: `${p.inStock} in Masterbase`, b: `${p.trackerUnits} in Tracker` })) },
    { id: "negative", title: "Tracker shows minus stock", count: src.tracker.counts.filter((c) => c.units < 0).length, detail: "A dispatch was entered without its inward.", items: src.tracker.counts.filter((c) => c.units < 0).map((c) => ({ label: c.name || c.sku, a: `${c.units}` })) },
    { id: "cost", title: "Units in stock with no Unit Cost", count: sum(src.units.filter((u) => u.inStock && !u.cost), qtyOf), detail: `${costFilled} filled from the Tracker, other serials or the PO price for the numbers here.` },
    { id: "date", title: "Units in stock with no Inward Date", count: sum(src.units.filter((u) => u.inStock && !u.inwardOn), qtyOf), detail: "Shown as opening stock." },
    { id: "hub", title: "Units in stock with no Hub", count: sum(src.units.filter((u) => u.inStock && !u.hub), qtyOf), detail: "Shown as Hub not filled." },
    { id: "serial", title: "Units in stock with no serial", count: sum(src.units.filter((u) => u.inStock && !u.serial), qtyOf), detail: "" },
    { id: "dispatched_in_stock", title: "Dispatched in the Dispatch Tracker but still In System = Yes", count: new Set(src.dispatches.map((d) => serialKey(d.serial)).filter((s) => s && inStockSerials.has(s))).size, detail: "Stock may be overstated by these." },
    { id: "inward_missing", title: "Inward Sheet serials not in the Masterbase", count: new Set(src.inwards.map((w) => serialKey(w.serial)).filter((s) => s && !mbSerials.has(s))).size, detail: "" },
    { id: "po_stale", title: "Old PO lines never closed", count: incoming.length - live.length, detail: "Raised 60+ days ago, no ETA ahead. Hidden from Coming." },
    { id: "po_link", title: "Inwards with no PO number", count: src.inwards.filter((w) => !w.po).length, detail: `Of ${src.inwards.length}. Receipts can't be matched to POs.` },
  ].filter((c) => c.count > 0);

  // Health: share of stock value in products that sold in the last 30 days and aren't old.
  const healthy = sum(products.filter((p) => p.inStock > 0 && p.out30 > 0 && (p.avgAge ?? 0) <= 90), (p) => p.value);
  const healthScore = stockValue ? Math.round((healthy / stockValue) * 100) : 0;

  return { today, range, products, units, inwards, dispatches, incoming, tracker: src.tracker, receipts: app.receipts, categories, history, activity, kpis, finance, ageing, brands, attention, checks, healthScore };
}

// ── Lookups (pages and the chat) ─────────────────────────────────────────────

export function findProducts(s: Snapshot, query: string, limit = 50): Product[] {
  const q = query.toLowerCase().trim();
  if (!q) return s.products.slice(0, limit);
  const words = q.split(/\s+/);
  return s.products.filter((p) => words.every((w) => `${p.sku} ${p.name} ${p.brand ?? ""} ${p.category}`.toLowerCase().includes(w))).slice(0, limit);
}

export function findUnits(s: Snapshot, serial: string): Unit[] {
  const q = serial.toLowerCase().replace(/\s+/g, "");
  if (q.length < 4) return [];
  return s.units.filter((u) => u.serial && u.serial.toLowerCase().replace(/\s+/g, "").includes(q)).slice(0, 20);
}

export type StockView = "in" | "coming" | "low" | "out" | "old" | "dead" | "all";
export const STOCK_VIEWS: Array<{ id: StockView; label: string }> = [
  { id: "in", label: "In stock" },
  { id: "coming", label: "Coming" },
  { id: "low", label: "Running low" },
  { id: "out", label: "Out, still selling" },
  { id: "old", label: "90+ days old" },
  { id: "dead", label: "Not moving" },
  { id: "all", label: "All" },
];

export function productsInView(s: Snapshot, view: StockView, category?: string | null): Product[] {
  const base = category ? s.products.filter((p) => p.category === category) : s.products;
  switch (view) {
    case "in": return base.filter((p) => p.inStock > 0);
    case "coming": return base.filter((p) => p.incoming > 0).sort((a, b) => b.incoming - a.incoming);
    case "low": return base.filter((p) => p.inStock > 0 && p.cover != null && p.cover < 7).sort((a, b) => (a.cover ?? 0) - (b.cover ?? 0));
    case "out": return base.filter((p) => p.inStock === 0 && p.out30 >= 2).sort((a, b) => b.out30 - a.out30);
    case "old": return base.filter((p) => (p.oldestAge ?? 0) > 90).sort((a, b) => (b.oldestAge ?? 0) - (a.oldestAge ?? 0));
    case "dead": return base.filter((p) => p.inStock > 0 && (!p.lastOut || daysBetween(p.lastOut, s.today) > 90) && (p.oldestAge ?? 999) > 90).sort((a, b) => b.value - a.value);
    default: return base;
  }
}

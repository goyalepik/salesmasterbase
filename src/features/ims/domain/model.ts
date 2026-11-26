// The stock picture the IMS shows, built from the three sheets. The Masterbase serials are the truth for what is in
// stock; the Procurement list says what is coming (less what already arrived against the same PO and SKU); the
// Tracker's daily count is a cross-check. Pure: tests use it, and the chat reads the same picture.

import { skuKey, type PoLine, type TrackerStock, type Unit } from "./sheets";

const DAY = 86_400_000;
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const poKey = (v: string | null) => (v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^PO/, "");

/** How a PO line stands today. */
export type IncomingState = "overdue" | "this_week" | "later" | "no_date" | "stale";
export const INCOMING_LABELS: Record<IncomingState, string> = {
  overdue: "Late",
  this_week: "Due this week",
  later: "Due later",
  no_date: "No date yet",
  stale: "Old, check",
};

export type Incoming = PoLine & { received: number; pending: number; state: IncomingState; value: number };

export type Product = {
  sku: string;
  name: string;
  brand: string | null;
  terms: string | null;
  inStock: number;
  value: number;
  avgAge: number | null;
  oldestAge: number | null;
  hubs: Record<string, number>;
  trackerUnits: number | null;
  /** Masterbase minus Tracker; 0 when they agree. */
  gap: number;
  incoming: number;
  nextEta: string | null;
  in30: number;
  out7: number;
  out30: number;
  /** Days the stock lasts at the last 30 days' pace; null when nothing went out. */
  cover: number | null;
};

export type Attention = { kind: "late" | "out" | "low" | "old" | "gap"; title: string; detail: string; href: string; tone: "bad" | "warn" };

export type Snapshot = {
  today: string;
  products: Product[];
  units: Unit[];
  incoming: Incoming[];
  tracker: TrackerStock;
  kpis: {
    unitsInStock: number;
    stockValue: number;
    skusInStock: number;
    incomingUnits: number;
    incomingValue: number;
    incomingLines: number;
    lateLines: number;
    staleLines: number;
    in7: number;
    out7: number;
    in30: number;
    out30: number;
    trackerUnits: number;
    gaps: number;
  };
  ageing: Array<{ label: string; units: number; value: number }>;
  brands: Array<{ brand: string; units: number; value: number }>;
  weeks: Array<{ label: string; from: string; in: number; out: number }>;
  attention: Attention[];
};

const AGE_BANDS = [
  { label: "0–30 days", max: 30 },
  { label: "31–60 days", max: 60 },
  { label: "61–90 days", max: 90 },
  { label: "90+ days", max: Infinity },
];

const fmtDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

export function buildSnapshot(units: Unit[], lines: PoLine[], tracker: TrackerStock, today: string): Snapshot {
  // What arrived against each PO and SKU, from the serials (any status: some went out already).
  const received = new Map<string, number>();
  for (const u of units) {
    if (!u.po) continue;
    const k = `${poKey(u.po)}|${skuKey(u.sku)}`;
    received.set(k, (received.get(k) ?? 0) + Math.max(1, u.qty));
  }
  const incoming: Incoming[] = lines
    .filter((l) => l.raised && !l.notComing)
    .map((l) => {
      const done = /received and grn done|^received$/i.test(l.grnStatus ?? "");
      const got = l.po && l.sku ? received.get(`${poKey(l.po)}|${skuKey(l.sku)}`) ?? 0 : 0;
      const pending = done ? 0 : Math.max(0, l.qty - got);
      // How old the line is: from the day it was raised, else from its ETA.
      const ref = l.raisedOn ?? l.eta;
      const age = ref ? daysBetween(ref, today) : null;
      let state: IncomingState = l.eta == null ? "no_date" : l.eta < today ? "overdue" : l.eta <= addDays(today, 7) ? "this_week" : "later";
      // Raised long ago and no future date: most likely arrived without being marked, or dropped.
      if ((age ?? 0) > 60 && (l.eta == null || daysBetween(l.eta, today) > 30)) state = "stale";
      const price = l.unitPrice > 10 ? l.unitPrice : 0;
      return { ...l, received: Math.min(got, l.qty), pending, state, value: price * pending };
    })
    .filter((l) => l.pending > 0);

  const trackerBySku = new Map(tracker.counts.map((c) => [skuKey(c.sku), c]));
  const bySku = new Map<string, Product>();
  const ages = new Map<string, number[]>();
  const touch = (sku: string, u?: { name: string; brand: string | null; terms: string | null }) => {
    const k = skuKey(sku);
    let p = bySku.get(k);
    if (!p) {
      p = { sku, name: u?.name ?? sku, brand: u?.brand ?? null, terms: u?.terms ?? null, inStock: 0, value: 0, avgAge: null, oldestAge: null, hubs: {}, trackerUnits: null, gap: 0, incoming: 0, nextEta: null, in30: 0, out7: 0, out30: 0, cover: null };
      bySku.set(k, p);
    } else if (u && p.name === p.sku) Object.assign(p, { name: u.name, brand: p.brand ?? u.brand, terms: p.terms ?? u.terms });
    return p;
  };

  let in7 = 0, out7 = 0, in30 = 0, out30 = 0;
  const weekStarts = Array.from({ length: 8 }, (_, i) => addDays(today, -7 * (7 - i) - 6));
  const weeks = weekStarts.map((from) => ({ label: fmtDay(from), from, in: 0, out: 0 }));
  const weekOf = (day: string) => weeks.findIndex((w, i) => day >= w.from && day <= (weeks[i + 1] ? addDays(weeks[i + 1].from, -1) : today));

  for (const u of units) {
    const p = touch(u.sku, u);
    const n = Math.max(1, u.qty);
    if (u.inStock && !u.returnedToVendor) {
      p.inStock += n;
      p.value += u.cost * n;
      if (u.hub) p.hubs[u.hub] = (p.hubs[u.hub] ?? 0) + n;
      if (u.inwardOn) {
        const age = Math.max(0, daysBetween(u.inwardOn, today));
        const list = ages.get(skuKey(u.sku)) ?? [];
        for (let i = 0; i < n; i++) list.push(age);
        ages.set(skuKey(u.sku), list);
      }
    }
    if (u.inwardOn && u.inwardOn <= today) {
      const d = daysBetween(u.inwardOn, today);
      if (d < 30) { p.in30 += n; in30 += n; }
      if (d < 7) in7 += n;
      const w = weekOf(u.inwardOn);
      if (w >= 0) weeks[w].in += n;
    }
    if (u.dispatchedOn && u.dispatchedOn <= today && !u.inStock) {
      const d = daysBetween(u.dispatchedOn, today);
      if (d < 30) { p.out30 += 1; out30 += 1; }
      if (d < 7) { p.out7 += 1; out7 += 1; }
      const w = weekOf(u.dispatchedOn);
      if (w >= 0) weeks[w].out += 1;
    }
  }
  for (const c of tracker.counts) touch(c.sku, { name: c.name || c.sku, brand: c.brand, terms: null }).trackerUnits = c.units;
  for (const l of incoming) {
    // Old lines (probably received or dropped) stay on the Incoming page under "Old, check", not in a product's count.
    if (!l.sku || l.state === "stale") continue;
    const p = touch(l.sku, { name: l.name, brand: l.brand, terms: null });
    p.incoming += l.pending;
    if (l.eta && l.eta >= today && (!p.nextEta || l.eta < p.nextEta)) p.nextEta = l.eta;
  }
  for (const [k, p] of bySku) {
    const list = ages.get(k);
    if (list?.length) {
      p.avgAge = Math.round(list.reduce((s, a) => s + a, 0) / list.length);
      p.oldestAge = Math.max(...list);
    }
    const t = trackerBySku.get(k);
    p.gap = t ? p.inStock - t.units : 0;
    p.cover = p.out30 > 0 ? Math.round(p.inStock / (p.out30 / 30)) : null;
  }
  const products = [...bySku.values()].sort((a, b) => b.value - a.value || b.inStock - a.inStock);

  const ageing = AGE_BANDS.map((b) => ({ label: b.label, units: 0, value: 0 }));
  for (const u of units) {
    if (!u.inStock || u.returnedToVendor || !u.inwardOn) continue;
    const age = Math.max(0, daysBetween(u.inwardOn, today));
    const i = AGE_BANDS.findIndex((b) => age <= b.max);
    ageing[i].units += Math.max(1, u.qty);
    ageing[i].value += u.cost * Math.max(1, u.qty);
  }

  // "Dreame" and "DREAME" are one brand: grouped without case, shown in the spelling used most (mixed case first).
  const spellings = new Map<string, Map<string, number>>();
  for (const p of products) {
    if (!p.brand) continue;
    const k = p.brand.toLowerCase().trim();
    const m = spellings.get(k) ?? new Map<string, number>();
    m.set(p.brand, (m.get(p.brand) ?? 0) + 1);
    spellings.set(k, m);
  }
  const brandName = (b: string | null) => {
    if (!b) return "Other";
    const m = spellings.get(b.toLowerCase().trim());
    return m ? [...m.entries()].sort((x, y) => Number(/[a-z]/.test(y[0])) - Number(/[a-z]/.test(x[0])) || y[1] - x[1])[0][0] : b;
  };
  for (const p of products) if (p.brand) p.brand = brandName(p.brand);
  const brandMap = new Map<string, { units: number; value: number }>();
  for (const p of products) {
    if (!p.inStock) continue;
    const b = p.brand ?? "Other";
    const e = brandMap.get(b) ?? { units: 0, value: 0 };
    e.units += p.inStock;
    e.value += p.value;
    brandMap.set(b, e);
  }
  const brands = [...brandMap].map(([brand, e]) => ({ brand, ...e })).sort((a, b) => b.value - a.value);

  const gaps = products.filter((p) => p.trackerUnits != null && p.gap !== 0).length;
  const late = incoming.filter((l) => l.state === "overdue");
  const outFast = products.filter((p) => p.inStock === 0 && p.out30 >= 2 && p.incoming === 0).sort((a, b) => b.out30 - a.out30);
  const low = products.filter((p) => p.inStock > 0 && p.cover != null && p.cover < 7 && p.incoming === 0).sort((a, b) => (a.cover ?? 0) - (b.cover ?? 0));
  const old = ageing[3];
  const attention: Attention[] = [];
  if (late.length) attention.push({ kind: "late", tone: "bad", title: `${late.length} PO line${late.length === 1 ? "" : "s"} late`, detail: `${late.reduce((s, l) => s + l.pending, 0)} units past their ETA`, href: "/ims/incoming?state=overdue" });
  if (outFast.length) attention.push({ kind: "out", tone: "bad", title: `${outFast.length} selling product${outFast.length === 1 ? "" : "s"} out of stock`, detail: `Nothing coming for ${outFast.slice(0, 3).map((p) => p.name.slice(0, 28)).join(", ")}${outFast.length > 3 ? "…" : ""}`, href: "/ims/stock?view=out" });
  if (low.length) attention.push({ kind: "low", tone: "warn", title: `${low.length} product${low.length === 1 ? "" : "s"} under a week of stock`, detail: "At the last 30 days' pace, with nothing coming", href: "/ims/stock?view=low" });
  if (old.units) attention.push({ kind: "old", tone: "warn", title: `${old.units} units older than 90 days`, detail: "Slow stock to push or return", href: "/ims/stock?view=old" });
  if (gaps) attention.push({ kind: "gap", tone: "warn", title: `${gaps} SKUs differ from the Tracker`, detail: "Masterbase serials vs the daily count", href: "/ims/stock?view=gap" });

  return {
    today,
    products,
    units,
    incoming: incoming.sort((a, b) => (a.eta ?? "9999").localeCompare(b.eta ?? "9999")),
    tracker,
    kpis: {
      unitsInStock: products.reduce((s, p) => s + p.inStock, 0),
      stockValue: products.reduce((s, p) => s + p.value, 0),
      skusInStock: products.filter((p) => p.inStock > 0).length,
      incomingUnits: incoming.filter((l) => l.state !== "stale").reduce((s, l) => s + l.pending, 0),
      incomingValue: incoming.filter((l) => l.state !== "stale").reduce((s, l) => s + l.value, 0),
      incomingLines: incoming.filter((l) => l.state !== "stale").length,
      lateLines: late.length,
      staleLines: incoming.filter((l) => l.state === "stale").length,
      in7, out7, in30, out30,
      trackerUnits: tracker.counts.reduce((s, c) => s + c.units, 0),
      gaps,
    },
    ageing,
    brands,
    weeks,
    attention,
  };
}

// ── Lookups (pages and the chat) ─────────────────────────────────────────────

export function findProducts(s: Snapshot, query: string, limit = 50): Product[] {
  const q = query.toLowerCase().trim();
  if (!q) return s.products.slice(0, limit);
  const words = q.split(/\s+/);
  return s.products.filter((p) => words.every((w) => `${p.sku} ${p.name} ${p.brand ?? ""}`.toLowerCase().includes(w))).slice(0, limit);
}

export function findUnits(s: Snapshot, serial: string): Unit[] {
  const q = serial.toLowerCase().replace(/\s+/g, "");
  if (q.length < 4) return [];
  return s.units.filter((u) => u.serial && u.serial.toLowerCase().replace(/\s+/g, "").includes(q)).slice(0, 20);
}

export type StockView = "all" | "in" | "out" | "low" | "old" | "gap" | "coming";
export const STOCK_VIEWS: Array<{ id: StockView; label: string }> = [
  { id: "in", label: "In stock" },
  { id: "coming", label: "Coming" },
  { id: "low", label: "Running low" },
  { id: "out", label: "Out, still selling" },
  { id: "old", label: "Older than 90 days" },
  { id: "gap", label: "Differs from Tracker" },
  { id: "all", label: "All" },
];

export function productsInView(s: Snapshot, view: StockView): Product[] {
  switch (view) {
    case "in": return s.products.filter((p) => p.inStock > 0);
    case "coming": return s.products.filter((p) => p.incoming > 0).sort((a, b) => b.incoming - a.incoming);
    case "low": return s.products.filter((p) => p.inStock > 0 && p.cover != null && p.cover < 7).sort((a, b) => (a.cover ?? 0) - (b.cover ?? 0));
    case "out": return s.products.filter((p) => p.inStock === 0 && p.out30 >= 2).sort((a, b) => b.out30 - a.out30);
    case "old": return s.products.filter((p) => (p.oldestAge ?? 0) > 90).sort((a, b) => (b.oldestAge ?? 0) - (a.oldestAge ?? 0));
    case "gap": return s.products.filter((p) => p.trackerUnits != null && p.gap !== 0).sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
    default: return s.products;
  }
}

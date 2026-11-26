// Every number EPIK HQ shows, from the SMB sales lines and the Meta ad days. Definitions (shown on screen too):
//   Orders .......... unique Shopify Order IDs; cancelled, refunded, NOT CONFIRMED and fraud left out ("booked" keeps them)
//   GMV ............. list value before discount, incl. GST: SMB "GMV(RSP) Value Pre Disc"
//   Discount ........ GMV − NMV (incl. GST)
//   NMV ............. what the customer pays: SMB "NMV Value (Inc GST)"; ex-GST from "NMV Value (Excl GST)"
//                     Orders finance hasn't filled yet (the newest) use Link Price and Undiscounted GMV instead
//   COGS ............ SMB "COGS Excl GST"; rows where finance still writes "Update data" have no margin yet
//   NM .............. SMB "Net Margin Value" (= NMV ex-GST − COGS ex-GST), only rows with COGS.
//                     NM% = NM ÷ NMV ex-GST of those same rows (the sheet's own NM%)
//   NM after ads .... NM − Meta spend. CAC = Meta spend ÷ new customers. ROAS = NMV ÷ Meta spend
// Pure: tests use it.

import { CAMPAIGN_CATEGORY, CAMPAIGN_LABEL, type AdDay } from "./meta";
import type { SaleLine, SheetTotals } from "./smb";

export const START = "2026-11-01";
const DAY = 86_400_000;
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const sum = <T>(l: T[], f: (x: T) => number) => l.reduce((s, x) => s + f(x), 0);
const uniq = <T>(l: T[]) => [...new Set(l)];
const div = (a: number, b: number) => (b ? a / b : null);

export type Range = { id: string; from: string; to: string; label: string };

export function ranges(today: string): Range[] {
  const m0 = `${today.slice(0, 7)}-01`;
  const prevEnd = addDays(m0, -1);
  const out: Range[] = [
    { id: "mtd", from: m0 < START ? START : m0, to: today, label: "This month" },
    { id: "7d", from: addDays(today, -6), to: today, label: "Last 7 days" },
    { id: "30d", from: addDays(today, -29) < START ? START : addDays(today, -29), to: today, label: "Last 30 days" },
  ];
  if (prevEnd >= START) out.push({ id: "lm", from: `${prevEnd.slice(0, 7)}-01` < START ? START : `${prevEnd.slice(0, 7)}-01`, to: prevEnd, label: "Last month" });
  out.push({ id: "all", from: START, to: today, label: "Since 1 Nov" });
  return out;
}

/** The same length of time just before (for the change chips). */
export function previous(r: Range): Range {
  const n = daysBetween(r.from, r.to) + 1;
  return { id: "prev", from: addDays(r.from, -n), to: addDays(r.from, -1), label: "Previous" };
}

const isCancelled = (l: SaleLine) => /cancel/i.test(`${l.logisticStatus} ${l.deliveryStatus}`) || /refund/i.test(l.paymentStatus ?? "");
const isNotConfirmed = (l: SaleLine) => /not confirmed/i.test(l.logisticStatus ?? l.deliveryStatus ?? "");
/** A real sale: not cancelled, not "NOT CONFIRMED", not fraud. */
export const counts = (l: SaleLine) => !isCancelled(l) && !isNotConfirmed(l) && !l.fraud;
const gmvOf = (l: SaleLine) => (l.financeDone ? l.gmvIncl : l.undiscountedGmv || l.linkPrice);
const nmvInclOf = (l: SaleLine) => (l.financeDone ? l.nmvIncl : l.linkPrice);
const nmvExclOf = (l: SaleLine) => (l.financeDone ? l.nmvExcl : l.linkPrice / 1.18);
const costed = (l: SaleLine) => l.financeDone && l.cogsKnown;
const nmOf = (l: SaleLine) => (costed(l) ? (l.netMargin ?? l.nmvExcl - l.cogsExcl) : 0);
/** NM and NM% over the rows that have a cost. */
const margin = (ls: SaleLine[]) => {
  const c = ls.filter(costed);
  const nm = sum(c, nmOf), base = sum(c, (l) => l.nmvExcl);
  return { nm, base, cogs: sum(c, (l) => l.cogsExcl), pct: div(nm, base) };
};

export type Totals = {
  orders: number; ordersBooked: number; units: number;
  gmv: number; discount: number; nmv: number; nmvExcl: number; cogs: number; nm: number;
  spend: number; demos: number; homeDemos: number; videoDemos: number; customers: number; newCustomers: number; repeatCustomers: number;
  demoSales: number; cancelledOrders: number; cancelledValue: number; notConfirmedOrders: number; paid: number; balance: number;
  /** Real sales without a cost yet (finance not filled, or COGS "Update data"): not in NM / NM%. */
  awaitingCostOrders: number; awaitingCostNmv: number; awaitingCostNmvExcl: number;
  aov: number | null; discountPct: number | null; nmPct: number | null; nmAfterAds: number; nmAfterAdsPct: number | null;
  cac: number | null; roas: number | null; costPerDemo: number | null; demoConversion: number | null; repeatPct: number | null;
};

function totals(lines: SaleLine[], ads: AdDay[]): Totals {
  const net = lines.filter(counts);
  const cancelled = lines.filter((l) => isCancelled(l));
  const nmvExcl = sum(net, nmvExclOf);
  const m = margin(net);
  const nm = m.nm;
  const waiting = net.filter((l) => !costed(l));
  const spend = sum(ads, (d) => d.totalSpend);
  const nmv = sum(net, nmvInclOf);
  const gmv = sum(net, gmvOf);
  const custKey = (l: SaleLine) => (l.phone ?? "").replace(/\D/g, "").slice(-10) || l.customer?.toLowerCase() || l.order;
  const customers = uniq(net.map(custKey));
  const newCustomers = uniq(net.filter((l) => l.cxType !== "Repeat").map(custKey));
  const repeatCustomers = uniq(net.filter((l) => l.cxType === "Repeat").map(custKey));
  const orders = uniq(net.map((l) => l.order)).length;
  const demos = sum(ads, (d) => d.totalDemos);
  const demoSales = uniq(net.filter((l) => /demo/i.test(l.source ?? "")).map((l) => l.order)).length;
  return {
    orders, ordersBooked: uniq(lines.map((l) => l.order)).length, units: sum(net, (l) => l.qty),
    gmv, discount: Math.max(0, gmv - nmv), nmv, nmvExcl, cogs: m.cogs, nm,
    spend, demos, homeDemos: sum(ads, (d) => sum(Object.values(d.homeDemos), (x) => x)), videoDemos: sum(ads, (d) => sum(Object.values(d.videoDemos), (x) => x)),
    customers: customers.length, newCustomers: newCustomers.length, repeatCustomers: repeatCustomers.length,
    demoSales, cancelledOrders: uniq(cancelled.map((l) => l.order)).length, cancelledValue: sum(cancelled, (l) => l.nmvIncl || l.linkPrice),
    notConfirmedOrders: uniq(lines.filter((l) => !isCancelled(l) && isNotConfirmed(l)).map((l) => l.order)).length,
    awaitingCostOrders: uniq(waiting.map((l) => l.order)).length, awaitingCostNmv: sum(waiting, nmvInclOf), awaitingCostNmvExcl: sum(waiting, nmvExclOf),
    paid: sum(net, (l) => l.amountPaid), balance: sum(net, (l) => l.balance),
    aov: div(nmv, orders), discountPct: div(gmv - nmv, gmv), nmPct: m.pct, nmAfterAds: nm - spend, nmAfterAdsPct: div(nm - spend, m.base),
    cac: div(spend, newCustomers.length), roas: div(nmv, spend), costPerDemo: div(spend, demos), demoConversion: div(demoSales, demos), repeatPct: div(repeatCustomers.length, customers.length),
  };
}

export type Row = { key: string; orders: number; units: number; nmv: number; nmvExcl: number; nm: number; nmPct: number | null; discountPct: number | null; share: number };

function breakdown(lines: SaleLine[], key: (l: SaleLine) => string, total: number): Row[] {
  const groups = new Map<string, SaleLine[]>();
  for (const l of lines) if (counts(l)) groups.set(key(l), [...(groups.get(key(l)) ?? []), l]);
  return [...groups].map(([k, ls]) => {
    const nmv = sum(ls, nmvInclOf), gmv = sum(ls, gmvOf), nmvExcl = sum(ls, nmvExclOf), m = margin(ls);
    return { key: k, orders: uniq(ls.map((l) => l.order)).length, units: sum(ls, (l) => l.qty), nmv, nmvExcl, nm: m.nm, nmPct: m.pct, discountPct: div(gmv - nmv, gmv), share: total ? nmv / total : 0 };
  }).sort((a, b) => b.nmv - a.nmv);
}

export type Status = { label: string; tone: "good" | "move" | "wait" | "bad" | "quiet"; orders: number };
const STATUS: Array<[RegExp, string, Status["tone"]]> = [
  [/cancel/i, "Cancelled", "bad"],
  [/delivered/i, "Delivered", "good"],
  [/transit|ofd|out for/i, "On the way", "move"],
  [/hub/i, "At the hub", "move"],
  [/brand/i, "Brand delivers", "move"],
  [/rts/i, "Arranging stock", "wait"],
  [/not confirmed/i, "Not confirmed", "wait"],
  [/confirm/i, "Confirmed", "wait"],
];

export type CheckRow = { label: string; sheet: number; ours: number; ok: boolean };

export type Dashboard = {
  today: string;
  range: Range;
  ranges: Range[];
  now: Totals;
  before: Totals;
  daily: Array<{ day: string; nmv: number; orders: number; spend: number; nm: number }>;
  byCategory: Row[];
  byBrand: Row[];
  byCde: Row[];
  byHub: Row[];
  bySource: Row[];
  campaigns: Array<{ campaign: string; category: string; spend: number; demos: number; newCustomers: number; cac: number | null; nmv: number; roas: number | null }>;
  delivery: { statuses: Status[]; avgDays: number | null; deliveredPct: number | null; pending: number };
  payments: Array<{ label: string; orders: number; value: number }>;
  insights: string[];
  checks: CheckRow[];
  lastSaleDay: string | null;
  lastAdDay: string | null;
};

export function buildDashboard(allLines: SaleLine[], sheetTotals: SheetTotals, allAds: AdDay[], today: string, rangeId = "mtd"): Dashboard {
  const rs = ranges(today);
  const range = rs.find((r) => r.id === rangeId) ?? rs[0];
  const prev = previous(range);
  const lines = allLines.filter((l) => l.day && l.day >= START);
  const ads = allAds.filter((d) => d.day >= START);
  const inR = (d: string | null, r: { from: string; to: string }) => !!d && d >= r.from && d <= r.to;
  const L = lines.filter((l) => inR(l.day, range));
  const A = ads.filter((d) => inR(d.day, range));
  const now = totals(L, A);
  const before = totals(lines.filter((l) => inR(l.day, prev)), ads.filter((d) => inR(d.day, prev)));
  // No sales read at all (feed not connected): sales-based ratios are unknown, not zero.
  if (!lines.length) for (const t of [now, before]) { t.roas = null; t.nmAfterAdsPct = null; t.demoConversion = null; }

  const daily: Dashboard["daily"] = [];
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) {
    const dl = L.filter((l) => l.day === d && counts(l));
    daily.push({ day: d, nmv: sum(dl, nmvInclOf), orders: uniq(dl.map((l) => l.order)).length, spend: sum(A.filter((a) => a.day === d), (a) => a.totalSpend), nm: sum(dl, nmOf) });
  }

  // Campaigns → categories, with CAC per category.
  const camp = new Map<string, { spend: number; demos: number }>();
  for (const d of A) {
    for (const [k, v] of Object.entries(d.spend)) camp.set(k, { spend: (camp.get(k)?.spend ?? 0) + v, demos: camp.get(k)?.demos ?? 0 });
    for (const [k, v] of [...Object.entries(d.homeDemos), ...Object.entries(d.videoDemos)]) camp.set(k, { spend: camp.get(k)?.spend ?? 0, demos: (camp.get(k)?.demos ?? 0) + v });
  }
  // Campaigns that sell the same category (AF and Kitchen) are one row, so their sales aren't counted twice.
  const byCat = new Map<string, { names: string[]; spend: number; demos: number }>();
  for (const [k, c] of camp) {
    const cat = CAMPAIGN_CATEGORY[k] ?? k;
    const e = byCat.get(cat) ?? { names: [], spend: 0, demos: 0 };
    e.names.push(CAMPAIGN_LABEL[k] ?? k); e.spend += c.spend; e.demos += c.demos;
    byCat.set(cat, e);
  }
  const campaigns = [...byCat].map(([category, c]) => {
    const campaign = [...new Set(c.names)].join(" + ");
    const cl = L.filter((l) => counts(l) && l.category.toLowerCase() === category.toLowerCase());
    const newC = uniq(cl.filter((l) => l.cxType !== "Repeat").map((l) => (l.phone ?? "").replace(/\D/g, "").slice(-10) || l.order)).length;
    const nmv = sum(cl, nmvInclOf);
    return { campaign, category, spend: c.spend, demos: c.demos, newCustomers: newC, cac: div(c.spend, newC), nmv, roas: div(nmv, c.spend) };
  }).sort((a, b) => b.spend - a.spend);

  // Delivery (by order: its first line's status).
  const firstLine = new Map<string, SaleLine>();
  for (const l of L) if (!firstLine.has(l.order)) firstLine.set(l.order, l);
  const statuses = new Map<string, Status>();
  for (const l of firstLine.values()) {
    const text = `${l.logisticStatus ?? ""} ${l.deliveryStatus ?? ""}`;
    const hit = STATUS.find(([re]) => re.test(text));
    const label = hit?.[1] ?? "No status yet";
    const s = statuses.get(label) ?? { label, tone: hit?.[2] ?? "quiet", orders: 0 };
    s.orders++;
    statuses.set(label, s);
  }
  const delivered = [...firstLine.values()].filter((l) => l.deliveredOn && l.day);
  const avgDays = delivered.length ? Math.round((sum(delivered, (l) => Math.max(0, daysBetween(l.day!, l.deliveredOn!))) / delivered.length) * 10) / 10 : null;
  const statusList = [...statuses.values()].sort((a, b) => b.orders - a.orders);
  const deliveredN = statuses.get("Delivered")?.orders ?? 0;
  const live = firstLine.size - (statuses.get("Cancelled")?.orders ?? 0) - (statuses.get("Not confirmed")?.orders ?? 0);

  const payments = new Map<string, { orders: Set<string>; value: number }>();
  for (const l of L.filter(counts)) {
    const k = l.paymentStatus || "Not filled";
    const e = payments.get(k) ?? { orders: new Set(), value: 0 };
    e.orders.add(l.order); e.value += nmvInclOf(l);
    payments.set(k, e);
  }

  const byCategory = breakdown(L, (l) => l.category, now.nmv);
  const byCde = breakdown(L.filter((l) => !/shopify direct/i.test(l.poc ?? "")), (l) => l.poc ?? "No POC", now.nmv);
  const bySource = breakdown(L, (l) => l.source ?? "Not filled", now.nmv);

  // Plain-language insights from the numbers (no AI needed).
  const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);
  const rs$ = (x: number): string => {
    const n = Math.abs(x), sign = x < 0 ? "−" : "";
    return sign + (n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)} L` : `₹${Math.round(n).toLocaleString("en-IN")}`);
  };
  const insights: string[] = [];
  const chg = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : null);
  const nmvChg = chg(now.nmv, before.nmv);
  if (nmvChg != null) insights.push(`NMV is ${rs$(now.nmv)}, ${nmvChg >= 0 ? "up" : "down"} ${Math.abs(nmvChg)}% on the period before.`);
  if (byCategory[0]) insights.push(`${byCategory[0].key} brings ${pct(byCategory[0].share)} of NMV at ${pct(byCategory[0].nmPct)} NM.`);
  const bestNm = [...byCategory].filter((r) => r.nmv > now.nmv * 0.05).sort((a, b) => (b.nmPct ?? -1) - (a.nmPct ?? -1))[0];
  if (bestNm && bestNm.key !== byCategory[0]?.key) insights.push(`Best margin: ${bestNm.key} at ${pct(bestNm.nmPct)} NM.`);
  if (now.cac != null) insights.push(`Each new customer costs ${rs$(now.cac)} in Meta spend${before.cac ? ` (was ${rs$(before.cac)})` : ""}.`);
  if (lines.length && now.nmAfterAds) insights.push(`After Meta spend, NM is ${rs$(now.nmAfterAds)} (${pct(now.nmAfterAdsPct)} of NMV).`);
  if (byCde[0]) insights.push(`Top CDE: ${byCde[0].key} with ${rs$(byCde[0].nmv)} NMV from ${byCde[0].orders} orders.`);
  if (now.cancelledOrders) insights.push(`${now.cancelledOrders} orders cancelled or refunded (${rs$(now.cancelledValue)}).`);

  // Cross-check: our sums of every row vs the SMB's own row-1 totals.
  const map: Array<[string, string, (l: SaleLine) => number]> = [
    ["undiscountedGmv", "Undiscounted GMV", (l) => l.undiscountedGmv],
    ["linkPrice", "Link price", (l) => l.linkPrice],
    ["amountPaid", "Amount paid", (l) => l.amountPaid],
    ["balance", "Balance pending", (l) => l.balance],
    ["gmvPreDisc", "GMV incl. GST", (l) => l.gmvIncl],
    ["discount", "Discount", (l) => l.discount],
    ["nmvIncl", "NMV incl. GST", (l) => l.nmvIncl],
    ["nmvExcl", "NMV excl. GST", (l) => l.nmvExcl],
    ["cogsExcl", "COGS excl. GST", (l) => l.cogsExcl],
    ["netMargin", "Net margin", (l) => l.netMargin ?? 0],
  ];
  const checks: CheckRow[] = map.filter(([k]) => sheetTotals[k] != null).map(([k, label, f]) => {
    const ours = sum(allLines, f);
    const sheet = sheetTotals[k];
    return { label, sheet, ours, ok: Math.abs(ours - sheet) <= Math.max(1, Math.abs(sheet) * 0.0005) };
  });

  return {
    today, range, ranges: rs, now, before, daily, byCategory, byBrand: breakdown(L, (l) => l.brand ?? "Not set", now.nmv), byCde,
    byHub: breakdown(L, (l) => l.hub ?? "Not set", now.nmv), bySource, campaigns,
    delivery: { statuses: statusList, avgDays, deliveredPct: div(deliveredN, live), pending: live - deliveredN },
    payments: [...payments].map(([label, e]) => ({ label, orders: e.orders.size, value: e.value })).sort((a, b) => b.value - a.value),
    insights, checks,
    lastSaleDay: lines.map((l) => l.day!).sort().pop() ?? null,
    lastAdDay: ads.filter((d) => d.totalSpend > 0).map((d) => d.day).sort().pop() ?? null,
  };
}

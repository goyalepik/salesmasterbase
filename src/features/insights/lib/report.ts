// Builds the Customer Insights report from clean demo records: conversion by every cut that matters,
// a lead-scoring model, CDE (Customer Delight Executive) skill with the product mix taken out, and what the calls talk about.

import {
  WEEKDAYS, WON_STATUSES, callLengthBucket, demoLengthBucket, hourBucket, hourOf, speedBucket, weekdayOf, type Demo,
} from "./demos";
import { runModelLab } from "./models";
import { auc, fitLogit, hashUnit, predict, shrunkRate, wilson, type Sample } from "./stats";
import type { Consultant, Headline, InsightsReport, Rate, Segment, SegmentId, Theme } from "./types";

export type OrderRef = { phone: string; date: string; valueMinor: number };

export type BuildOptions = { file: string; pulledAt: string; orders?: OrderRef[]; now?: Date; maturityDays?: number };

/** Words in the call that point to a topic. English and the common Hindi / Kannada words written in English letters. */
export const THEMES: { id: string; label: string; re: RegExp }[] = [
  { id: "price", label: "Price or discount", re: /\b(price|discount|costly|expensive|budget|cheaper|mehenga|mahanga|kitna|best price|final price)\b/i },
  { id: "emi", label: "EMI or card offers", re: /\b(emi|no[- ]cost|instal+ment|bajaj|credit card|cashback)\b/i },
  { id: "compare", label: "Comparing online or other stores", re: /\b(amazon|flipkart|online price|croma|reliance digital|vijay sales|compare|comparison)\b/i },
  { id: "family", label: "Needs family to decide", re: /\b(wife|husband|family|parents|discuss (it|with)|let me think|think about it|soch(ke|kar)?|ghar (pe|mein))\b/i },
  { id: "warranty", label: "Warranty", re: /\b(warranty|guarantee|extended warranty)\b/i },
  { id: "service", label: "Service and spares", re: /\b(service cent(er|re)|servicing|after[- ]sales|spare|technician|repair|customer care)\b/i },
  { id: "maintenance", label: "Upkeep: bags, filters, emptying", re: /\b(dust ?bag|filter|consumable|empty(ing)? the|replace(ment)? (brush|mop|bag))\b/i },
  { id: "mopping", label: "Mopping quality", re: /\b(mop|mopping|pocha|wet clean|water tank)\b/i },
  { id: "pets", label: "Pets and hair", re: /\b(pet|pets|dog|cat|fur|hair)\b/i },
  { id: "carpet", label: "Carpets and rugs", re: /\b(carpet|rug|mat)\b/i },
  { id: "navigation", label: "Mapping, wires and obstacles", re: /\b(map|mapping|lidar|obstacle|wire|cable|stairs|fall|navigation)\b/i },
  { id: "app", label: "App and voice control", re: /\b(app|alexa|google home|wifi|wi-fi|schedule|remote)\b/i },
  { id: "noise", label: "Noise", re: /\b(noise|noisy|loud|sound level)\b/i },
  { id: "help", label: "House help / maid", re: /\b(maid|bai|house ?help|helper|kaam ?wali|servant|cook)\b/i },
  { id: "delivery", label: "Delivery and installation", re: /\b(delivery|deliver|install|installation|stock|available)\b/i },
  { id: "urgency", label: "Today-only offer or festival", re: /\b(today only|last day|limited|offer ends|diwali|festival|sale ends)\b/i },
];

export const COMPETITORS: { id: string; label: string; re: RegExp }[] = [
  { id: "roborock", label: "Roborock", re: /\broborock\b/i },
  { id: "xiaomi", label: "Xiaomi / Mi", re: /\b(xiaomi|mi robot|redmi)\b/i },
  { id: "eureka", label: "Eureka Forbes", re: /\beureka\b/i },
  { id: "dyson", label: "Dyson", re: /\bdyson\b/i },
  { id: "irobot", label: "iRobot / Roomba", re: /\b(irobot|roomba)\b/i },
  { id: "milagrow", label: "Milagrow", re: /\bmilagrow\b/i },
  { id: "kent", label: "Kent", re: /\bkent\b/i },
  { id: "samsung", label: "Samsung", re: /\bsamsung\b/i },
  { id: "lg", label: "LG", re: /\blg\b/i },
  { id: "philips", label: "Philips", re: /\bphilips\b/i },
  { id: "amazon", label: "Amazon", re: /\bamazon\b/i },
  { id: "flipkart", label: "Flipkart", re: /\bflipkart\b/i },
];

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function rateRows(demos: Demo[], won: Set<string>, keyOf: (d: Demo) => string | null, base: number, { minN = 30, order }: { minN?: number; order?: string[] } = {}): Rate[] {
  const groups = new Map<string, { n: number; won: number }>();
  for (const d of demos) {
    const k = keyOf(d);
    if (k == null) continue;
    const g = groups.get(k) ?? { n: 0, won: 0 };
    g.n++;
    if (won.has(d.id)) g.won++;
    groups.set(k, g);
  }
  const rows = [...groups].filter(([, g]) => g.n >= minN).map(([key, g]) => {
    const rate = g.won / g.n;
    const { lo, hi } = wilson(g.won, g.n);
    return { key, n: g.n, won: g.won, rate, lo, hi, lift: base ? rate / base : 0 };
  });
  return order ? rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)) : rows.sort((a, b) => b.n - a.n);
}

const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;
const fmt = (n: number) => n.toLocaleString("en-IN");

/** One-hot features for the models. `context` leaves out what happens in the demo, so it can judge CDEs fairly. */
function featuresOf(d: Demo, context: boolean, topBrands: Set<string>): [string, string][] {
  const f: [string, string][] = [
    ["Demo type", d.type],
    ["Product", d.category],
    ["Brand", topBrands.has(d.brand) ? d.brand : "Other brand"],
    ["Lead source", d.sourceGroup],
    ["Hub", d.hub],
    ["Lead to demo", speedBucket(d.leadDate, d.demoDate)],
    ["Day", WEEKDAYS[weekdayOf(d.demoDate)]],
    ["Time", hourBucket(hourOf(d.demoAt))],
    ["Month", d.demoDate.slice(0, 7)],
  ];
  if (context) return f;
  // No survey answers: closing a deal overwrites them, so "no survey" would leak the answer into the model.
  f.push(
    ["Demo length", demoLengthBucket(d.demoMinutes)],
    ["Call length", callLengthBucket(d.callSeconds)],
    ["AI hot lead", d.ai.hot == null ? "Not scored" : d.ai.hot ? "Hot" : "Not hot"],
    ["AI intent", d.ai.intent ?? "Not scored"],
    ["AI mood", d.ai.sentiment ?? "Not scored"],
  );
  return f;
}

function trainModel(demos: Demo[], won: Set<string>, context: boolean, topBrands: Set<string>) {
  const index = new Map<string, number>();
  const counts = new Map<string, number>();
  const vec = (d: Demo) => {
    const x = new Map<number, number>();
    for (const [g, l] of featuresOf(d, context, topBrands)) {
      const k = `${g}\u0000${l}`;
      if (!index.has(k)) index.set(k, index.size);
      x.set(index.get(k)!, 1);
    }
    return x;
  };
  const all = demos.map((d) => ({ d, x: vec(d), y: (won.has(d.id) ? 1 : 0) as 0 | 1 }));
  for (const s of all) for (const [g, l] of featuresOf(s.d, context, topBrands)) counts.set(`${g}\u0000${l}`, (counts.get(`${g}\u0000${l}`) ?? 0) + 1);
  const train = all.filter((s) => hashUnit(s.d.id) >= 0.2);
  const test = all.filter((s) => hashUnit(s.d.id) < 0.2);
  const fitOn = (rows: typeof all) => fitLogit(rows.map((s): Sample => ({ x: s.x, y: s.y })), index.size, { l2: 4 });
  const held = fitOn(train);
  const scored = test.map((s) => ({ p: predict(held, s.x), y: s.y }));
  // Refit on everything for the final weights and per-demo expectations.
  const full = fitOn(all);
  return { index, counts, held, full, all, train, test, scored, auc: auc(scored) };
}

export function buildReport(demos: Demo[], opts: BuildOptions): InsightsReport {
  const pulledAt = opts.pulledAt;
  const matureBefore = addDays(pulledAt, -(opts.maturityDays ?? 14));
  const quality: InsightsReport["quality"] = [];

  const badDate = demos.filter((d) => !/^20(2[4-9]|3\d)-/.test(d.demoDate));
  if (badDate.length) quality.push({ label: "Demos with a broken date", count: badDate.length, of: demos.length, note: "Dated 2000 or empty. Left out of every number." });
  const future = demos.filter((d) => d.demoDate > pulledAt);
  if (future.length) quality.push({ label: "Marked completed but dated after the data pull", count: future.length, of: demos.length, note: "Probably rescheduled bookings. Left out." });
  const valid = demos.filter((d) => /^20(2[4-9]|3\d)-/.test(d.demoDate) && d.demoDate <= pulledAt);

  // Who bought: the CRM status, or a real order from the same phone within 60 days of the demo.
  const ordersByPhone = new Map<string, OrderRef[]>();
  for (const o of opts.orders ?? []) if (o.phone.length === 10) (ordersByPhone.get(o.phone) ?? ordersByPhone.set(o.phone, []).get(o.phone)!).push(o);
  const won = new Set<string>();
  const usedOrders = new Set<OrderRef>();
  let matchedByOrderOnly = 0;
  for (const d of valid) {
    const order = (ordersByPhone.get(d.phone) ?? []).find((o) => o.date >= d.demoDate && o.date <= addDays(d.demoDate, 60));
    if (order) usedOrders.add(order);
    if (WON_STATUSES.has(d.status)) won.add(d.id);
    else if (order && d.status !== "CONVERTED_CANCELLED") { won.add(d.id); matchedByOrderOnly++; }
  }
  if (matchedByOrderOnly) quality.push({ label: "Sales the CRM status missed", count: matchedByOrderOnly, of: won.size, note: "Status says not converted, but the same phone placed an order within 60 days. Counted as sales." });
  const noCd = valid.filter((d) => !d.cd).length;
  if (noCd) quality.push({ label: "Demos with no CDE named", count: noCd, of: valid.length, note: "Can't be credited to anyone." });
  const noHub = valid.filter((d) => d.hub === "Not set").length;
  if (noHub) quality.push({ label: "Demos with no hub", count: noHub, of: valid.length, note: "Hub comparisons use the rest." });
  const zeroRating = valid.filter((d) => d.rating == null).length;
  quality.push({ label: "Demos with no customer rating", count: zeroRating, of: valid.length, note: "Rating 0 or blank: the customer was never asked." });

  // Outcomes were not tracked at first (old imported demos still all say COMPLETED). Start where a month's sale rate
  // reaches 40% of the typical month, so untracked months don't pass for lost sales.
  const monthRate = new Map<string, { n: number; w: number }>();
  for (const d of valid) if (d.demoDate <= matureBefore) {
    const m = monthRate.get(d.demoDate.slice(0, 7)) ?? { n: 0, w: 0 };
    m.n++;
    if (won.has(d.id)) m.w++;
    monthRate.set(d.demoDate.slice(0, 7), m);
  }
  const rates = [...monthRate.values()].filter((m) => m.n >= 50).map((m) => m.w / m.n).sort((a, b) => a - b);
  const typical = rates[Math.floor(rates.length / 2)] ?? 0;
  const trackedFrom = [...monthRate].sort(([a], [b]) => a.localeCompare(b)).find(([, m]) => m.n >= 50 && m.w / m.n >= typical * 0.4)?.[0] ?? "0000-00";
  const untracked = valid.filter((d) => d.demoDate.slice(0, 7) < trackedFrom);
  if (untracked.length) quality.push({ label: `Demos before ${trackedFrom} with no outcome tracked`, count: untracked.length, of: valid.length, note: "Almost all still say COMPLETED, so we can't tell who bought. Shown on the trend, left out of every rate." });
  const mature = valid.filter((d) => d.demoDate.slice(0, 7) >= trackedFrom && d.demoDate <= matureBefore);
  const wonMature = mature.filter((d) => won.has(d.id)).length;
  const base = mature.length ? wonMature / mature.length : 0;
  const R = (keyOf: (d: Demo) => string | null, o?: { minN?: number; order?: string[] }) => rateRows(mature, won, keyOf, base, o);
  // Survey answers only survive on deals that did not close (closing writes the price over them),
  // so they are compared only with each other: read the ranking, not the level.
  const surveyed = mature.filter((d) => d.survey);
  const baseS = surveyed.length ? surveyed.filter((d) => won.has(d.id)).length / surveyed.length : 0;
  const RS = (keyOf: (d: Demo) => string | null, o?: { minN?: number; order?: string[] }) => rateRows(surveyed, won, keyOf, baseS, o);
  const overwritten = mature.filter((d) => won.has(d.id) && !d.survey).length;
  const SURVEY_NOTE = "Closing a deal writes the price over this survey, so sales are under-counted here. Compare the rows with each other, not with the overall rate.";

  // Money: the deal price written on closed deals, else the value of the matched EPIK order.
  const dealValues = mature.filter((d) => won.has(d.id) && d.dealMinor).map((d) => d.dealMinor!);
  const orderValues = [...usedOrders].map((o) => o.valueMinor).filter((v) => v > 0);
  const values = dealValues.length >= 20 ? dealValues : orderValues;
  const aov = values.length >= 20 ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
  if (overwritten) quality.push({ label: "Sales whose CDE survey was overwritten", count: overwritten, of: wonMature, note: "When a deal closes the price is typed into the survey field, so we lose why the customer bought. Add a separate price field." });

  const segments: Record<SegmentId, Segment> = {
    demoType: { title: "Home or video demo", question: "Which demo format sells better?", rows: R((d) => d.type) },
    category: { title: "Product", question: "Which products convert after a demo?", rows: R((d) => d.category) },
    brand: { title: "Brand", question: "Which brands convert after a demo?", rows: R((d) => d.brand, { minN: 60 }).slice(0, 14) },
    source: { title: "Lead source", question: "Where do the buyers come from?", rows: R((d) => d.sourceGroup) },
    hub: { title: "Hub", question: "Which hubs close best?", rows: R((d) => (d.hub === "Not set" ? null : d.hub)) },
    speed: {
      title: "Lead to demo",
      question: "Does a faster demo sell more?",
      rows: R((d) => speedBucket(d.leadDate, d.demoDate), { order: ["Same day", "Next day", "2 to 3 days", "4 to 7 days", "8 to 14 days", "15+ days", "Not known"] }),
    },
    weekday: { title: "Day of the demo", question: "Which days sell?", rows: R((d) => WEEKDAYS[weekdayOf(d.demoDate)], { order: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] }) },
    hour: { title: "Time of the demo", question: "Which time slots sell?", rows: R((d) => hourBucket(hourOf(d.demoAt)), { order: ["Before 11 am", "11 am to 1 pm", "1 to 3 pm", "3 to 5 pm", "5 to 7 pm", "After 7 pm", "Not set"] }) },
    demoLength: {
      title: "Demo length",
      question: "Do longer demos sell more?",
      note: "From the start and end time the CDE logs.",
      rows: R((d) => demoLengthBucket(d.demoMinutes), { order: ["Under 15 min", "15 to 30 min", "30 to 45 min", "45 to 60 min", "60 to 90 min", "90+ min", "Not recorded"] }),
    },
    callLength: {
      title: "Recorded call length",
      question: "Does a longer conversation sell more?",
      rows: R((d) => callLengthBucket(d.callSeconds), { order: ["Under 2 min", "2 to 5 min", "5 to 15 min", "15 to 30 min", "30 to 60 min", "60+ min", "No recording"] }),
    },
    age: { title: "Customer age", question: "Who buys?", note: SURVEY_NOTE, rows: RS((d) => d.survey?.age ?? null, { order: ["Under 25", "25–35", "36–50", "50+"] }) },
    decisionMaker: { title: "Who decides", question: "Does it matter who is in the room?", note: SURVEY_NOTE, rows: RS((d) => d.survey?.decisionMaker ?? null) },
    issue: { title: "Main blocker", question: "What stops a sale?", note: SURVEY_NOTE, rows: RS((d) => d.survey?.issue ?? null) },
    priceResponse: { title: "Reaction to the price", question: "How does the price land?", note: SURVEY_NOTE, rows: RS((d) => d.survey?.priceResponse ?? null) },
    rating: { title: "Customer rating of the demo", question: "Do happy customers buy?", rows: R((d) => (d.rating == null ? null : `${d.rating} star${d.rating === 1 ? "" : "s"}`), { minN: 20, order: ["5 stars", "4 stars", "3 stars", "2 stars", "1 star"] }) },
    aiHot: { title: "AI 'hot lead' flag", question: "Is the AI hot-lead flag right?", rows: R((d) => (d.ai.hot == null ? null : d.ai.hot ? "Flagged hot" : "Not hot")) },
    aiIntent: { title: "AI buying intent", question: "Does AI intent predict a sale?", rows: R((d) => d.ai.intent, { order: ["high", "medium", "low", "just_exploring", "neutral"] }) },
    aiResult: { title: "AI call result", question: "Does the AI call result predict a sale?", rows: R((d) => d.ai.result) },
    aiSentiment: { title: "AI sentiment", question: "Does call mood predict a sale?", rows: R((d) => d.ai.sentiment, { order: ["positive", "neutral", "negative"] }) },
  };

  // Month by month, including recent months that have not had time to convert.
  const months = new Map<string, { demos: number; won: number; virtual: number }>();
  for (const d of valid) {
    const m = months.get(d.demoDate.slice(0, 7)) ?? { demos: 0, won: 0, virtual: 0 };
    m.demos++;
    if (won.has(d.id)) m.won++;
    if (d.type === "Virtual") m.virtual++;
    months.set(d.demoDate.slice(0, 7), m);
  }
  const trend = [...months].sort(([a], [b]) => a.localeCompare(b)).map(([month, m]) => ({
    month, demos: m.demos, won: m.won, rate: m.won / m.demos, virtualShare: m.virtual / m.demos, mature: month < matureBefore.slice(0, 7), tracked: month >= trackedFrom,
  }));

  const heat = new Map<string, { n: number; won: number }>();
  for (const d of mature) {
    const h = hourOf(d.demoAt);
    if (h == null) continue;
    const k = `${weekdayOf(d.demoDate)}-${h}`;
    const c = heat.get(k) ?? { n: 0, won: 0 };
    c.n++;
    if (won.has(d.id)) c.won++;
    heat.set(k, c);
  }
  const heatmap = [...heat].map(([k, c]) => ({ day: Number(k.split("-")[0]), hour: Number(k.split("-")[1]), n: c.n, rate: c.won / c.n }));

  // The lead-scoring model: what predicts a sale, and how well.
  const brandCounts = new Map<string, number>();
  for (const d of mature) brandCounts.set(d.brand, (brandCounts.get(d.brand) ?? 0) + 1);
  const topBrands = new Set([...brandCounts].filter(([, n]) => n >= 80).map(([b]) => b));
  const full = trainModel(mature, won, false, topBrands);
  const drivers = [...full.index].map(([k, i]) => {
    const [group, level] = k.split("\u0000");
    return { group, level, odds: Math.exp(full.full.weights[i]), n: full.counts.get(k) ?? 0 };
  }).filter((d) => d.n >= 80 && d.group !== "Month" && !/^(Not asked|Not set|Not known|Not recorded|Other brand|Other)$/.test(d.level))
    .sort((a, b) => Math.abs(Math.log(b.odds)) - Math.abs(Math.log(a.odds)))
    .slice(0, 18);
  // The model lab: six models on the same facts, 5-fold cross-validated. The lead score uses the best one.
  const lab = runModelLab(mature.map((d) => ({ id: d.id, feats: featuresOf(d, false, topBrands), y: won.has(d.id) ? 1 : 0, aiHot: d.ai.hot })));
  const bestModel = lab.results.find((m) => m.id === lab.best)!;
  const deciles = lab.deciles;

  // CDEs: actual sales against what an average CDE would close with the same demos.
  const ctx = trainModel(mature, won, true, topBrands);
  const expectedById = new Map(ctx.all.map((s) => [s.d.id, predict(ctx.full, s.x)]));
  const byCd = new Map<string, Demo[]>();
  for (const d of mature) if (d.cd) (byCd.get(d.cd) ?? byCd.set(d.cd, []).get(d.cd)!).push(d);
  const consultants: Consultant[] = [...byCd].filter(([, ds]) => ds.length >= 30).map(([name, ds]) => {
    const w = ds.filter((d) => won.has(d.id)).length;
    const expected = ds.reduce((s, d) => s + (expectedById.get(d.id) ?? base), 0);
    const rated = ds.filter((d) => d.rating != null);
    const timed = ds.filter((d) => d.demoMinutes != null);
    const cats = new Map<string, number>();
    for (const d of ds) cats.set(d.category, (cats.get(d.category) ?? 0) + 1);
    return {
      name,
      demos: ds.length,
      won: w,
      rate: w / ds.length,
      fair: shrunkRate(w, ds.length, base),
      expected,
      // Shrunk toward zero the same way, so a lucky small sample does not top the table.
      skill: (w - expected) / (ds.length + 40),
      rating: rated.length >= 10 ? rated.reduce((s, d) => s + d.rating!, 0) / rated.length : null,
      avgDemoMin: timed.length >= 10 ? timed.reduce((s, d) => s + d.demoMinutes!, 0) / timed.length : null,
      topCategory: [...cats].sort((a, b) => b[1] - a[1])[0][0],
    };
  }).sort((a, b) => b.skill - a.skill);

  const calibration = RS((d) => d.survey?.outcome ?? null, {
    minN: 20,
    order: ["Purchased during the demo", "Will buy within 7 days", "Will buy within 15 days", "Will buy within 30 days", "Interested but not ready yet", "Not interested"],
  });

  // What the calls talk about, and how it relates to buying.
  const transcribed = mature.filter((d) => d.transcript.length > 400);
  const baseT = transcribed.length ? transcribed.filter((d) => won.has(d.id)).length / transcribed.length : 0;
  const themeRows = (list: { id: string; label: string; re: RegExp }[], minN: number): Theme[] => list.map((t) => {
    const hit = transcribed.filter((d) => t.re.test(d.transcript));
    const w = hit.filter((d) => won.has(d.id)).length;
    const rate = hit.length ? w / hit.length : 0;
    const { lo, hi } = wilson(w, hit.length);
    return { id: t.id, label: t.label, n: hit.length, share: transcribed.length ? hit.length / transcribed.length : 0, won: w, rate, lo, hi, lift: baseT ? rate / baseT : 0 };
  }).filter((t) => t.n >= minN).sort((a, b) => b.share - a.share);
  const themes = themeRows(THEMES, 40);
  const competitors = themeRows(COMPETITORS, 15);

  // Headlines and the money on the table. Every estimate is deliberately cautious: a haircut where cause and effect can run both ways.
  const headlines: Headline[] = [];
  const opportunities: InsightsReport["opportunities"] = [];
  const value = (sales: number) => (aov ? Math.round(sales * aov) : null);
  const opp = (title: string, detail: string, sales: number) => { if (sales > 0) opportunities.push({ title, detail, sales, valueMinor: value(sales) }); };
  const real = (rows: Rate[], minN: number) => rows.filter((r) => r.n >= minN && !/^(Not set|Not known|Not recorded|No recording|Other)$/.test(r.key));
  const find = (rows: Rate[], key: string) => rows.find((r) => r.key === key);

  headlines.push({
    tone: "info",
    metric: pct(base, 1),
    title: `${fmt(wonMature)} of ${fmt(mature.length)} demos became a sale`,
    detail: `Demos from ${mature.map((d) => d.demoDate).sort()[0] ?? trackedFrom} to ${matureBefore}${aov ? `, about ₹${fmt(Math.round(aov / 100))} a sale` : ""}. The last ${opts.maturityDays ?? 14} days are left out of rates because those customers are still deciding.`,
  });

  const solid = consultants.filter((c) => c.demos >= 60);
  if (solid.length >= 6) {
    const sorted = [...solid].sort((a, b) => b.skill - a.skill);
    const q = Math.max(1, Math.floor(sorted.length / 4));
    const top = sorted.slice(0, q);
    const bottom = sorted.slice(-q);
    const topRate = top.reduce((s, c) => s + c.won, 0) / top.reduce((s, c) => s + c.demos, 0);
    const botRate = bottom.reduce((s, c) => s + c.won, 0) / bottom.reduce((s, c) => s + c.demos, 0);
    headlines.push({ tone: "bad", metric: `${(topRate / Math.max(botRate, 0.001)).toFixed(1)}×`, title: `The best quarter of CDEs close ${pct(topRate)}; the bottom quarter ${pct(botRate)}`, detail: "Measured against what an average CDE would close with the same products, hubs, sources and time slots, so it is skill, not the luck of the draw." });
    const median = sorted[Math.floor(sorted.length / 2)].skill;
    const gain = Math.round(sorted.filter((c) => c.skill < median).reduce((s, c) => s + Math.max(0, median * (c.demos + 40) - (c.won - c.expected)), 0) * 0.5);
    opp("Lift the bottom half of CDEs halfway to the median", `${fmt(sorted.length - Math.ceil(sorted.length / 2))} CDEs close below the median once the mix is taken out. Ride-alongs with the top closers and a shared demo script should close half that gap.`, gain);
  }

  const top3 = deciles.slice(0, 3);
  const top3Won = top3.reduce((s, d) => s + d.rate * d.n, 0);
  const allWon = deciles.reduce((s, d) => s + d.rate * d.n, 0);
  if (allWon > 0) headlines.push({
    tone: bestModel.holdout.auc >= 0.7 ? "good" : "info",
    metric: pct(top3Won / allWon),
    title: `The lead score finds ${pct(top3Won / allWon)} of buyers in the top 30% of demos`,
    detail: `${bestModel.name} won a test of six models. Top 10% convert at ${pct(deciles[0].rate)}, bottom 10% at ${pct(deciles[9].rate)}. AUC ${bestModel.holdout.auc.toFixed(2)} on ${fmt(lab.test)} demos it never saw.`,
  });

  const sources = real(segments.source.rows, 150).sort((a, b) => b.rate - a.rate);
  if (sources.length >= 2) {
    const [hi, lo] = [sources[0], sources.at(-1)!];
    headlines.push({ tone: "info", metric: `${pct(hi.rate)} vs ${pct(lo.rate)}`, title: `${hi.key} leads convert at ${pct(hi.rate)}; ${lo.key.toLowerCase()} at ${pct(lo.rate)}`, detail: "Where a lead comes from matters more than how fast we reach it." });
  }

  // Brands compared inside robot vacuums only, so a phone demo does not skew it.
  const robots = mature.filter((d) => d.category === "Robot vacuum");
  const robotBase = robots.length ? robots.filter((d) => won.has(d.id)).length / robots.length : 0;
  const brands = real(rateRows(robots, won, (d) => d.brand, robotBase, { minN: 150 }), 150).sort((a, b) => b.rate - a.rate);
  if (brands.length >= 3) {
    const [hi, lo] = [brands[0], brands.at(-1)!];
    const times = hi.rate / Math.max(lo.rate, 0.001);
    headlines.push({ tone: "info", metric: `${pct(hi.rate)} vs ${pct(lo.rate)}`, title: `In robot vacuums, a ${hi.key} demo sells ${times >= 2 ? `${times.toFixed(1)}× as often as` : `${pct(times - 1)} more often than`} ${/^(?!eu|u[nr]?i)[aeiou]/i.test(lo.key) ? "an" : "a"} ${lo.key} demo`, detail: `${brands.map((r) => `${r.key} ${pct(r.rate)}`).join(" · ")}. Steer demo slots toward ${brands.slice(0, 2).map((r) => r.key).join(" and ")}.` });
  }

  // Demos that almost never sell: CDE time better spent elsewhere.
  const dead = [...real(segments.source.rows, 200), ...real(segments.category.rows, 200)].filter((r) => r.rate < base * 0.25);
  if (dead.length) {
    const n = dead.reduce((s, r) => s + r.n, 0);
    const w = dead.reduce((s, r) => s + r.won, 0);
    headlines.push(dead.length === 1
      ? { tone: "bad", metric: pct(dead[0].rate, 1), title: `${dead[0].key} demos almost never sell`, detail: `${fmt(n)} demos, ${fmt(w)} sales. Qualify these customers on a call before sending a CDE.` }
      : { tone: "bad", metric: fmt(n), title: `${fmt(n)} demos went to leads that almost never buy`, detail: `${dead.map((r) => `${r.key} (${pct(r.rate, 1)})`).join(", ")}. Only ${fmt(w)} sales from all of them.` });
    opp(`Stop booking ${dead.map((r) => r.key.toLowerCase()).join(" and ")} demos without a qualifying call`, `Qualify them on a call first and give the freed slots to WhatsApp and team-added leads. Assumes half the slots get refilled at the average rate.`, Math.round(dead.reduce((s, r) => s + r.n * (base - r.rate), 0) * 0.5));
  }

  const longDemo = ["60 to 90 min", "90+ min"].map((k) => find(segments.demoLength.rows, k)).filter(Boolean) as Rate[];
  const shortDemo = find(segments.demoLength.rows, "Under 15 min");
  const midDemo = find(segments.demoLength.rows, "30 to 45 min");
  if (longDemo.length && shortDemo) {
    const lr = longDemo.reduce((s, r) => s + r.won, 0) / longDemo.reduce((s, r) => s + r.n, 0);
    headlines.push({ tone: "good", metric: `${(lr / Math.max(shortDemo.rate, 0.001)).toFixed(1)}×`, title: `Demos over an hour convert at ${pct(lr)}; under 15 minutes at ${pct(shortDemo.rate)}`, detail: "Partly because keen customers stay longer, but a rushed demo rarely sells. Make 45 minutes the floor." });
    if (midDemo) opp("Never run a demo under 15 minutes", `${fmt(shortDemo.n)} demos ended inside 15 minutes. Half the gap to a 30 to 45 minute demo is credited, since some of those customers were never going to buy.`, Math.round(shortDemo.n * (midDemo.rate - shortDemo.rate) * 0.5));
  }
  const unlogged = find(segments.demoLength.rows, "Not recorded");
  if (unlogged && unlogged.rate < base * 0.7) quality.push({ label: "Demos with no start / end time logged", count: unlogged.n, of: mature.length, note: `These convert at only ${pct(unlogged.rate)}: an unlogged demo is usually a demo nobody followed up.` });

  const phys = find(segments.demoType.rows, "Physical");
  const virt = find(segments.demoType.rows, "Virtual");
  if (phys && virt && phys.rate > virt.rate) {
    headlines.push({ tone: "info", metric: `${(phys.rate / Math.max(virt.rate, 0.001)).toFixed(1)}×`, title: `Home demos convert at ${pct(phys.rate)}; video demos at ${pct(virt.rate)}`, detail: `${fmt(virt.n)} video demos. Use video to qualify, then book a home visit.` });
    opp("Turn a third of video demos into home visits", `${fmt(virt.n)} video demos closed at ${pct(virt.rate)}. If a third switch to a home demo and close at the home rate.`, Math.round(virt.n * (phys.rate - virt.rate) / 3));
  }
  const notSet = find(segments.demoType.rows, "Not set");
  if (notSet && notSet.rate > base * 1.5) quality.push({ label: "Demos with no demo type", count: notSet.n, of: mature.length, note: `They convert at ${pct(notSet.rate)}, double the average: probably store walk-ins. Tag them so they can be tracked.` });

  const qualified = find(segments.aiResult.rows, "qualified");
  const hot = find(segments.aiHot.rows, "Flagged hot");
  const notHot = find(segments.aiHot.rows, "Not hot");
  if (qualified && hot && notHot) headlines.push({ tone: "good", metric: pct(qualified.rate), title: `Calls the AI marks "qualified" convert at ${pct(qualified.rate)}`, detail: `"Hot" leads ${pct(hot.rate)} vs ${pct(notHot.rate)} for the rest. Good enough to decide who gets called back first.` });

  if (overwritten) headlines.push({ tone: "bad", metric: pct(overwritten / Math.max(1, wonMature)), title: "Most sales lose the CDE's notes on why the customer bought", detail: `${fmt(overwritten)} of ${fmt(wonMature)} sales have the price typed over the survey. One extra form field gives a clean win / loss story for every demo.` });

  const accepted = find(segments.priceResponse.rows, "Accepted price without hesitation");
  const deferred = find(segments.priceResponse.rows, "Deferred decision after hearing price");
  if (accepted && deferred) headlines.push({ tone: "info", metric: `${(accepted.rate / Math.max(deferred.rate, 0.001)).toFixed(1)}×`, title: "How the price lands is the strongest signal in the survey", detail: `"Accepted the price" converts ${(accepted.rate / Math.max(deferred.rate, 0.001)).toFixed(1)}× more than "deferred after hearing the price". Lead with EMI before the full price.` });

  const fast = segments.speed.rows.filter((r) => r.key === "Same day" || r.key === "Next day");
  const slow = segments.speed.rows.filter((r) => r.key === "8 to 14 days" || r.key === "15+ days");
  if (fast.length && slow.length) {
    const fr = fast.reduce((s, r) => s + r.won, 0) / fast.reduce((s, r) => s + r.n, 0);
    const sr = slow.reduce((s, r) => s + r.won, 0) / slow.reduce((s, r) => s + r.n, 0);
    headlines.push(fr > sr * 1.15
      ? { tone: "good", metric: `${(fr / sr).toFixed(1)}×`, title: `Demos within a day convert at ${pct(fr)}, a week later at ${pct(sr)}`, detail: "Speed to demo is one of the strongest levers the team controls." }
      : { tone: "info", metric: `${pct(fr)} vs ${pct(sr)}`, title: "Booking the demo faster does not lift sales on its own", detail: `Same or next day demos convert at ${pct(fr)}; 8+ days later at ${pct(sr)}. Customers who wait are still serious, so don't trade demo quality for speed.` });
  }

  for (const q of quality) q.of = Math.max(q.of, q.count);

  return {
    version: 1,
    generatedAt: (opts.now ?? new Date()).toISOString(),
    source: { file: opts.file, pulledAt, orderMatch: Boolean(opts.orders?.length) },
    outcomeRule: "A demo counts as a sale when its status is CONVERTED or NEGOTIATION_CLOSED, or when the same phone placed an EPIK order within 60 days of the demo.",
    base: {
      demos: valid.length,
      mature: mature.length,
      won: wonMature,
      rate: base,
      from: valid.map((d) => d.demoDate).sort()[0] ?? "",
      to: valid.map((d) => d.demoDate).sort().at(-1) ?? "",
      transcripts: valid.filter((d) => d.transcript.length > 400).length,
      surveyed: valid.filter((d) => d.survey).length,
      aiScored: valid.filter((d) => d.ai.hot != null).length,
      matchedOrders: usedOrders.size,
      aovMinor: aov,
      revenueMinor: aov ? Math.round(aov * wonMature) : null,
    },
    headlines,
    opportunities: opportunities.sort((a, b) => b.sales - a.sales),
    trend,
    segments,
    heatmap,
    model: { name: bestModel.name, auc: bestModel.holdout.auc, train: lab.train, test: lab.test, drivers, deciles },
    lab,
    dataset: describeDataset(demos, valid, mature, won, trackedFrom, matureBefore, usedOrders.size, ordersByPhone),
    consultants,
    calibration,
    themes,
    competitors,
    quality,
  };
}


const SOLD = new Set(["CONVERTED", "NEGOTIATION_CLOSED"]);
function statusGroup(status: string): string {
  if (SOLD.has(status)) return "Sold";
  if (status === "COMPLETED") return "Demo done, no outcome";
  if (/^(FOLLOW_UP|NEGOTIATION_OPEN|INTERESTED|PAYMENT_OPEN)$/.test(status)) return "Still negotiating";
  if (/^(NEGOTIATION_FAILED|CONVERTED_CANCELLED)$/.test(status)) return "Lost or cancelled";
  return "Could not reach";
}

function slices(demos: Demo[], keyOf: (d: Demo) => string, top = 5): { label: string; n: number }[] {
  const m = new Map<string, number>();
  for (const d of demos) m.set(keyOf(d), (m.get(keyOf(d)) ?? 0) + 1);
  const sorted = [...m].sort((a, b) => b[1] - a[1]);
  const head = sorted.slice(0, top).map(([label, n]) => ({ label, n }));
  const rest = sorted.slice(top).reduce((s, [, n]) => s + n, 0);
  return rest ? [...head, { label: "Other", n: rest }] : head;
}

/** How the sheet was processed, and how complete each field is: the Data health page. */
function describeDataset(all: Demo[], valid: Demo[], mature: Demo[], won: Set<string>, trackedFrom: string, matureBefore: string, matchedOrders: number, ordersByPhone: Map<string, OrderRef[]>): InsightsReport["dataset"] {
  const v = valid.length;
  const has = (pred: (d: Demo) => boolean) => valid.filter(pred).length;
  const coverage = [
    { label: "CDE named", n: has((d) => Boolean(d.cd)), of: v, note: "Needed to credit the sale." },
    { label: "Lead source", n: has((d) => d.sourceGroup !== "Not set"), of: v, note: "Where the lead came from." },
    { label: "Demo type (home / video)", n: has((d) => d.type !== "Not set"), of: v, note: "Blank ones are likely store walk-ins." },
    { label: "Start and end time", n: has((d) => d.demoMinutes != null), of: v, note: "Gives the demo length." },
    { label: "CDE survey", n: has((d) => Boolean(d.survey)), of: v, note: "Lost when a deal closes (price typed over it)." },
    { label: "Hub", n: has((d) => d.hub !== "Not set"), of: v, note: "Which team ran it." },
    { label: "Call recorded", n: has((d) => d.audioRecorded), of: v, note: "Audio flag in the sheet." },
    { label: "Call transcript", n: has((d) => d.transcript.length > 400), of: v, note: "Long enough to read." },
    { label: "AI call score", n: has((d) => d.ai.hot != null), of: v, note: "Hot lead, intent, mood." },
    { label: "Customer rating", n: has((d) => d.rating != null), of: v, note: "1 to 5 stars; 0 means never asked." },
    { label: "Phone matches an EPIK order", n: has((d) => ordersByPhone.has(d.phone)), of: v, note: "Only orders in the ops sheet (Dec 2025 to Oct 2026)." },
  ].sort((a, b) => b.n - a.n);
  const coreFields = coverage.filter((c) => !/Phone matches/.test(c.label));
  const healthScore = Math.round((coreFields.reduce((s, c) => s + c.n / c.of, 0) / coreFields.length) * 100);
  return {
    rows: all.length,
    trackedFrom,
    matureBefore,
    funnel: [
      { label: "Rows in the sheet", n: all.length, note: "Every completed demo booking." },
      { label: "Valid date", n: v, note: `${(all.length - v).toLocaleString("en-IN")} dated 2000, empty or after the pull.` },
      { label: "Outcome tracked", n: valid.filter((d) => d.demoDate.slice(0, 7) >= trackedFrom).length, note: `From ${trackedFrom}; earlier imported demos all still say COMPLETED.` },
      { label: "Judged (2+ weeks old)", n: mature.length, note: `Up to ${matureBefore}; newer customers are still deciding.` },
      { label: "Became a sale", n: mature.filter((d) => won.has(d.id)).length, note: `${matchedOrders.toLocaleString("en-IN")} matched to a real EPIK order by phone.` },
    ],
    coverage,
    healthScore,
    status: slices(valid, (d) => statusGroup(d.status), 6),
    transcriptSource: slices(valid, (d) => (d.transcript.length > 400 ? `Transcript from ${d.transcriptSource}` : d.audioRecorded ? "Recorded, no transcript" : "Not recorded"), 4),
    category: slices(mature, (d) => d.category),
    source: slices(mature, (d) => d.sourceGroup),
    demoType: slices(mature, (d) => d.type),
  };
}

import "server-only";

import { readEnv } from "@/lib/env";
import type { Dashboard } from "./domain/metrics";

export type Turn = { role: "user" | "assistant"; content: string };

const r0 = (n: number | null) => (n == null ? null : Math.round(n));
const p1 = (n: number | null) => (n == null ? null : Math.round(n * 1000) / 10);

/** Everything the dashboard shows, compact, as the assistant's facts. */
export function facts(d: Dashboard) {
  const t = (x: Dashboard["now"]) => ({ orders: x.orders, units: x.units, gmv: r0(x.gmv), discount: r0(x.discount), discount_pct: p1(x.discountPct), nmv_incl_gst: r0(x.nmv), nmv_excl_gst: r0(x.nmvExcl), cogs_excl_gst: r0(x.cogs), nm: r0(x.nm), nm_pct: p1(x.nmPct), orders_without_cost_yet: x.awaitingCostOrders, nmv_without_cost_yet: r0(x.awaitingCostNmv), not_confirmed_orders: x.notConfirmedOrders, meta_spend: r0(x.spend), nm_after_ads: r0(x.nmAfterAds), nm_after_ads_pct: p1(x.nmAfterAdsPct), cac: r0(x.cac), roas: x.roas == null ? null : Math.round(x.roas * 10) / 10, aov: r0(x.aov), new_customers: x.newCustomers, repeat_customers: x.repeatCustomers, repeat_pct: p1(x.repeatPct), demos: x.demos, cost_per_demo: r0(x.costPerDemo), demo_sale_conversion_pct: p1(x.demoConversion), cancelled_orders: x.cancelledOrders, cancelled_value: r0(x.cancelledValue), paid: r0(x.paid), balance_pending: r0(x.balance) });
  const rows = (l: Dashboard["byCategory"], n = 15) => l.slice(0, n).map((r) => ({ name: r.key, orders: r.orders, nmv: r0(r.nmv), nm: r0(r.nm), nm_pct: p1(r.nmPct), discount_pct: p1(r.discountPct), share_pct: p1(r.share) }));
  return {
    period: `${d.range.label} (${d.range.from} to ${d.range.to})`, today: d.today, now: t(d.now), previous_period: t(d.before),
    by_category: rows(d.byCategory), by_brand: rows(d.byBrand, 12), by_cde: rows(d.byCde, 25), by_hub: rows(d.byHub), by_source: rows(d.bySource),
    campaigns: d.campaigns.map((c) => ({ campaign: c.campaign, category: c.category, spend: r0(c.spend), demos: c.demos, new_customers: c.newCustomers, cac: r0(c.cac), nmv: r0(c.nmv), roas: c.roas == null ? null : Math.round(c.roas * 10) / 10 })),
    delivery: { statuses: d.delivery.statuses.map((s) => ({ status: s.label, orders: s.orders })), avg_days_to_deliver: d.delivery.avgDays, delivered_pct: p1(d.delivery.deliveredPct) },
    payments: d.payments.map((p) => ({ status: p.label, orders: p.orders, value: r0(p.value) })),
  };
}

const SYSTEM = `You are EPIK HQ's analyst. EPIK is a consumer-durables retailer in Bengaluru. You answer founders and investors about sales and money, from the live Sales Masterbase and the Meta ad tracker (from 1 Nov 2026).
Definitions: GMV = list value before discount incl. GST. NMV = what customers pay (incl. GST unless said). NM = NMV excl. GST − COGS excl. GST, only on orders finance has costed; NM % = NM ÷ NMV excl. GST of those orders (orders without a cost yet are listed separately). NM after ads = NM − Meta spend. CAC = Meta spend ÷ new customers (Meta only). ROAS = NMV ÷ Meta spend. Cancelled, refunded and NOT CONFIRMED orders are left out.
Use only the facts given; never invent numbers. If something isn't in the facts, say so. Answer short: one line first, then a small table or list only if useful. Money as ₹2.6 Cr / ₹4.5 L, percentages with one decimal.`;

export async function askHq(d: Dashboard, history: Turn[]): Promise<string> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return "The assistant needs an OpenAI key on the server (OPENAI_API_KEY).";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: readEnv().openaiModel, max_completion_tokens: 900, messages: [{ role: "system", content: SYSTEM }, { role: "system", content: `FACTS: ${JSON.stringify(facts(d))}` }, ...history.slice(-10).map((t) => ({ role: t.role, content: t.content.slice(0, 2000) }))] }),
    signal: AbortSignal.timeout(45_000),
  }).catch(() => null);
  if (!res?.ok) return `The assistant couldn't answer right now${res ? ` (OpenAI ${res.status})` : ""}. Try again in a minute.`;
  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return body.choices?.[0]?.message?.content?.trim() || "No answer. Try asking another way.";
}

import type { SenderActivity } from "@/lib/incentive";
import { isThreadReply, orderDayKey, readCompleteOrder } from "@/lib/orders";

export type PocBoard = {
  name: string;
  orders: number;
  offeredMinor: number;
  fresh: number;
  repeat: number;
  hubs: string[];
  addons: number;
};

function sellerName(orderPoc: string | null, senderName: string | null): string {
  if (orderPoc) return orderPoc;
  const name = senderName?.replace(/\s+/g, " ").trim() ?? "";
  if (name.length >= 2 && !/^U[A-Z0-9]+$/.test(name)) return name;
  return "Name needed";
}

export function pocBoard(rows: SenderActivity[]): PocBoard[] {
  const groups = new Map<string, PocBoard>();
  const seen = new Set<string>();
  const sorted = [...rows].sort((a, b) => b.eventReceivedAt.localeCompare(a.eventReceivedAt));
  for (const row of sorted) {
    if (row.processingStatus === "skipped" || isThreadReply(row.threadTs, row.slackMessageTs)) continue;
    const order = readCompleteOrder(row.text);
    if (!order) continue;
    const name = sellerName(order.poc, row.senderName);
    const deal = `${name.toLowerCase()}|${orderDayKey(order.customerName, order.product, row.eventReceivedAt)}`;
    if (seen.has(deal)) continue;
    seen.add(deal);
    const key = name.toLowerCase();
    const current = groups.get(key) ?? { name, orders: 0, offeredMinor: 0, fresh: 0, repeat: 0, hubs: [], addons: 0 };
    current.orders += 1;
    current.offeredMinor += order.offeredPriceMinor;
    if (/^repeat$/i.test(order.customerType ?? "")) current.repeat += 1;
    else if (/^new$/i.test(order.customerType ?? "")) current.fresh += 1;
    if (order.hub && !current.hubs.includes(order.hub)) current.hubs.push(order.hub);
    if ([order.accessories, order.extendedWarranty, order.installation].some((value) => value && !/^none$/i.test(value))) current.addons += 1;
    groups.set(key, current);
  }
  return [...groups.values()]
    .map((seller) => ({ ...seller, hubs: [...seller.hubs].sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => b.offeredMinor - a.offeredMinor || a.name.localeCompare(b.name));
}

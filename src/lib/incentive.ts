import { isThreadReply, orderDayKey, readCompleteOrder } from "@/lib/orders";
import type { ProcessingStatus } from "@/lib/types";

export type SenderActivity = {
  id: string;
  senderId: string | null;
  senderName: string | null;
  text: string;
  threadTs: string | null;
  slackMessageTs: string;
  processingStatus: ProcessingStatus;
  eventReceivedAt: string;
};

export type IncentivePerson = {
  key: string;
  slackId: string | null;
  name: string | null;
  orders: number;
  messages: number;
  offeredMinor: number | null;
  sampleIds: string[];
};

function cleanName(value: string | null | undefined): string | null {
  const name = value?.trim() ?? "";
  if (name.length < 2 || /^U[A-Z0-9]+$/.test(name)) return null;
  return name;
}

export function incentiveBySender(rows: SenderActivity[], aliases: Record<string, string> = {}): IncentivePerson[] {
  const groups = new Map<string, IncentivePerson>();
  const seenDeals = new Set<string>();
  const sorted = [...rows].sort((a, b) => b.eventReceivedAt.localeCompare(a.eventReceivedAt));
  for (const row of sorted) {
    if (row.processingStatus === "skipped") continue;
    const slackId = row.senderId?.trim() || null;
    const name = cleanName(slackId ? aliases[slackId] : null) ?? cleanName(row.senderName);
    if (!slackId && !name) continue;
    const key = slackId ? `id:${slackId}` : `name:${name!.toLowerCase()}`;
    const current = groups.get(key) ?? { key, slackId, name, orders: 0, messages: 0, offeredMinor: null, sampleIds: [] };
    if (!current.name && name) current.name = name;
    current.messages += 1;
    if (!isThreadReply(row.threadTs, row.slackMessageTs)) {
      const order = readCompleteOrder(row.text);
      if (order) {
        const deal = `${key}|${orderDayKey(order.customerName, order.product, row.eventReceivedAt)}`;
        if (!seenDeals.has(deal)) {
          seenDeals.add(deal);
          current.orders += 1;
          current.offeredMinor = (current.offeredMinor ?? 0) + order.offeredPriceMinor;
          if (current.sampleIds.length < 3) current.sampleIds.push(row.id);
        }
      }
    }
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => {
    const price = (b.offeredMinor ?? -1) - (a.offeredMinor ?? -1);
    if (price !== 0) return price;
    if (b.messages !== a.messages) return b.messages - a.messages;
    return (a.name ?? a.slackId ?? "").localeCompare(b.name ?? b.slackId ?? "");
  });
}

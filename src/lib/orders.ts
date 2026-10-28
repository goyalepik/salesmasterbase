import { istDayBounds } from "@/lib/format";
import { parseMessageText } from "@/lib/parse/message";
import { sanitizeSearch } from "@/lib/query";
import type { CustomerGroup, DayCounts, InboxRow, ProcessingStatus } from "@/lib/types";

export function isThreadReply(threadTs: string | null | undefined, slackMessageTs: string | null | undefined): boolean {
  return Boolean(threadTs && slackMessageTs && threadTs !== slackMessageTs);
}

export function publicSummary(text: string): string {
  return parseMessageText(text).preview;
}

export function countIstDay(
  messages: Array<{ text: string; threadTs: string | null; slackMessageTs: string; eventReceivedAt: string }>,
  waitingForReview: number,
  now: Date,
): DayCounts {
  const { start, end } = istDayBounds(now);
  let orderSheets = 0;
  let threadAdvances = 0;
  for (const message of messages) {
    const received = new Date(message.eventReceivedAt).getTime();
    if (received < start.getTime() || received >= end.getTime()) continue;
    const read = parseMessageText(message.text);
    if (isThreadReply(message.threadTs, message.slackMessageTs)) {
      if (read.intent === "payment_mention" || /\badvance\b/i.test(message.text)) threadAdvances += 1;
      continue;
    }
    if (read.product || read.offeredPriceMinor != null) orderSheets += 1;
  }
  return { orderSheets, threadAdvances, waitingForReview };
}

export type CustomerSource = {
  id: string;
  eventReceivedAt: string;
  channelId: string;
  text: string;
  customerName: string | null;
  review: InboxRow["review"];
  processingStatus: ProcessingStatus;
  threadTs: string | null;
  slackMessageTs: string | null;
};

export function groupCustomerOrders(rows: CustomerSource[], replyCounts: Map<string, number>, rawQuery: string): CustomerGroup[] {
  const q = sanitizeSearch(rawQuery).toLowerCase();
  const groups = new Map<string, CustomerGroup>();
  for (const row of rows) {
    if (isThreadReply(row.threadTs, row.slackMessageTs)) continue;
    const read = parseMessageText(row.text);
    const name = (row.customerName || read.customerName || "").trim();
    const product = read.product;
    const sheet = Boolean(product || read.offeredPriceMinor != null);
    const haystack = `${name} ${product ?? ""}`.toLowerCase();
    if (q) {
      if (!haystack.includes(q)) continue;
    } else if (!sheet && !name) {
      continue;
    }
    if (!name && !product) continue;
    const label = name || "Unnamed customer";
    const key = label.toLowerCase();
    const group = groups.get(key) ?? { customerName: label, orders: [] };
    group.orders.push({
      id: row.id,
      eventReceivedAt: row.eventReceivedAt,
      customerName: name || null,
      product,
      offeredPriceMinor: read.offeredPriceMinor,
      customerType: read.customerType,
      summary: read.preview,
      review: row.review,
      processingStatus: row.processingStatus,
      threadUpdates: replyCounts.get(`${row.channelId}:${row.slackMessageTs}`) ?? 0,
    });
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      orders: group.orders.sort((a, b) => b.eventReceivedAt.localeCompare(a.eventReceivedAt)),
    }))
    .sort((a, b) => (b.orders[0]?.eventReceivedAt ?? "").localeCompare(a.orders[0]?.eventReceivedAt ?? ""))
    .slice(0, 40);
}

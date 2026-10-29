import { isoDateInIst, istDayBounds } from "@/lib/format";
import { parseMessageText, toMinorUnits } from "@/lib/parse/message";
import { matchesInboxQuery, sanitizeSearch } from "@/lib/query";
import type { CustomerGroup, DayCounts, InboxRow, MessageQuery, ProcessingStatus } from "@/lib/types";

export type CompleteOrder = {
  customerName: string;
  product: string;
  offeredPriceMinor: number;
  customerType: string | null;
  advanceMinor: number | null;
};

export function readCompleteOrder(text: string): CompleteOrder | null {
  const read = parseMessageText(text);
  if (!read.customerName?.trim() || !read.product?.trim() || read.offeredPriceMinor == null) return null;
  const advanceLine = text.split(/\n+/).map((line) => line.trim()).find((line) => /^advance\b/i.test(line));
  const advanceMinor = advanceLine ? toMinorUnits(advanceLine.replace(/^advance\b/i, "").replace(/^[:\-]\s*/, "").replace(/[^\d.]/g, "")) : null;
  return {
    customerName: read.customerName.trim(),
    product: read.product.trim(),
    offeredPriceMinor: read.offeredPriceMinor,
    customerType: read.customerType,
    advanceMinor,
  };
}

export function orderDayKey(customerName: string, product: string, iso: string): string {
  return `${isoDateInIst(new Date(iso))}|${customerName.trim().toLowerCase()}|${product.trim().toLowerCase()}`;
}

export function collapseCompleteOrders<T extends InboxRow>(rows: T[]): T[] {
  const sorted = [...rows].sort((a, b) => b.eventReceivedAt.localeCompare(a.eventReceivedAt));
  const kept = new Map<string, T>();
  for (const row of sorted) {
    const order = readCompleteOrder(row.text);
    if (!order) continue;
    const key = orderDayKey(order.customerName, order.product, row.eventReceivedAt);
    const existing = kept.get(key);
    if (!existing) {
      kept.set(key, { ...row });
      continue;
    }
    existing.threadUpdateCount = (existing.threadUpdateCount ?? 0) + (row.threadUpdateCount ?? 0);
  }
  return [...kept.values()].sort((a, b) => b.eventReceivedAt.localeCompare(a.eventReceivedAt));
}

export function prepareInbox<T extends InboxRow>(rows: T[], query: MessageQuery): T[] {
  const matched = rows.filter((row) => matchesInboxQuery(row, query));
  if (query.view !== "orders") return matched;
  return collapseCompleteOrders(matched.filter((row) => row.processingStatus !== "skipped" && readCompleteOrder(row.text)));
}

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
  let threadAdvances = 0;
  const sheets = [];
  for (const message of messages) {
    const received = new Date(message.eventReceivedAt).getTime();
    if (received < start.getTime() || received >= end.getTime()) continue;
    const read = parseMessageText(message.text);
    if (isThreadReply(message.threadTs, message.slackMessageTs)) {
      if (read.intent === "payment_mention" || /\badvance\b/i.test(message.text)) threadAdvances += 1;
      continue;
    }
    const order = readCompleteOrder(message.text);
    if (order) sheets.push({ ...order, at: message.eventReceivedAt });
  }
  const seen = new Set<string>();
  let offeredMinor = 0;
  const latest = [...sheets].sort((a, b) => b.at.localeCompare(a.at));
  for (const sheet of latest) {
    const key = orderDayKey(sheet.customerName, sheet.product, sheet.at);
    if (seen.has(key)) continue;
    seen.add(key);
    offeredMinor += sheet.offeredPriceMinor;
  }
  return { orderSheets: seen.size, offeredMinor, threadAdvances, waitingForReview };
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
    const order = readCompleteOrder(row.text);
    if (!order) continue;
    const name = order.customerName;
    const product = order.product;
    const haystack = `${name} ${product}`.toLowerCase();
    if (q && !haystack.includes(q)) continue;
    const label = name;
    const key = label.toLowerCase();
    const group = groups.get(key) ?? { customerName: label, orders: [] };
    const dayKey = orderDayKey(name, product, row.eventReceivedAt);
    if (group.orders.some((existing) => orderDayKey(existing.customerName ?? name, existing.product ?? product, existing.eventReceivedAt) === dayKey)) continue;
    group.orders.push({
      id: row.id,
      eventReceivedAt: row.eventReceivedAt,
      customerName: name || null,
      product,
      offeredPriceMinor: order.offeredPriceMinor,
      customerType: order.customerType,
      summary: publicSummary(row.text),
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

import { formatInrFromMinor, isoDateInIst, istDayBounds } from "@/lib/format";
import { parseMessageText, toMinorUnits } from "@/lib/parse/message";
import { matchesInboxQuery, sanitizeSearch } from "@/lib/query";
import type { CustomerGroup, DayCounts, InboxRow, MessageQuery, ProcessingStatus } from "@/lib/types";

const MAX_OFFERED_MINOR = 10_000_000_000;

export type CompleteOrder = {
  customerName: string;
  product: string;
  offeredPriceMinor: number;
  listPriceMinor: number | null;
  customerType: string | null;
  advanceMinor: number | null;
  hub: string | null;
  poc: string | null;
  saleSource: string | null;
  saleType: string | null;
  paymentStatus: string | null;
  paymentMode: string | null;
  accessories: string | null;
  extendedWarranty: string | null;
  installation: string | null;
  gst: string | null;
  notes: string | null;
};

function lineValue(text: string, label: string): string | null {
  const prefix = label.toLowerCase();
  for (const raw of text.split(/\n+/)) {
    const line = raw.replace(/^[\s•*-]+/, "").trim();
    if (!line.toLowerCase().startsWith(prefix)) continue;
    const rest = line.slice(label.length).replace(/^[\s:–\-]+/, "").replace(/\s+/g, " ").trim();
    if (rest) return rest;
  }
  return null;
}

function cleanProduct(value: string): string {
  return value.replace(/^[\s.•*\-–:]+/, "").replace(/^name\s*[:\-]\s*/i, "").replace(/\s+/g, " ").trim();
}

function humanName(value: string | null): string | null {
  const name = value?.replace(/\s+/g, " ").trim() ?? "";
  if (name.length < 2 || /^U[A-Z0-9]+$/.test(name)) return null;
  return name;
}

export function readCompleteOrder(text: string): CompleteOrder | null {
  const read = parseMessageText(text);
  const product = cleanProduct(read.product ?? "");
  if (!read.customerName?.trim() || !product || read.offeredPriceMinor == null || read.offeredPriceMinor > MAX_OFFERED_MINOR) return null;
  const advanceLine = text.split(/\n+/).map((line) => line.trim()).find((line) => /^advance\b/i.test(line));
  const advanceMinor = advanceLine ? toMinorUnits(advanceLine.replace(/^advance\b/i, "").replace(/^[:\-]\s*/, "").replace(/[^\d.]/g, "")) : null;
  return {
    customerName: read.customerName.trim(),
    product,
    offeredPriceMinor: read.offeredPriceMinor,
    listPriceMinor: read.listPriceMinor,
    customerType: read.customerType ?? lineValue(text, "cx type"),
    advanceMinor,
    hub: lineValue(text, "hub"),
    poc: humanName(lineValue(text, "poc")),
    saleSource: lineValue(text, "sale source"),
    saleType: lineValue(text, "sale type"),
    paymentStatus: lineValue(text, "payment status"),
    paymentMode: lineValue(text, "payment mode"),
    accessories: lineValue(text, "accessories"),
    extendedWarranty: lineValue(text, "extended warranty"),
    installation: lineValue(text, "installation"),
    gst: lineValue(text, "gst"),
    notes: lineValue(text, "notes"),
  };
}

function filledAddon(value: string | null): boolean {
  return Boolean(value && !/^none$/i.test(value) && !/^not available$/i.test(value));
}

export function addonSummary(order: CompleteOrder): string {
  const parts: string[] = [];
  if (filledAddon(order.accessories)) {
    const amount = order.accessories!.replace(/,/g, "");
    const minor = /^\d+(\.\d{1,2})?$/.test(amount) ? toMinorUnits(amount) : null;
    parts.push(minor != null ? `Accessories ${formatInrFromMinor(minor)}` : order.accessories!);
  }
  if (filledAddon(order.extendedWarranty)) parts.push(`Warranty ${order.extendedWarranty}`);
  if (filledAddon(order.installation)) parts.push(/^added$/i.test(order.installation!) ? "Installation" : `Installation ${order.installation}`);
  return parts.join(" · ");
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

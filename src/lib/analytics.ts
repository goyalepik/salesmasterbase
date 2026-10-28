import { isoDateInIst, istDayBounds } from "@/lib/format";
import type { ActivityPoint, MessageIntent, ProcessingStatus } from "@/lib/types";

export type DayBucket = {
  day: string;
  received: number;
  processed: number;
  review: number;
  failed: number;
};

export type CategorySlice = {
  key: string;
  label: string;
  count: number;
  percent: number;
};

export type ContributorRank = {
  key: string;
  label: string;
  messages: number;
  sampleIds: string[];
};

const INTENT_LABEL: Record<MessageIntent, string> = {
  payment_mention: "Payment mention",
  order_update: "Order update",
  unclassified: "Unclassified",
};

export function chartRange(now: Date, days: number): { fromIso: string; toIso: string; days: string[] } {
  const { start } = istDayBounds(now);
  const from = new Date(start.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  const to = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const labels: string[] = [];
  for (let index = 0; index < days; index += 1) {
    labels.push(isoDateInIst(new Date(from.getTime() + index * 24 * 60 * 60 * 1000)));
  }
  return { fromIso: from.toISOString(), toIso: to.toISOString(), days: labels };
}

export function buildDailySeries(points: ActivityPoint[], days: string[]): DayBucket[] {
  const buckets = new Map<string, DayBucket>(days.map((day) => [day, { day, received: 0, processed: 0, review: 0, failed: 0 }]));
  for (const point of points) {
    const day = isoDateInIst(new Date(point.eventReceivedAt));
    const bucket = buckets.get(day);
    if (!bucket) continue;
    bucket.received += 1;
    if (point.processingStatus === "processed") bucket.processed += 1;
    if (point.processingStatus === "needs_review") bucket.review += 1;
    if (point.processingStatus === "failed") bucket.failed += 1;
  }
  return days.map((day) => buckets.get(day)!);
}

export function seriesHasActivity(series: DayBucket[]): boolean {
  return series.some((day) => day.received > 0);
}

export function buildCategories(points: ActivityPoint[]): CategorySlice[] {
  const counts = new Map<string, number>();
  for (const point of points) {
    if (point.processingStatus === "skipped") continue;
    const key = point.intent && point.intent in INTENT_LABEL ? point.intent : "unclassified";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  if (total === 0) return [];
  return [...counts.entries()]
    .map(([key, count]) => ({
      key,
      label: INTENT_LABEL[key as MessageIntent] ?? "Unclassified",
      count,
      percent: Math.round((count / total) * 1000) / 10,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function contributorKey(point: ActivityPoint): { key: string; label: string } | null {
  if (point.processingStatus === "skipped") return null;
  if (point.senderName?.trim()) return { key: `name:${point.senderName.trim().toLowerCase()}`, label: point.senderName.trim() };
  if (point.senderId?.trim()) return { key: `id:${point.senderId.trim()}`, label: point.senderId.trim() };
  return null;
}

export function rankContributors(points: ActivityPoint[]): ContributorRank[] {
  const groups = new Map<string, ContributorRank>();
  for (const point of points) {
    const person = contributorKey(point);
    if (!person) continue;
    const current = groups.get(person.key) ?? { key: person.key, label: person.label, messages: 0, sampleIds: [] };
    current.messages += 1;
    if (current.sampleIds.length < 5) current.sampleIds.push(point.id);
    groups.set(person.key, current);
  }
  return [...groups.values()].sort((a, b) => b.messages - a.messages || a.label.localeCompare(b.label));
}

export function distinctOrderReferences(points: ActivityPoint[]): number {
  return new Set(points.map((point) => point.orderReference).filter((value): value is string => Boolean(value))).size;
}

export function messagesWithAmount(points: ActivityPoint[]): number {
  return points.filter((point) => point.amountMinor != null).length;
}

export function countStatus(points: ActivityPoint[], status: ProcessingStatus): number {
  return points.filter((point) => point.processingStatus === status).length;
}

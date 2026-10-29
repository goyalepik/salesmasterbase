import "server-only";

import { chartRange, countStatus } from "@/lib/analytics";
import { founderBrief } from "@/lib/ai/brief";
import { classifyQuestion, type QuestionKind } from "@/lib/ai/classify";
import type { GroundedFacts, SourceRef } from "@/lib/ai/ground";
import { formatDateTime, istDayBounds, lastDaysBounds } from "@/lib/format";
import { incentiveBySender } from "@/lib/incentive";
import type { OpsRepository } from "@/lib/repository";
import type { ActivityPoint } from "@/lib/types";

function safeLabel(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "")
    .replace(/\b\d{10,}\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function sourcesFrom(points: ActivityPoint[], limit = 3): SourceRef[] {
  return points.slice(0, limit).map((point) => ({
    id: point.id,
    href: `/inbox/${point.id}`,
    label: safeLabel(`${formatDateTime(point.eventReceivedAt)} · ${point.customerName ?? point.preview}`),
  }));
}

export async function factsForQuestion(input: {
  repo: OpsRepository;
  mode: "demo" | "live";
  question: string;
  now: Date;
}): Promise<{ kind: QuestionKind; facts: GroundedFacts }> {
  const kind = classifyQuestion(input.question);
  const today = istDayBounds(input.now);
  const five = lastDaysBounds(input.now, 5);
  const week = chartRange(input.now, 7);
  const range = kind === "week_summary" || kind === "recent"
    ? week
    : kind === "contributors"
      ? { fromIso: five.start.toISOString(), toIso: five.end.toISOString(), days: [] }
      : { fromIso: today.start.toISOString(), toIso: today.end.toISOString(), days: [] };
  const activity = await input.repo.listActivity(range.fromIso, range.toIso);
  const points = activity.points;
  const notes = [
    activity.truncated ? "The query stopped at 2,000 messages." : "",
    input.mode === "demo" ? "The rows are sample data." : "",
  ].filter(Boolean);

  if (kind === "needs_review" || kind === "missing_amounts") {
    const exceptions = await input.repo.listExceptions({
      status: "open",
      type: "all",
      severity: "all",
      page: 1,
      pageSize: 25,
    });
    const matched = kind === "missing_amounts"
      ? exceptions.items.filter((item) => item.type === "ambiguous_amount" || item.type === "missing_info" && item.reason.toLowerCase().includes("amount"))
      : exceptions.items;
    const total = kind === "missing_amounts" ? matched.length : exceptions.total;
    const briefFacts = {
      kind,
      messages: 0,
      paymentMentions: 0,
      paymentsWithAmount: 0,
      missingCustomer: 0,
      needsReview: total,
      openItems: total,
      topName: null,
      topOrders: 0,
      unnamedSenders: 0,
    };
    return {
      kind,
      facts: {
        mode: input.mode,
        question: input.question,
        rangeLabel: "Open items",
        counts: { "Open items": total },
        notes,
        sources: matched.slice(0, 3).map((item) => ({
          id: item.id,
          href: `/inbox/${item.messageId}`,
          label: safeLabel(item.reason),
        })),
        brief: founderBrief(briefFacts),
      },
    };
  }

  const payment = points.filter((point) => point.intent === "payment_mention");
  const paymentsWithAmount = payment.filter((point) => point.amountMinor != null).length;
  const missingCustomer = points.filter((point) => !point.customerName).length;
  let topName: string | null = null;
  let topOrders = 0;
  let unnamedSenders = new Set(points.filter((point) => point.senderId && !point.senderName).map((point) => point.senderId)).size;
  let sources = sourcesFrom(kind === "payment_today" ? payment : points);
  if (kind === "contributors") {
    const rows = await input.repo.listSenderActivity(five.start.toISOString(), five.end.toISOString());
    const people = incentiveBySender(rows, await input.repo.senderAliases());
    const top = people[0];
    topName = top?.name ?? null;
    topOrders = top?.orders ?? 0;
    unnamedSenders = people.filter((person) => !person.name).length;
    sources = (top?.sampleIds ?? []).map((id) => ({ id, href: `/inbox/${id}`, label: "Order sheet" }));
  }
  const counts: Record<string, number> = {
    Messages: points.length,
    "Payment mentions": payment.length,
    "Payments with amount": paymentsWithAmount,
    "Missing customer": missingCustomer,
    "Needs review": countStatus(points, "needs_review"),
    "Open items": 0,
    "Top orders": topOrders,
    "Unnamed senders": unnamedSenders,
  };
  return {
    kind,
    facts: {
      mode: input.mode,
      question: input.question,
      rangeLabel: kind === "contributors" ? "Last 5 IST days" : kind === "week_summary" || kind === "recent" ? "Last 7 IST days" : "Today, IST",
      counts,
      notes,
      sources,
      brief: founderBrief({
        kind,
        messages: points.length,
        paymentMentions: payment.length,
        paymentsWithAmount,
        missingCustomer,
        needsReview: countStatus(points, "needs_review"),
        openItems: 0,
        topName,
        topOrders,
        unnamedSenders,
      }),
    },
  };
}

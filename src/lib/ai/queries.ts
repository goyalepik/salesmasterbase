import "server-only";

import { chartRange, countStatus, distinctOrderReferences, messagesWithAmount, rankContributors } from "@/lib/analytics";
import { classifyQuestion, type QuestionKind } from "@/lib/ai/classify";
import type { GroundedFacts, SourceRef } from "@/lib/ai/ground";
import { formatDateTime, istDayBounds } from "@/lib/format";
import type { OpsRepository } from "@/lib/repository";
import type { ActivityPoint } from "@/lib/types";

function sourcesFrom(points: ActivityPoint[], limit = 8): SourceRef[] {
  return points.slice(0, limit).map((point) => ({
    id: point.id,
    href: `/inbox/${point.id}`,
    label: `${formatDateTime(point.eventReceivedAt)} · ${point.preview.slice(0, 80)}`,
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
  const week = chartRange(input.now, 7);
  const range = kind === "week_summary" || kind === "contributors" ? week : { fromIso: today.start.toISOString(), toIso: today.end.toISOString(), days: [] };
  if (kind === "recent") {
    const recent = chartRange(input.now, 7);
    range.fromIso = recent.fromIso;
    range.toIso = recent.toIso;
  }
  const activity = await input.repo.listActivity(range.fromIso, range.toIso);
  const points = activity.points;
  const notes = [
    "Counts are calculated in the application. They are not model estimates.",
    activity.truncated ? "The query stopped at 2,000 messages." : "",
    input.mode === "demo" ? "The rows are sample data." : "The rows are stored records for this workspace.",
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
    return {
      kind,
      facts: {
        mode: input.mode,
        question: input.question,
        rangeLabel: kind === "missing_amounts" ? "Open exceptions that mention a missing or ambiguous amount" : "Open exceptions",
        counts: { "Open items": total },
        notes: [...notes, kind === "missing_amounts" ? "The amount count is limited to the first 25 open exceptions." : ""].filter(Boolean),
        sources: matched.slice(0, 8).map((item) => ({
          id: item.id,
          href: `/inbox/${item.messageId}`,
          label: item.reason,
        })),
      },
    };
  }

  const payment = points.filter((point) => point.intent === "payment_mention");
  const ranked = rankContributors(points);
  const counts: Record<string, number> = {
    Messages: points.length,
    "Payment mentions": payment.length,
    Processed: countStatus(points, "processed"),
    "Needs review": countStatus(points, "needs_review"),
    Failed: countStatus(points, "failed"),
    "Distinct order references": distinctOrderReferences(points),
    "Messages with an extracted amount": messagesWithAmount(points),
  };
  if (kind === "contributors") {
    counts.Contributors = ranked.length;
    if (ranked[0]) counts["Top contributor messages"] = ranked[0].messages;
    notes.push(ranked[0] ? `Top contributor label: ${ranked[0].label}.` : "No eligible sender was found in this range.");
  }
  const focus = kind === "payment_today" ? payment : points;
  return {
    kind,
    facts: {
      mode: input.mode,
      question: input.question,
      rangeLabel: kind === "week_summary" || kind === "contributors" || kind === "recent" ? "Last 7 IST days" : "Today, IST",
      counts,
      notes,
      sources: sourcesFrom(focus),
    },
  };
}

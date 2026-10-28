import { createRulesIntelligence } from "@/lib/ai/intelligence";
import { decideProcessing } from "@/lib/parse/decide";
import type { OpsRepository } from "@/lib/repository";
import { MAX_PROCESSING_ATTEMPTS } from "@/lib/types";

export type ProcessOutcome = "processed" | "needs_review" | "skipped" | "failed" | "busy" | "missing" | "exhausted";

export async function processStoredMessage(
  repo: OpsRepository,
  messageId: string,
  options: { monitoredChannelId: string | null },
): Promise<ProcessOutcome> {
  const claimed = await repo.claim(messageId);
  if (!claimed) {
    const current = await repo.getMessage(messageId);
    if (!current) return "missing";
    if (current.retryCount >= MAX_PROCESSING_ATTEMPTS && current.processingStatus === "failed") return "exhausted";
    return "busy";
  }

  const startedAt = new Date().toISOString();
  const attemptNumber = claimed.retryCount + 1;
  await repo.appendAudit({
    action: "processing_started",
    entityType: "slack_message",
    entityId: messageId,
    outcome: "success",
    actor: "system",
    summary: `Attempt ${attemptNumber}.`,
  });

  try {
    const intelligence = createRulesIntelligence();
    const extract = await intelligence.extract(claimed.text);
    const related = extract.orderReferences.length
      ? await repo.findByOrderReferences(extract.orderReferences, claimed.id)
      : [];
    const decision = decideProcessing({
      text: claimed.text,
      subtype: claimed.subtype,
      botId: claimed.botId,
      channelId: claimed.slackChannelId,
      monitoredChannelId: options.monitoredChannelId,
      related,
      extract,
    });
    await repo.complete(claimed.id, {
      ...decision,
      attemptNumber,
      startedAt,
    });
    if (claimed.threadTs && claimed.threadTs !== claimed.slackMessageTs && decision.extraction?.intent === "payment_mention") {
      const parent = await repo.findBySlackTs(claimed.slackChannelId, claimed.threadTs);
      if (parent && parent.id !== claimed.id) {
        await repo.flagThreadAdvance(parent.id, claimed.id, decision.extraction.amountText);
      }
    }
    return decision.status;
  } catch (error) {
    const summary = error instanceof Error ? error.message : "Processing failed.";
    try {
      await repo.fail(claimed.id, summary, attemptNumber, startedAt);
    } catch {
      // The failed state stays visible as a stuck processing row until reclaim.
    }
    return "failed";
  }
}

import { parseMessageText } from "@/lib/parse/message";
import type { ExceptionDraft, ExtractionDraft, FieldExtract, RelatedExtract } from "@/lib/types";

const SKIP_SUBTYPES = new Set([
  "bot_message",
  "message_changed",
  "message_deleted",
  "message_replied",
  "channel_join",
  "channel_leave",
  "channel_topic",
  "channel_purpose",
  "channel_name",
  "channel_archive",
  "channel_unarchive",
  "group_join",
  "group_leave",
  "tombstone",
  "thread_broadcast",
]);

export type SkipDecision = { skip: true; reason: string } | { skip: false };

export function skipDecision(input: {
  text: string;
  subtype: string | null;
  botId: string | null;
  channelId: string;
  monitoredChannelId: string | null;
}): SkipDecision {
  if (input.subtype && SKIP_SUBTYPES.has(input.subtype)) return { skip: true, reason: input.subtype };
  if (input.botId) return { skip: true, reason: "bot_message" };
  if (input.monitoredChannelId && input.channelId !== input.monitoredChannelId) {
    return { skip: true, reason: "outside_monitored_channel" };
  }
  if (!input.text.trim()) return { skip: true, reason: "empty_text" };
  return { skip: false };
}

export type ProcessingDecision = {
  status: "processed" | "needs_review" | "skipped";
  skipReason: string | null;
  extraction: ExtractionDraft | null;
  exceptions: ExceptionDraft[];
};

function fieldsOf(extract: FieldExtract): Record<string, string | null> {
  return {
    customerName: extract.customerName,
    orderReference: extract.orderReferences.join(", ") || null,
    amountText: extract.amounts.map((amount) => amount.text).join(" · ") || null,
  };
}

export function decideProcessing(input: {
  text: string;
  subtype: string | null;
  botId: string | null;
  channelId: string;
  monitoredChannelId: string | null;
  related: RelatedExtract[];
  extract?: FieldExtract;
}): ProcessingDecision {
  const skipped = skipDecision(input);
  if (skipped.skip) {
    return { status: "skipped", skipReason: skipped.reason, extraction: null, exceptions: [] };
  }

  const extract = input.extract ?? parseMessageText(input.text);
  const amountText = extract.amounts.map((amount) => amount.text).join(" · ") || null;
  const distinctMinors = extract.amounts.flatMap((amount) => (amount.minor == null ? [] : [amount.minor]));
  const uniqueMinors = [...new Set(distinctMinors)];
  const singleAmount = uniqueMinors.length === 1 ? uniqueMinors[0] ?? null : null;
  const orderReference = extract.orderReferences.length === 1 ? extract.orderReferences[0] ?? null : null;
  const exceptions: ExceptionDraft[] = [];
  const relevant = fieldsOf(extract);
  const missing: string[] = [];

  const salesLike = extract.intent === "payment_mention" || extract.intent === "order_update";
  if (salesLike && !extract.customerName && extract.orderReferences.length === 0 && extract.amounts.length === 0) {
    exceptions.push({
      type: "parse_failure",
      severity: "medium",
      reason: "The message looks operational, but no customer, order reference, or amount could be read.",
      relevantFields: relevant,
    });
    missing.push("customer", "order_reference", "amount");
  } else if (salesLike) {
    if (extract.intent === "payment_mention" && extract.amounts.length === 0) {
      exceptions.push({
        type: "missing_info",
        severity: "high",
        reason: "The message mentions a payment, but no amount could be read.",
        relevantFields: relevant,
      });
      missing.push("amount");
    }
    if (extract.amounts.length > 1) {
      exceptions.push({
        type: "ambiguous_amount",
        severity: "high",
        reason: "More than one amount is present. Neither amount is treated as the payment.",
        relevantFields: relevant,
      });
    }
    if (extract.orderReferences.length === 0 && extract.intent === "payment_mention") {
      exceptions.push({
        type: "missing_info",
        severity: "medium",
        reason: "The message mentions a payment, but no order reference could be read.",
        relevantFields: relevant,
      });
      missing.push("order_reference");
    }
    if (extract.orderReferences.length > 1) {
      exceptions.push({
        type: "ambiguous_order",
        severity: "high",
        reason: "More than one order reference is present.",
        relevantFields: relevant,
      });
    }
    if (!extract.customerName && extract.intent === "payment_mention" && extract.orderReferences.length === 0) {
      exceptions.push({
        type: "missing_info",
        severity: "low",
        reason: "No customer name was labelled in the message.",
        relevantFields: relevant,
      });
      missing.push("customer");
    }
  }

  const primaryOrder = extract.orderReferences.length === 1 ? extract.orderReferences[0] : null;
  if (primaryOrder && singleAmount != null) {
    const duplicate = input.related.find(
      (item) => item.orderReference?.toUpperCase() === primaryOrder.toUpperCase() && item.amountMinor === singleAmount,
    );
    if (duplicate) {
      exceptions.push({
        type: "potential_duplicate",
        severity: "medium",
        reason: "Another stored message has the same order reference and the same extracted amount.",
        relevantFields: { ...relevant, relatedMessageId: duplicate.messageId },
      });
    }
  }
  if (primaryOrder && singleAmount != null) {
    const conflict = input.related.find(
      (item) =>
        item.orderReference?.toUpperCase() === primaryOrder.toUpperCase() &&
        item.amountMinor != null &&
        item.amountMinor !== singleAmount,
    );
    if (conflict) {
      exceptions.push({
        type: "conflicting_info",
        severity: "high",
        reason: "Another stored message uses this order reference with a different extracted amount.",
        relevantFields: { ...relevant, relatedMessageId: conflict.messageId },
      });
    }
  }

  const extraction: ExtractionDraft = {
    customerName: extract.customerName,
    orderReference: orderReference ?? (extract.orderReferences.join(", ") || null),
    amountText,
    amountMinor: uniqueMinors.length === 1 ? singleAmount : null,
    currency: "INR",
    paymentModeMention: extract.paymentModeMention,
    intent: extract.intent,
    preview: extract.preview,
    missingFields: missing,
    extractSource: extract.source,
  };

  if (extract.intent === "unclassified") {
    return { status: "processed", skipReason: null, extraction, exceptions: [] };
  }

  return {
    status: exceptions.length > 0 ? "needs_review" : "processed",
    skipReason: null,
    extraction,
    exceptions,
  };
}

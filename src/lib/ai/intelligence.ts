import { parseMessageText } from "@/lib/parse/message";
import type { FieldExtract } from "@/lib/types";

/**
 * Future model-backed extraction implements this interface.
 * The current release only ships the rules implementation.
 * Ingestion does not call an AI provider.
 */
export interface MessageIntelligence {
  readonly source: "rules" | "model";
  extract(text: string): Promise<FieldExtract>;
}

export function createRulesIntelligence(): MessageIntelligence {
  return {
    source: "rules",
    async extract(text: string) {
      return parseMessageText(text);
    },
  };
}

export type FutureAgentAction =
  | "categorise"
  | "draft_extraction"
  | "internal_task"
  | "daily_summary"
  | "payment_verification"
  | "financial_change"
  | "customer_communication"
  | "delete_or_merge"
  | "external_action";

export const AUTOMATIC_LATER: FutureAgentAction[] = [
  "categorise",
  "draft_extraction",
  "internal_task",
  "daily_summary",
];

export const HUMAN_APPROVAL_REQUIRED: FutureAgentAction[] = [
  "payment_verification",
  "financial_change",
  "customer_communication",
  "delete_or_merge",
  "external_action",
];

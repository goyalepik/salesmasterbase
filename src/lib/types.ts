export const PROCESSING_STATUSES = [
  "received",
  "processing",
  "processed",
  "needs_review",
  "failed",
  "skipped",
] as const;

export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

export const EXCEPTION_TYPES = [
  "missing_info",
  "ambiguous_amount",
  "ambiguous_order",
  "potential_duplicate",
  "parse_failure",
  "conflicting_info",
] as const;

export type ExceptionType = (typeof EXCEPTION_TYPES)[number];
export type ExceptionSeverity = "low" | "medium" | "high";
export type ExceptionStatus = "open" | "resolved" | "superseded";
export type ExtractSource = "rules" | "model";
export type MessageIntent = "payment_mention" | "order_update" | "unclassified";

export type Extraction = {
  id: string;
  messageId: string;
  customerName: string | null;
  orderReference: string | null;
  amountText: string | null;
  amountMinor: number | null;
  currency: "INR";
  paymentModeMention: string | null;
  intent: MessageIntent;
  preview: string;
  missingFields: string[];
  extractSource: ExtractSource;
  verification: "unverified";
  verifiedCustomerName: string | null;
  verifiedOrderReference: string | null;
  verifiedAmountMinor: number | null;
  createdAt: string;
};

export type SlackMessage = {
  id: string;
  slackTeamId: string | null;
  slackChannelId: string;
  slackChannelName: string | null;
  slackMessageTs: string;
  slackEventId: string | null;
  senderId: string | null;
  senderName: string | null;
  text: string;
  threadTs: string | null;
  permalink: string | null;
  subtype: string | null;
  botId: string | null;
  eventReceivedAt: string;
  processingStatus: ProcessingStatus;
  retryCount: number;
  processingError: string | null;
  skipReason: string | null;
  sourceMetadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ExceptionRecord = {
  id: string;
  messageId: string;
  type: ExceptionType;
  severity: ExceptionSeverity;
  reason: string;
  relevantFields: Record<string, string | null>;
  status: ExceptionStatus;
  resolutionNote: string | null;
  resolvedAt: string | null;
  resolver: string | null;
  createdAt: string;
};

export type AuditEntry = {
  id: string;
  createdAt: string;
  action: string;
  entityType: string;
  entityId: string;
  outcome: "success" | "failure";
  actor: string;
  summary: string;
};

export type ProcessingAttempt = {
  id: string;
  messageId: string;
  attemptNumber: number;
  startedAt: string;
  finishedAt: string | null;
  outcome: "success" | "failure" | "skipped";
  errorSummary: string | null;
};

export type InboxRow = {
  id: string;
  eventReceivedAt: string;
  channelId: string;
  channelName: string | null;
  senderId: string | null;
  senderName: string | null;
  text: string;
  preview: string;
  customerName: string | null;
  orderReference: string | null;
  amountText?: string | null;
  amountMinor?: number | null;
  processingStatus: ProcessingStatus;
  review: "required" | "clear" | "not_applicable";
};

export type MessageDetail = SlackMessage & {
  extraction: Extraction | null;
  exceptions: ExceptionRecord[];
  attempts: ProcessingAttempt[];
  audit: AuditEntry[];
};

export type AttentionItem = {
  id: string;
  messageId: string;
  type: ExceptionType;
  severity: ExceptionSeverity;
  reason: string;
  createdAt: string;
  customerName: string | null;
  orderReference: string | null;
};

export type OverviewData = {
  messagesToday: number;
  processedToday: number;
  reviewBacklog: number;
  failedOrDelayed: number;
  latestMessageAt: string | null;
  recent: InboxRow[];
  attention: AttentionItem[];
};

export type PageResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type MessageQuery = {
  q: string;
  status: ProcessingStatus | "all";
  channel: string;
  from: string;
  to: string;
  page: number;
  pageSize: number;
};

export type ExceptionQuery = {
  status: ExceptionStatus | "all";
  type: ExceptionType | "all";
  severity: ExceptionSeverity | "all";
  page: number;
  pageSize: number;
};

export type AuditQuery = {
  action: string;
  outcome: "success" | "failure" | "all";
  page: number;
  pageSize: number;
};

export type SalesRecord = {
  messageId: string;
  eventReceivedAt: string;
  customerName: string | null;
  orderReference: string | null;
  amountText: string | null;
  amountMinor: number | null;
  paymentModeMention: string | null;
  intent: MessageIntent;
  extractSource: ExtractSource;
  verification: "unverified";
  processingStatus: ProcessingStatus;
  review: "required" | "clear";
};

export type ActivityPoint = {
  id: string;
  eventReceivedAt: string;
  senderName: string | null;
  senderId: string | null;
  processingStatus: ProcessingStatus;
  intent: MessageIntent | null;
  orderReference: string | null;
  customerName: string | null;
  amountMinor: number | null;
  preview: string;
};

export type ChannelOption = {
  id: string;
  name: string | null;
};

export type HealthFacts = {
  lastEventAt: string | null;
  lastError: { at: string; summary: string } | null;
  pendingCount: number;
  failedCount: number;
};

export type FieldExtract = {
  customerName: string | null;
  orderReferences: string[];
  amounts: Array<{ text: string; minor: number | null }>;
  paymentModeMention: string | null;
  intent: MessageIntent;
  preview: string;
  source: ExtractSource;
};

export type ExceptionDraft = {
  type: ExceptionType;
  severity: ExceptionSeverity;
  reason: string;
  relevantFields: Record<string, string | null>;
};

export type ExtractionDraft = {
  customerName: string | null;
  orderReference: string | null;
  amountText: string | null;
  amountMinor: number | null;
  currency: "INR";
  paymentModeMention: string | null;
  intent: MessageIntent;
  preview: string;
  missingFields: string[];
  extractSource: ExtractSource;
};

export type RelatedExtract = {
  messageId: string;
  orderReference: string | null;
  amountMinor: number | null;
  receivedAt: string;
};

export type InboundDraft = {
  slackTeamId: string | null;
  slackChannelId: string;
  slackChannelName: string | null;
  slackMessageTs: string;
  slackEventId: string | null;
  senderId: string | null;
  senderName: string | null;
  text: string;
  threadTs: string | null;
  permalink: string | null;
  subtype: string | null;
  botId: string | null;
  eventReceivedAt: string;
  sourceMetadata: Record<string, unknown>;
};

export type InsertResult =
  | { ok: true; duplicate: boolean; message: SlackMessage }
  | { ok: false; error: string };

export type CompleteResult = {
  status: "processed" | "needs_review" | "skipped";
  skipReason: string | null;
  extraction: ExtractionDraft | null;
  exceptions: ExceptionDraft[];
  attemptNumber: number;
  startedAt: string;
};

export const MAX_PROCESSING_ATTEMPTS = 5;
export const STUCK_PROCESSING_MS = 2 * 60 * 1000;
export const PAGE_SIZE = 25;

export const EXCEPTION_LABELS: Record<ExceptionType, string> = {
  missing_info: "Missing information",
  ambiguous_amount: "Ambiguous amount",
  ambiguous_order: "Ambiguous order reference",
  potential_duplicate: "Potential duplicate",
  parse_failure: "Parsing failure",
  conflicting_info: "Conflicting information",
};

export const STATUS_LABELS: Record<ProcessingStatus, string> = {
  received: "Received",
  processing: "Processing",
  processed: "Processed",
  needs_review: "Needs review",
  failed: "Failed",
  skipped: "Skipped",
};

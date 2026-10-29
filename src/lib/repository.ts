import type {
  ActivityPoint,
  AuditEntry,
  AuditQuery,
  ChannelOption,
  CompleteResult,
  ExceptionQuery,
  ExceptionRecord,
  HealthFacts,
  InboundDraft,
  InsertResult,
  CustomerGroup,
  MessageDetail,
  MessageQuery,
  OverviewData,
  PageResult,
  RelatedExtract,
  SalesRecord,
  SlackMessage,
} from "@/lib/types";

export type ExceptionListItem = ExceptionRecord & {
  customerName: string | null;
  orderReference: string | null;
  preview: string;
};

export interface OpsRepository {
  listMessages(query: MessageQuery): Promise<PageResult<import("@/lib/types").InboxRow>>;
  listThreadReplies(channelId: string, parentTs: string): Promise<import("@/lib/types").InboxRow[]>;
  lookupCustomers(query: string): Promise<CustomerGroup[]>;
  listUnnamedSenderIds(): Promise<string[]>;
  getInboxRow(id: string): Promise<import("@/lib/types").InboxRow | null>;
  getMessage(id: string): Promise<MessageDetail | null>;
  listExceptions(query: ExceptionQuery): Promise<PageResult<ExceptionListItem>>;
  listAudit(query: AuditQuery): Promise<PageResult<AuditEntry>>;
  listRecords(query: MessageQuery): Promise<PageResult<SalesRecord>>;
  overview(now: Date): Promise<OverviewData>;
  listActivity(fromIso: string, toIso: string): Promise<{ points: ActivityPoint[]; truncated: boolean }>;
  listSenderActivity(fromIso: string, toIso: string): Promise<import("@/lib/incentive").SenderActivity[]>;
  senderAliases(): Promise<Record<string, string>>;
  saveSenderName(senderId: string, name: string): Promise<void>;
  channels(): Promise<ChannelOption[]>;
  healthFacts(): Promise<HealthFacts>;
  insertInbound(input: InboundDraft): Promise<InsertResult>;
  claim(messageId: string): Promise<SlackMessage | null>;
  complete(messageId: string, result: CompleteResult): Promise<void>;
  fail(messageId: string, errorSummary: string, attemptNumber: number, startedAt: string): Promise<void>;
  findByOrderReferences(refs: string[], excludeMessageId: string): Promise<RelatedExtract[]>;
  findBySlackTs(channelId: string, ts: string): Promise<SlackMessage | null>;
  flagThreadAdvance(parentId: string, replyId: string, amountText: string | null): Promise<void>;
  reopen(messageId: string): Promise<boolean>;
  rememberSender(senderId: string, senderName: string): Promise<void>;
  resolveException(id: string, note: string, actor: string): Promise<ExceptionRecord>;
  reclaimStuck(olderThanMs: number): Promise<number>;
  appendAudit(entry: Omit<AuditEntry, "id" | "createdAt"> & { createdAt?: string }): Promise<void>;
}

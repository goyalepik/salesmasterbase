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
  getInboxRow(id: string): Promise<import("@/lib/types").InboxRow | null>;
  getMessage(id: string): Promise<MessageDetail | null>;
  listExceptions(query: ExceptionQuery): Promise<PageResult<ExceptionListItem>>;
  listAudit(query: AuditQuery): Promise<PageResult<AuditEntry>>;
  listRecords(query: MessageQuery): Promise<PageResult<SalesRecord>>;
  overview(now: Date): Promise<OverviewData>;
  listActivity(fromIso: string, toIso: string): Promise<{ points: ActivityPoint[]; truncated: boolean }>;
  channels(): Promise<ChannelOption[]>;
  healthFacts(): Promise<HealthFacts>;
  insertInbound(input: InboundDraft): Promise<InsertResult>;
  claim(messageId: string): Promise<SlackMessage | null>;
  complete(messageId: string, result: CompleteResult): Promise<void>;
  fail(messageId: string, errorSummary: string, attemptNumber: number, startedAt: string): Promise<void>;
  findByOrderReferences(refs: string[], excludeMessageId: string): Promise<RelatedExtract[]>;
  resolveException(id: string, note: string, actor: string): Promise<ExceptionRecord>;
  reclaimStuck(olderThanMs: number): Promise<number>;
  appendAudit(entry: Omit<AuditEntry, "id" | "createdAt"> & { createdAt?: string }): Promise<void>;
}

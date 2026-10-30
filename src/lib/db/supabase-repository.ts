import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readEnv } from "@/lib/env";
import { istDayBounds } from "@/lib/format";
import { countIstDay, groupCustomerOrders, isThreadReply, prepareInbox } from "@/lib/orders";
import { log } from "@/lib/log";
import { dateInputToBounds } from "@/lib/format";
import type { OpsRepository } from "@/lib/repository";
import { sanitizeSearch } from "@/lib/query";
import {
  MAX_PROCESSING_ATTEMPTS,
  type CustomerGroup,
  type AuditEntry,
  type AuditQuery,
  type CompleteResult,
  type ExceptionQuery,
  type ExceptionRecord,
  type ExceptionSeverity,
  type ExceptionStatus,
  type ExceptionType,
  type Extraction,
  type HealthFacts,
  type InboundDraft,
  type InboxRow,
  type MessageDetail,
  type MessageIntent,
  type MessageQuery,
  type ProcessingStatus,
  type SlackMessage,
} from "@/lib/types";

type Row = Record<string, unknown>;

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function databaseError(error: { code?: string; message?: string }): never {
  log("error", "database_error", { code: error.code ?? "unknown" });
  throw new Error("The database request failed.");
}

function messageFromRow(row: Row): SlackMessage {
  return {
    id: text(row.id),
    slackTeamId: asString(row.slack_team_id),
    slackChannelId: text(row.slack_channel_id),
    slackChannelName: asString(row.slack_channel_name),
    slackMessageTs: text(row.slack_message_ts),
    slackEventId: asString(row.slack_event_id),
    senderId: asString(row.sender_id),
    senderName: asString(row.sender_name),
    text: text(row.text),
    threadTs: asString(row.thread_ts),
    permalink: asString(row.permalink),
    subtype: asString(row.subtype),
    botId: asString(row.bot_id),
    eventReceivedAt: text(row.event_received_at),
    processingStatus: text(row.processing_status) as ProcessingStatus,
    retryCount: asNumber(row.retry_count) ?? 0,
    processingError: asString(row.processing_error),
    skipReason: asString(row.skip_reason),
    sourceMetadata: (row.source_metadata as Record<string, unknown>) ?? {},
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function extractionFromRow(row: Row): Extraction {
  return {
    id: text(row.id),
    messageId: text(row.message_id),
    customerName: asString(row.customer_name),
    orderReference: asString(row.order_reference),
    amountText: asString(row.amount_text),
    amountMinor: asNumber(row.amount_minor),
    currency: "INR",
    paymentModeMention: asString(row.payment_mode_mention),
    intent: text(row.intent) as MessageIntent,
    preview: text(row.preview),
    missingFields: Array.isArray(row.missing_fields) ? row.missing_fields.filter((item): item is string => typeof item === "string") : [],
    extractSource: text(row.extract_source) === "model" ? "model" : "rules",
    verification: "unverified",
    verifiedCustomerName: asString(row.verified_customer_name),
    verifiedOrderReference: asString(row.verified_order_reference),
    verifiedAmountMinor: asNumber(row.verified_amount_minor),
    createdAt: text(row.created_at),
  };
}

function exceptionFromRow(row: Row): ExceptionRecord {
  return {
    id: text(row.id),
    messageId: text(row.message_id),
    type: text(row.type) as ExceptionType,
    severity: text(row.severity) as ExceptionSeverity,
    reason: text(row.reason),
    relevantFields: (row.relevant_fields as Record<string, string | null>) ?? {},
    status: text(row.status) as ExceptionStatus,
    resolutionNote: asString(row.resolution_note),
    resolvedAt: asString(row.resolved_at),
    resolver: asString(row.resolver),
    createdAt: text(row.created_at),
  };
}

function inboxFromRow(row: Row): InboxRow {
  const status = text(row.processing_status) as ProcessingStatus;
  return {
    id: text(row.id),
    eventReceivedAt: text(row.event_received_at),
    channelId: text(row.slack_channel_id),
    channelName: asString(row.slack_channel_name),
    senderId: asString(row.sender_id),
    senderName: asString(row.sender_name),
    text: text(row.text),
    preview: text(row.preview),
    customerName: asString(row.customer_name),
    orderReference: asString(row.order_reference),
    amountText: asString(row.amount_text),
    amountMinor: asNumber(row.amount_minor),
    processingStatus: status,
    review: status === "skipped" ? "not_applicable" : row.review_required ? "required" : "clear",
  };
}

function quotedLike(query: string): string {
  const escaped = query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_").replaceAll('"', "");
  return `"%${escaped}%"`;
}

export class SupabaseRepository implements OpsRepository {
  constructor(private readonly db: SupabaseClient) {}

  private inboxQuery(query: MessageQuery) {
    let request = this.db.from("inbox_rows").select("*", { count: "exact" });
    if (query.status !== "all") request = request.eq("processing_status", query.status);
    if (query.channel) request = request.eq("slack_channel_id", query.channel);
    const { start, end } = dateInputToBounds(query.from, query.to);
    if (start) request = request.gte("event_received_at", start.toISOString());
    if (end) request = request.lt("event_received_at", end.toISOString());
    const q = sanitizeSearch(query.q);
    if (q) {
      const pattern = quotedLike(q);
      request = request.or(
        [
          `text.ilike.${pattern}`,
          `customer_name.ilike.${pattern}`,
          `order_reference.ilike.${pattern}`,
          `sender_id.ilike.${pattern}`,
          `sender_name.ilike.${pattern}`,
        ].join(","),
      );
    }
    return request;
  }

  private replyIndexCache: { at: number; value: { replyIds: Set<string>; counts: Map<string, number> } } | null = null;

  /** Only threaded rows are read (indexed), and the result is reused for a few seconds. */
  private async threadReplyIndex() {
    if (this.replyIndexCache && Date.now() - this.replyIndexCache.at < 10_000) return this.replyIndexCache.value;
    const rows: Row[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await this.db.from("slack_messages").select("id, slack_channel_id, slack_message_ts, thread_ts").not("thread_ts", "is", null).range(from, from + 999);
      if (error) databaseError(error);
      if (!data?.length) break;
      rows.push(...(data as Row[]));
      if (data.length < 1000) break;
    }
    const replies = rows.filter((row) => isThreadReply(asString(row.thread_ts), text(row.slack_message_ts)));
    const wanted = [...new Set(replies.map((row) => text(row.thread_ts)))];
    const parents = new Set<string>();
    for (let i = 0; i < wanted.length; i += 200) {
      const { data, error } = await this.db.from("slack_messages").select("slack_channel_id, slack_message_ts").in("slack_message_ts", wanted.slice(i, i + 200));
      if (error) databaseError(error);
      for (const row of (data ?? []) as Row[]) parents.add(`${text(row.slack_channel_id)}:${text(row.slack_message_ts)}`);
    }
    const replyIds = new Set<string>();
    const counts = new Map<string, number>();
    for (const row of replies) {
      const key = `${text(row.slack_channel_id)}:${text(row.thread_ts)}`;
      if (!parents.has(key)) continue;
      replyIds.add(text(row.id));
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const value = { replyIds, counts };
    this.replyIndexCache = { at: Date.now(), value };
    return value;
  }

  async listMessages(query: MessageQuery) {
    const index = await this.threadReplyIndex();
    const listed = await this.inboxQuery(query).order("event_received_at", { ascending: false }).limit(5000);
    if (listed.error) databaseError(listed.error);
    if (query.view === "orders") {
      const rows = ((listed.data ?? []) as Row[]).map(inboxFromRow).filter((row) => !index.replyIds.has(row.id));
      const prepared = prepareInbox(rows, query);
      const start = (query.page - 1) * query.pageSize;
      const page = prepared.slice(start, start + query.pageSize);
      const hydrated = await this.withThreads(page);
      return {
        items: hydrated.map((row) => ({ ...row, threadUpdateCount: index.counts.get(`${row.channelId}:${row.slackMessageTs}`) ?? 0 })),
        total: prepared.length,
        page: query.page,
        pageSize: query.pageSize,
      };
    }
    const ids = ((listed.data ?? []) as Row[]).map((row) => text(row.id)).filter((id) => !index.replyIds.has(id));
    const start = (query.page - 1) * query.pageSize;
    const pageIds = ids.slice(start, start + query.pageSize);
    if (pageIds.length === 0) {
      return { items: [], total: ids.length, page: query.page, pageSize: query.pageSize };
    }
    const full = await this.db.from("inbox_rows").select("*").in("id", pageIds);
    if (full.error) databaseError(full.error);
    const hydrated = await this.withThreads(((full.data ?? []) as Row[]).map(inboxFromRow));
    const byId = new Map(hydrated.map((row) => [row.id, row]));
    return {
      items: pageIds.flatMap((id) => {
        const row = byId.get(id);
        if (!row) return [];
        return [{ ...row, threadUpdateCount: index.counts.get(`${row.channelId}:${row.slackMessageTs}`) ?? 0 }];
      }),
      total: ids.length,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async listThreadReplies(channelId: string, parentTs: string) {
    const listed = await this.db.from("slack_messages").select("id").eq("slack_channel_id", channelId).eq("thread_ts", parentTs).neq("slack_message_ts", parentTs);
    if (listed.error) databaseError(listed.error);
    const ids = ((listed.data ?? []) as Row[]).map((row) => text(row.id));
    if (ids.length === 0) return [];
    const full = await this.db.from("inbox_rows").select("*").in("id", ids);
    if (full.error) databaseError(full.error);
    const rows = await this.withThreads(((full.data ?? []) as Row[]).map(inboxFromRow));
    return rows.sort((a, b) => a.eventReceivedAt.localeCompare(b.eventReceivedAt));
  }

  async lookupCustomers(query: string): Promise<CustomerGroup[]> {
    const index = await this.threadReplyIndex();
    const q = sanitizeSearch(query);
    let request = this.db.from("inbox_rows").select("*").order("event_received_at", { ascending: false }).limit(400);
    if (q) {
      const pattern = quotedLike(q);
      request = request.or(`customer_name.ilike.${pattern},text.ilike.${pattern},preview.ilike.${pattern}`);
    }
    const { data, error } = await request;
    if (error) databaseError(error);
    const rows = await this.withThreads(((data ?? []) as Row[]).map(inboxFromRow));
    return groupCustomerOrders(rows.map((row) => ({
      id: row.id,
      eventReceivedAt: row.eventReceivedAt,
      channelId: row.channelId,
      text: row.text,
      customerName: row.customerName,
      review: row.review,
      processingStatus: row.processingStatus,
      threadTs: row.threadTs ?? null,
      slackMessageTs: row.slackMessageTs ?? null,
    })), index.counts, query);
  }

  async listUnnamedSenderIds() {
    const { data, error } = await this.db.from("slack_messages").select("sender_id").is("sender_name", null).not("sender_id", "is", null).limit(500);
    if (error) databaseError(error);
    return [...new Set(((data ?? []) as Row[]).map((row) => text(row.sender_id)).filter(Boolean))].slice(0, 100);
  }

  private async withThreads(items: InboxRow[]): Promise<InboxRow[]> {
    if (items.length === 0) return items;
    const { data, error } = await this.db.from("slack_messages").select("id, thread_ts, slack_message_ts").in("id", items.map((item) => item.id));
    if (error) databaseError(error);
    const byId = new Map(((data ?? []) as Row[]).map((row) => [text(row.id), row]));
    return items.map((item) => {
      const row = byId.get(item.id);
      return row ? { ...item, threadTs: asString(row.thread_ts), slackMessageTs: asString(row.slack_message_ts) } : item;
    });
  }

  async getInboxRow(id: string) {
    const { data, error } = await this.db.from("inbox_rows").select("*").eq("id", id).maybeSingle();
    if (error) databaseError(error);
    return data ? inboxFromRow(data as Row) : null;
  }

  async getMessage(id: string): Promise<MessageDetail | null> {
    const messageResult = await this.db.from("slack_messages").select("*").eq("id", id).maybeSingle();
    if (messageResult.error) databaseError(messageResult.error);
    if (!messageResult.data) return null;
    const [extractionResult, exceptionResult, attemptResult] = await Promise.all([
      this.db.from("message_extractions").select("*").eq("message_id", id).maybeSingle(),
      this.db.from("exceptions").select("*").eq("message_id", id).order("created_at", { ascending: false }),
      this.db.from("processing_attempts").select("*").eq("message_id", id).order("attempt_number", { ascending: true }),
    ]);
    if (extractionResult.error) databaseError(extractionResult.error);
    if (exceptionResult.error) databaseError(exceptionResult.error);
    if (attemptResult.error) databaseError(attemptResult.error);
    const exceptions = ((exceptionResult.data ?? []) as Row[]).map(exceptionFromRow);
    const auditIds = [id, ...exceptions.map((item) => item.id)];
    const auditResult = await this.db.from("audit_log").select("*").in("entity_id", auditIds).order("created_at", { ascending: false });
    if (auditResult.error) databaseError(auditResult.error);
    const channel = await this.db.from("slack_channels").select("display_name").eq("slack_channel_id", text((messageResult.data as Row).slack_channel_id)).maybeSingle();
    const message = messageFromRow(messageResult.data as Row);
    if (!message.slackChannelName && channel.data) message.slackChannelName = asString((channel.data as Row).display_name);
    return {
      ...message,
      extraction: extractionResult.data ? extractionFromRow(extractionResult.data as Row) : null,
      exceptions,
      attempts: ((attemptResult.data ?? []) as Row[]).map((row) => ({
        id: text(row.id),
        messageId: text(row.message_id),
        attemptNumber: asNumber(row.attempt_number) ?? 0,
        startedAt: text(row.started_at),
        finishedAt: asString(row.finished_at),
        outcome: text(row.outcome) as "success" | "failure" | "skipped",
        errorSummary: asString(row.error_summary),
      })),
      audit: ((auditResult.data ?? []) as Row[]).map((row) => ({
        id: text(row.id),
        createdAt: text(row.created_at),
        action: text(row.action),
        entityType: text(row.entity_type),
        entityId: text(row.entity_id),
        outcome: text(row.outcome) === "failure" ? "failure" : "success",
        actor: text(row.actor),
        summary: text(row.summary),
      })),
    };
  }

  async listExceptions(query: ExceptionQuery) {
    let request = this.db.from("exceptions").select("*", { count: "exact" });
    if (query.status !== "all") request = request.eq("status", query.status);
    if (query.type !== "all") request = request.eq("type", query.type);
    if (query.severity !== "all") request = request.eq("severity", query.severity);
    const from = (query.page - 1) * query.pageSize;
    const { data, error, count } = await request.order("created_at", { ascending: false }).range(from, from + query.pageSize - 1);
    if (error) databaseError(error);
    const exceptions = ((data ?? []) as Row[]).map(exceptionFromRow);
    const messageIds = [...new Set(exceptions.map((item) => item.messageId))];
    const extractionResult = messageIds.length
      ? await this.db.from("message_extractions").select("message_id, customer_name, order_reference, preview").in("message_id", messageIds)
      : { data: [], error: null };
    if (extractionResult.error) databaseError(extractionResult.error);
    const byMessage = new Map(((extractionResult.data ?? []) as Row[]).map((row) => [text(row.message_id), row]));
    const items = exceptions
      .map((item) => {
        const related = byMessage.get(item.messageId);
        return {
          ...item,
          customerName: related ? asString(related.customer_name) : null,
          orderReference: related ? asString(related.order_reference) : null,
          preview: related ? text(related.preview) : "",
        };
      })
      .sort((a, b) => {
        const rank = { high: 0, medium: 1, low: 2 };
        if (a.status === "open" && b.status !== "open") return -1;
        if (b.status === "open" && a.status !== "open") return 1;
        return rank[a.severity] - rank[b.severity];
      });
    return { items, total: count ?? items.length, page: query.page, pageSize: query.pageSize };
  }

  async listAudit(query: AuditQuery) {
    let request = this.db.from("audit_log").select("*", { count: "exact" });
    if (query.outcome !== "all") request = request.eq("outcome", query.outcome);
    const action = sanitizeSearch(query.action);
    if (action) request = request.or(`action.ilike.${quotedLike(action)},summary.ilike.${quotedLike(action)}`);
    const from = (query.page - 1) * query.pageSize;
    const { data, error, count } = await request.order("created_at", { ascending: false }).range(from, from + query.pageSize - 1);
    if (error) databaseError(error);
    const items: AuditEntry[] = ((data ?? []) as Row[]).map((row) => ({
      id: text(row.id),
      createdAt: text(row.created_at),
      action: text(row.action),
      entityType: text(row.entity_type),
      entityId: text(row.entity_id),
      outcome: text(row.outcome) === "failure" ? "failure" : "success",
      actor: text(row.actor),
      summary: text(row.summary),
    }));
    return { items, total: count ?? items.length, page: query.page, pageSize: query.pageSize };
  }

  async listRecords(query: MessageQuery) {
    const page = await this.listFrom("record_rows", query);
    return page;
  }

  private async listFrom(table: "record_rows", query: MessageQuery) {
    let request = this.db.from(table).select("*", { count: "exact" });
    if (query.status !== "all") request = request.eq("processing_status", query.status);
    if (query.channel) request = request.eq("slack_channel_id", query.channel);
    const { start, end } = dateInputToBounds(query.from, query.to);
    if (start) request = request.gte("event_received_at", start.toISOString());
    if (end) request = request.lt("event_received_at", end.toISOString());
    const q = sanitizeSearch(query.q);
    if (q) {
      const pattern = quotedLike(q);
      request = request.or(`text.ilike.${pattern},customer_name.ilike.${pattern},order_reference.ilike.${pattern}`);
    }
    const from = (query.page - 1) * query.pageSize;
    const { data, error, count } = await request.order("event_received_at", { ascending: false }).range(from, from + query.pageSize - 1);
    if (error) databaseError(error);
    return {
      items: ((data ?? []) as Row[]).map((row) => {
        const inbox = inboxFromRow(row);
        return {
          messageId: inbox.id,
          eventReceivedAt: inbox.eventReceivedAt,
          customerName: inbox.customerName,
          orderReference: inbox.orderReference,
          amountText: asString(row.amount_text),
          amountMinor: asNumber(row.amount_minor),
          paymentModeMention: asString(row.payment_mode_mention),
          intent: (asString(row.intent) ?? "unclassified") as MessageIntent,
          extractSource: text(row.extract_source) === "model" ? ("model" as const) : ("rules" as const),
          verification: "unverified" as const,
          processingStatus: inbox.processingStatus,
          review: inbox.review === "required" ? ("required" as const) : ("clear" as const),
        };
      }),
      total: count ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async overview(now: Date) {
    const { start, end } = istDayBounds(now);
    const delayedBefore = new Date(now.getTime() - 2 * 60 * 1000).toISOString();
    const [today, processed, review, failed, delayed, recent, openExceptions, todayMessages] = await Promise.all([
      this.db.from("slack_messages").select("id", { count: "exact", head: true }).gte("event_received_at", start.toISOString()).lt("event_received_at", end.toISOString()),
      this.db.from("slack_messages").select("id", { count: "exact", head: true }).gte("event_received_at", start.toISOString()).lt("event_received_at", end.toISOString()).eq("processing_status", "processed"),
      this.db.from("exceptions").select("id", { count: "exact", head: true }).eq("status", "open"),
      this.db.from("slack_messages").select("id", { count: "exact", head: true }).eq("processing_status", "failed"),
      this.db.from("slack_messages").select("id", { count: "exact", head: true }).in("processing_status", ["received", "processing"]).lt("event_received_at", delayedBefore),
      this.db.from("inbox_rows").select("*").order("event_received_at", { ascending: false }).limit(40),
      this.db.from("exceptions").select("id, message_id, type, severity, reason, status, created_at").eq("status", "open").limit(40),
      this.db.from("slack_messages").select("text, thread_ts, slack_message_ts, event_received_at").gte("event_received_at", start.toISOString()).lt("event_received_at", end.toISOString()).limit(2000),
    ]);
    for (const result of [today, processed, review, failed, delayed, recent, openExceptions, todayMessages]) {
      if (result.error) databaseError(result.error);
    }
    const exceptions = ((openExceptions.data ?? []) as Row[]).map(exceptionFromRow).sort((a, b) => {
      const rank = { high: 0, medium: 1, low: 2 };
      const severity = rank[a.severity] - rank[b.severity];
      if (severity !== 0) return severity;
      return b.createdAt.localeCompare(a.createdAt);
    }).slice(0, 6);
    const relatedIds = exceptions.map((item) => item.messageId);
    const related = relatedIds.length
      ? await this.db.from("message_extractions").select("message_id, customer_name, order_reference").in("message_id", relatedIds)
      : { data: [], error: null };
    if (related.error) databaseError(related.error);
    const byMessage = new Map(((related.data ?? []) as Row[]).map((row) => [text(row.message_id), row]));
    const recentRows = (await this.withThreads(((recent.data ?? []) as Row[]).map(inboxFromRow)))
      .filter((row) => !isThreadReply(row.threadTs, row.slackMessageTs))
      .slice(0, 8);
    const dayMessages = ((todayMessages.data ?? []) as Row[]).map((row) => ({
      text: text(row.text),
      threadTs: asString(row.thread_ts),
      slackMessageTs: text(row.slack_message_ts),
      eventReceivedAt: text(row.event_received_at),
    }));
    return {
      messagesToday: today.count ?? 0,
      processedToday: processed.count ?? 0,
      reviewBacklog: review.count ?? 0,
      failedOrDelayed: (failed.count ?? 0) + (delayed.count ?? 0),
      latestMessageAt: recentRows[0]?.eventReceivedAt ?? null,
      recent: recentRows,
      day: countIstDay(dayMessages, review.count ?? 0, now),
      attention: exceptions.map((item) => ({
        id: item.id,
        messageId: item.messageId,
        type: item.type,
        severity: item.severity,
        reason: item.reason,
        createdAt: item.createdAt,
        customerName: asString(byMessage.get(item.messageId)?.customer_name),
        orderReference: asString(byMessage.get(item.messageId)?.order_reference),
      })),
    };
  }

  async listSenderActivity(fromIso: string, toIso: string) {
    const { data, error } = await this.db
      .from("slack_messages")
      .select("id, sender_id, sender_name, text, thread_ts, slack_message_ts, processing_status, event_received_at")
      .gte("event_received_at", fromIso)
      .lt("event_received_at", toIso)
      .order("event_received_at", { ascending: false })
      .limit(2000);
    if (error) databaseError(error);
    return ((data ?? []) as Row[]).map((row) => ({
      id: text(row.id),
      senderId: asString(row.sender_id),
      senderName: asString(row.sender_name),
      text: text(row.text),
      threadTs: asString(row.thread_ts),
      slackMessageTs: text(row.slack_message_ts),
      processingStatus: text(row.processing_status) as ProcessingStatus,
      eventReceivedAt: text(row.event_received_at),
    }));
  }

  async senderAliases() {
    const { data, error } = await this.db.from("integration_settings").select("value").eq("key", "sender_aliases").maybeSingle();
    if (error) databaseError(error);
    const value = (data as Row | null)?.value;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const aliases: Record<string, string> = {};
    for (const [key, name] of Object.entries(value as Record<string, unknown>)) {
      if (typeof name === "string" && name.trim()) aliases[key] = name.trim();
    }
    return aliases;
  }

  async saveSenderName(senderId: string, name: string) {
    const aliases = await this.senderAliases();
    aliases[senderId] = name;
    const saved = await this.db.from("integration_settings").upsert({ key: "sender_aliases", value: aliases });
    if (saved.error) databaseError(saved.error);
    const updated = await this.db.from("slack_messages").update({ sender_name: name }).eq("sender_id", senderId);
    if (updated.error) databaseError(updated.error);
  }

  async listActivity(fromIso: string, toIso: string) {
    const { data, error } = await this.db
      .from("inbox_rows")
      .select("id, event_received_at, sender_id, sender_name, processing_status, intent, order_reference, customer_name, amount_minor, preview")
      .gte("event_received_at", fromIso)
      .lt("event_received_at", toIso)
      .order("event_received_at", { ascending: true })
      .limit(2001);
    if (error) databaseError(error);
    const rows = (data ?? []) as Row[];
    const truncated = rows.length > 2000;
    return {
      truncated,
      points: rows.slice(0, 2000).map((row) => ({
        id: text(row.id),
        eventReceivedAt: text(row.event_received_at),
        senderName: asString(row.sender_name),
        senderId: asString(row.sender_id),
        processingStatus: text(row.processing_status) as ProcessingStatus,
        intent: asString(row.intent) as MessageIntent | null,
        orderReference: asString(row.order_reference),
        customerName: asString(row.customer_name),
        amountMinor: asNumber(row.amount_minor),
        preview: text(row.preview),
      })),
    };
  }

  async channels() {
    const { data, error } = await this.db.from("slack_channels").select("slack_channel_id, display_name").order("first_seen_at");
    if (error) databaseError(error);
    return ((data ?? []) as Row[]).map((row) => ({ id: text(row.slack_channel_id), name: asString(row.display_name) }));
  }

  async healthFacts(): Promise<HealthFacts> {
    const [latest, errored, pending, failed] = await Promise.all([
      this.db.from("slack_messages").select("event_received_at").order("event_received_at", { ascending: false }).limit(1).maybeSingle(),
      this.db.from("slack_messages").select("processing_error, updated_at").not("processing_error", "is", null).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      this.db.from("slack_messages").select("id", { count: "exact", head: true }).in("processing_status", ["received", "processing"]),
      this.db.from("slack_messages").select("id", { count: "exact", head: true }).eq("processing_status", "failed"),
    ]);
    for (const result of [latest, errored, pending, failed]) {
      if (result.error) databaseError(result.error);
    }
    const errorRow = errored.data as Row | null;
    return {
      lastEventAt: latest.data ? asString((latest.data as Row).event_received_at) : null,
      lastError: errorRow?.processing_error ? { at: text(errorRow.updated_at), summary: text(errorRow.processing_error) } : null,
      pendingCount: pending.count ?? 0,
      failedCount: failed.count ?? 0,
    };
  }

  async insertInbound(input: InboundDraft) {
    const channel = await this.db.from("slack_channels").upsert(
      { slack_channel_id: input.slackChannelId, display_name: input.slackChannelName },
      { onConflict: "slack_channel_id", ignoreDuplicates: true },
    );
    if (channel.error) databaseError(channel.error);
    const inserted = await this.db.from("slack_messages").insert({
      slack_team_id: input.slackTeamId,
      slack_channel_id: input.slackChannelId,
      slack_channel_name: input.slackChannelName,
      slack_message_ts: input.slackMessageTs,
      slack_event_id: input.slackEventId,
      sender_id: input.senderId,
      sender_name: input.senderName,
      text: input.text,
      thread_ts: input.threadTs,
      permalink: input.permalink,
      subtype: input.subtype,
      bot_id: input.botId,
      event_received_at: input.eventReceivedAt,
      processing_status: "received",
      source_metadata: input.sourceMetadata,
    }).select("*").single();
    if (inserted.error?.code === "23505") {
      const existing = await this.findExisting(input.slackEventId, input.slackChannelId, input.slackMessageTs);
      if (!existing) return { ok: false as const, error: "A duplicate event was reported, but the stored message could not be read." };
      return { ok: true as const, duplicate: true, message: existing };
    }
    if (inserted.error) return { ok: false as const, error: "The message could not be stored." };
    return { ok: true as const, duplicate: false, message: messageFromRow(inserted.data as Row) };
  }

  private async findExisting(eventId: string | null, channelId: string, ts: string): Promise<SlackMessage | null> {
    if (eventId) {
      const byEvent = await this.db.from("slack_messages").select("*").eq("slack_event_id", eventId).maybeSingle();
      if (byEvent.error) databaseError(byEvent.error);
      if (byEvent.data) return messageFromRow(byEvent.data as Row);
    }
    const byTs = await this.db.from("slack_messages").select("*").eq("slack_channel_id", channelId).eq("slack_message_ts", ts).maybeSingle();
    if (byTs.error) databaseError(byTs.error);
    return byTs.data ? messageFromRow(byTs.data as Row) : null;
  }

  async claim(messageId: string) {
    const { data, error } = await this.db.rpc("claim_slack_message", { target: messageId, max_attempts: MAX_PROCESSING_ATTEMPTS });
    if (error) databaseError(error);
    const row = Array.isArray(data) ? (data[0] as Row | undefined) : null;
    return row ? messageFromRow(row) : null;
  }

  async complete(messageId: string, result: CompleteResult) {
    const now = new Date().toISOString();
    if (result.extraction) {
      const saved = await this.db.from("message_extractions").upsert({
        message_id: messageId,
        customer_name: result.extraction.customerName,
        order_reference: result.extraction.orderReference,
        amount_text: result.extraction.amountText,
        amount_minor: result.extraction.amountMinor,
        currency: "INR",
        payment_mode_mention: result.extraction.paymentModeMention,
        intent: result.extraction.intent,
        preview: result.extraction.preview,
        missing_fields: result.extraction.missingFields,
        extract_source: result.extraction.extractSource,
        verification: "unverified",
      }, { onConflict: "message_id" });
      if (saved.error) databaseError(saved.error);
    }
    const superseded = await this.db.from("exceptions").update({
      status: "superseded",
      resolution_note: "Replaced by a later processing attempt.",
      resolved_at: now,
      resolver: "system",
    }).eq("message_id", messageId).eq("status", "open");
    if (superseded.error) databaseError(superseded.error);
    if (result.exceptions.length) {
      const created = await this.db.from("exceptions").insert(result.exceptions.map((item) => ({
        message_id: messageId,
        type: item.type,
        severity: item.severity,
        reason: item.reason,
        relevant_fields: item.relevantFields,
        status: "open",
      }))).select("id, type, reason");
      if (created.error) databaseError(created.error);
      for (const row of (created.data ?? []) as Row[]) {
        await this.appendAudit({
          action: "exception_created",
          entityType: "exception",
          entityId: text(row.id),
          outcome: "success",
          actor: "system",
          summary: `${text(row.type)}: ${text(row.reason)}`,
        });
      }
    }
    const updated = await this.db.from("slack_messages").update({
      processing_status: result.status,
      skip_reason: result.skipReason,
      processing_error: null,
    }).eq("id", messageId);
    if (updated.error) databaseError(updated.error);
    const attempt = await this.db.from("processing_attempts").insert({
      message_id: messageId,
      attempt_number: result.attemptNumber,
      started_at: result.startedAt,
      finished_at: now,
      outcome: result.status === "skipped" ? "skipped" : "success",
    });
    if (attempt.error) databaseError(attempt.error);
    await this.appendAudit({
      action: result.status === "skipped" ? "message_skipped" : "processing_completed",
      entityType: "slack_message",
      entityId: messageId,
      outcome: "success",
      actor: "system",
      summary: result.skipReason ? `Skipped (${result.skipReason}).` : `Processing finished as ${result.status}.`,
    });
  }

  async fail(messageId: string, errorSummary: string, attemptNumber: number, startedAt: string) {
    const summary = errorSummary.slice(0, 280);
    const current = await this.db.from("slack_messages").select("retry_count").eq("id", messageId).maybeSingle();
    if (current.error) databaseError(current.error);
    const retryCount = asNumber((current.data as Row | null)?.retry_count) ?? 0;
    const updated = await this.db.from("slack_messages").update({
      processing_status: "failed",
      processing_error: summary,
      retry_count: retryCount + 1,
    }).eq("id", messageId);
    if (updated.error) databaseError(updated.error);
    const attempt = await this.db.from("processing_attempts").insert({
      message_id: messageId,
      attempt_number: attemptNumber,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      outcome: "failure",
      error_summary: summary,
    });
    if (attempt.error) databaseError(attempt.error);
    await this.appendAudit({
      action: "processing_failed",
      entityType: "slack_message",
      entityId: messageId,
      outcome: "failure",
      actor: "system",
      summary,
    });
  }

  async findBySlackTs(channelId: string, ts: string) {
    const { data, error } = await this.db.from("slack_messages").select("*").eq("slack_channel_id", channelId).eq("slack_message_ts", ts).maybeSingle();
    if (error) databaseError(error);
    return data ? messageFromRow(data as Row) : null;
  }

  async flagThreadAdvance(parentId: string, replyId: string, amountText: string | null) {
    const parent = await this.db.from("slack_messages").select("id, processing_status").eq("id", parentId).maybeSingle();
    if (parent.error) databaseError(parent.error);
    if (!parent.data || text((parent.data as Row).processing_status) === "skipped") return;
    const open = await this.db.from("exceptions").select("relevant_fields").eq("message_id", parentId).eq("status", "open");
    if (open.error) databaseError(open.error);
    const already = ((open.data ?? []) as Row[]).some((row) => (row.relevant_fields as Record<string, string | null> | null)?.replyMessageId === replyId);
    if (already) return;
    const reason = amountText
      ? `A thread reply reports an advance of ${amountText}. This is not a verified payment.`
      : "A thread reply reports an advance. This is not a verified payment.";
    const created = await this.db.from("exceptions").insert({
      message_id: parentId,
      type: "missing_info",
      severity: "medium",
      reason,
      relevant_fields: { replyMessageId: replyId, amountText },
      status: "open",
    }).select("id").single();
    if (created.error) databaseError(created.error);
    if (text((parent.data as Row).processing_status) === "processed") {
      const updated = await this.db.from("slack_messages").update({ processing_status: "needs_review" }).eq("id", parentId);
      if (updated.error) databaseError(updated.error);
    }
    await this.appendAudit({
      action: "exception_created",
      entityType: "exception",
      entityId: text((created.data as Row).id),
      outcome: "success",
      actor: "system",
      summary: `missing_info: ${reason}`,
    });
  }

  async reopen(messageId: string) {
    const { data, error } = await this.db.from("slack_messages").update({ processing_status: "received" }).eq("id", messageId).in("processing_status", ["processed", "needs_review", "skipped", "failed"]).select("id");
    if (error) databaseError(error);
    return Boolean(data?.length);
  }

  async rememberSender(senderId: string, senderName: string) {
    const { error } = await this.db.from("slack_messages").update({ sender_name: senderName }).eq("sender_id", senderId).is("sender_name", null);
    if (error) databaseError(error);
  }

  async findByOrderReferences(refs: string[], excludeMessageId: string) {
    if (!refs.length) return [];
    const filter = refs.map((ref) => `order_reference.ilike.${quotedLike(ref)}`).join(",");
    const { data, error } = await this.db.from("message_extractions").select("message_id, order_reference, amount_minor, created_at").neq("message_id", excludeMessageId).or(filter).limit(50);
    if (error) databaseError(error);
    const wanted = new Set(refs.map((ref) => ref.toUpperCase()));
    return ((data ?? []) as Row[]).flatMap((row) => {
      const orderReference = asString(row.order_reference);
      const parts = (orderReference ?? "").split(",").map((part) => part.trim().toUpperCase());
      if (!parts.some((part) => wanted.has(part))) return [];
      return [{
        messageId: text(row.message_id),
        orderReference,
        amountMinor: asNumber(row.amount_minor),
        receivedAt: text(row.created_at),
      }];
    });
  }

  async resolveException(id: string, note: string, actor: string) {
    const trimmed = note.trim();
    if (trimmed.length < 8) throw new Error("A resolution note of at least 8 characters is required.");
    const existing = await this.db.from("exceptions").select("*").eq("id", id).maybeSingle();
    if (existing.error) databaseError(existing.error);
    if (!existing.data) throw new Error("Exception not found.");
    const current = exceptionFromRow(existing.data as Row);
    if (current.status !== "open") throw new Error("Only an open exception can be resolved.");
    const now = new Date().toISOString();
    const updated = await this.db.from("exceptions").update({
      status: "resolved",
      resolution_note: trimmed.slice(0, 1000),
      resolved_at: now,
      resolver: actor,
    }).eq("id", id).eq("status", "open").select("*").single();
    if (updated.error) databaseError(updated.error);
    const remaining = await this.db.from("exceptions").select("id", { count: "exact", head: true }).eq("message_id", current.messageId).eq("status", "open");
    if (remaining.error) databaseError(remaining.error);
    if ((remaining.count ?? 0) === 0) {
      await this.db.from("slack_messages").update({ processing_status: "processed" }).eq("id", current.messageId).eq("processing_status", "needs_review");
    }
    await this.appendAudit({
      action: "exception_resolved",
      entityType: "exception",
      entityId: id,
      outcome: "success",
      actor,
      summary: trimmed.slice(0, 180),
    });
    return exceptionFromRow(updated.data as Row);
  }

  async reclaimStuck(olderThanMs: number) {
    const { data, error } = await this.db.rpc("reclaim_stuck_messages", { max_age_seconds: Math.ceil(olderThanMs / 1000) });
    if (error) databaseError(error);
    return typeof data === "number" ? data : 0;
  }

  async appendAudit(entry: Omit<AuditEntry, "id" | "createdAt"> & { createdAt?: string }) {
    const { error } = await this.db.from("audit_log").insert({
      created_at: entry.createdAt,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      outcome: entry.outcome,
      actor: entry.actor,
      summary: entry.summary,
    });
    if (error) databaseError(error);
  }
}

let liveRepository: SupabaseRepository | null = null;

export function getLiveRepository(): SupabaseRepository {
  if (liveRepository) return liveRepository;
  const env = readEnv();
  if (!env.supabaseUrl || !env.serviceRoleKey) throw new Error("Supabase is not configured.");
  const db = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  liveRepository = new SupabaseRepository(db);
  return liveRepository;
}

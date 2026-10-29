import { istDayBounds } from "@/lib/format";
import { countIstDay, groupCustomerOrders, isThreadReply, prepareInbox } from "@/lib/orders";
import type { OpsRepository } from "@/lib/repository";
import { matchesInboxQuery, reviewFor, sanitizeSearch } from "@/lib/query";
import {
  MAX_PROCESSING_ATTEMPTS,
  type AuditEntry,
  type AuditQuery,
  type CompleteResult,
  type ExceptionQuery,
  type ExceptionRecord,
  type Extraction,
  type HealthFacts,
  type InboundDraft,
  type InboxRow,
  type InsertResult,
  type MessageDetail,
  type MessageQuery,
  type OverviewData,
  type ProcessingAttempt,
  type SlackMessage,
} from "@/lib/types";

export type MemoryState = {
  messages: SlackMessage[];
  extractions: Extraction[];
  exceptions: ExceptionRecord[];
  attempts: ProcessingAttempt[];
  audit: AuditEntry[];
  channels: Array<{ id: string; name: string | null }>;
  senderAliases?: Record<string, string>;
};

function id(): string {
  return crypto.randomUUID();
}

function rowFor(state: MemoryState, message: SlackMessage): InboxRow {
  const extraction = state.extractions.find((item) => item.messageId === message.id) ?? null;
  const openExceptions = state.exceptions.filter((item) => item.messageId === message.id && item.status === "open").length;
  return {
    id: message.id,
    eventReceivedAt: message.eventReceivedAt,
    channelId: message.slackChannelId,
    channelName: message.slackChannelName,
    senderId: message.senderId,
    senderName: message.senderName,
    text: message.text,
    preview: extraction?.preview || message.text.replace(/\s+/g, " ").trim().slice(0, 180),
    customerName: extraction?.customerName ?? null,
    orderReference: extraction?.orderReference ?? null,
    amountText: extraction?.amountText ?? null,
    amountMinor: extraction?.amountMinor ?? null,
    processingStatus: message.processingStatus,
    review: reviewFor(message.processingStatus, openExceptions),
    slackMessageTs: message.slackMessageTs,
    threadTs: message.threadTs,
  };
}

function paginate<T>(items: T[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total: items.length, page, pageSize };
}

export class MemoryRepository implements OpsRepository {
  constructor(private readonly state: MemoryState) {}

  snapshot(): MemoryState {
    return this.state;
  }

  private threadIndex() {
    const parents = new Set(this.state.messages.map((message) => `${message.slackChannelId}:${message.slackMessageTs}`));
    const replyIds = new Set<string>();
    const counts = new Map<string, number>();
    for (const message of this.state.messages) {
      if (!isThreadReply(message.threadTs, message.slackMessageTs)) continue;
      const key = `${message.slackChannelId}:${message.threadTs}`;
      if (!parents.has(key)) continue;
      replyIds.add(message.id);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return { replyIds, counts };
  }

  async listMessages(query: MessageQuery) {
    const index = this.threadIndex();
    const items = this.state.messages
      .map((message) => ({
        ...rowFor(this.state, message),
        threadUpdateCount: index.counts.get(`${message.slackChannelId}:${message.slackMessageTs}`) ?? 0,
      }))
      .filter((row) => !index.replyIds.has(row.id))
      .sort((a, b) => b.eventReceivedAt.localeCompare(a.eventReceivedAt));
    return paginate(prepareInbox(items, query), query.page, query.pageSize);
  }

  async listThreadReplies(channelId: string, parentTs: string) {
    return this.state.messages
      .filter((message) => message.slackChannelId === channelId && message.threadTs === parentTs && message.slackMessageTs !== parentTs)
      .map((message) => rowFor(this.state, message))
      .sort((a, b) => a.eventReceivedAt.localeCompare(b.eventReceivedAt));
  }

  async lookupCustomers(query: string) {
    const index = this.threadIndex();
    return groupCustomerOrders(
      this.state.messages.map((message) => {
        const row = rowFor(this.state, message);
        return {
          id: row.id,
          eventReceivedAt: row.eventReceivedAt,
          channelId: row.channelId,
          text: row.text,
          customerName: row.customerName,
          review: row.review,
          processingStatus: row.processingStatus,
          threadTs: message.threadTs,
          slackMessageTs: message.slackMessageTs,
        };
      }),
      index.counts,
      query,
    );
  }

  async listUnnamedSenderIds() {
    return [...new Set(this.state.messages.flatMap((message) => message.senderId && !message.senderName ? [message.senderId] : []))].slice(0, 100);
  }

  async getInboxRow(messageId: string) {
    const message = this.state.messages.find((item) => item.id === messageId);
    return message ? rowFor(this.state, message) : null;
  }

  async getMessage(messageId: string): Promise<MessageDetail | null> {
    const message = this.state.messages.find((item) => item.id === messageId);
    if (!message) return null;
    const exceptionIds = new Set(this.state.exceptions.filter((item) => item.messageId === messageId).map((item) => item.id));
    return {
      ...message,
      extraction: this.state.extractions.find((item) => item.messageId === messageId) ?? null,
      exceptions: this.state.exceptions
        .filter((item) => item.messageId === messageId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      attempts: this.state.attempts
        .filter((item) => item.messageId === messageId)
        .sort((a, b) => a.attemptNumber - b.attemptNumber),
      audit: this.state.audit
        .filter((item) => item.entityId === messageId || exceptionIds.has(item.entityId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
  }

  async listExceptions(query: ExceptionQuery) {
    const items = this.state.exceptions
      .filter((item) => query.status === "all" || item.status === query.status)
      .filter((item) => query.type === "all" || item.type === query.type)
      .filter((item) => query.severity === "all" || item.severity === query.severity)
      .sort((a, b) => {
        const rank = { high: 0, medium: 1, low: 2 };
        if (a.status === "open" && b.status !== "open") return -1;
        if (b.status === "open" && a.status !== "open") return 1;
        const severity = rank[a.severity] - rank[b.severity];
        if (severity !== 0) return severity;
        return b.createdAt.localeCompare(a.createdAt);
      })
      .map((item) => {
        const extraction = this.state.extractions.find((entry) => entry.messageId === item.messageId);
        const message = this.state.messages.find((entry) => entry.id === item.messageId);
        return {
          ...item,
          customerName: extraction?.customerName ?? null,
          orderReference: extraction?.orderReference ?? null,
          preview: extraction?.preview || message?.text || "",
        };
      });
    return paginate(items, query.page, query.pageSize);
  }

  async listAudit(query: AuditQuery) {
    const action = sanitizeSearch(query.action).toLowerCase();
    const items = this.state.audit
      .filter((item) => query.outcome === "all" || item.outcome === query.outcome)
      .filter((item) => !action || item.action.includes(action) || item.summary.toLowerCase().includes(action))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return paginate(items, query.page, query.pageSize);
  }

  async listRecords(query: MessageQuery) {
    const rows = this.state.messages
      .map((message) => ({ message, extraction: this.state.extractions.find((item) => item.messageId === message.id) ?? null }))
      .filter((item) => item.extraction && item.extraction.intent !== "unclassified")
      .map((item) => rowFor(this.state, item.message))
      .filter((row) => matchesInboxQuery(row, query))
      .sort((a, b) => b.eventReceivedAt.localeCompare(a.eventReceivedAt));
    const records = rows.map((row) => {
      const extraction = this.state.extractions.find((item) => item.messageId === row.id)!;
      return {
        messageId: row.id,
        eventReceivedAt: row.eventReceivedAt,
        customerName: extraction.customerName,
        orderReference: extraction.orderReference,
        amountText: extraction.amountText,
        amountMinor: extraction.amountMinor,
        paymentModeMention: extraction.paymentModeMention,
        intent: extraction.intent,
        extractSource: extraction.extractSource,
        verification: "unverified" as const,
        processingStatus: row.processingStatus,
        review: row.review === "not_applicable" ? ("clear" as const) : row.review,
      };
    });
    return paginate(records, query.page, query.pageSize);
  }

  async overview(now: Date): Promise<OverviewData> {
    const { start, end } = istDayBounds(now);
    const today = this.state.messages.filter((message) => {
      const received = new Date(message.eventReceivedAt).getTime();
      return received >= start.getTime() && received < end.getTime();
    });
    const delayedBefore = now.getTime() - 2 * 60 * 1000;
    const recent = [...this.state.messages]
      .sort((a, b) => b.eventReceivedAt.localeCompare(a.eventReceivedAt))
      .filter((message) => !isThreadReply(message.threadTs, message.slackMessageTs))
      .slice(0, 8)
      .map((message) => rowFor(this.state, message));
    const attention = this.state.exceptions
      .filter((item) => item.status === "open")
      .sort((a, b) => {
        const rank = { high: 0, medium: 1, low: 2 };
        const severity = rank[a.severity] - rank[b.severity];
        if (severity !== 0) return severity;
        return b.createdAt.localeCompare(a.createdAt);
      })
      .slice(0, 6)
      .map((item) => {
        const extraction = this.state.extractions.find((entry) => entry.messageId === item.messageId);
        return {
          id: item.id,
          messageId: item.messageId,
          type: item.type,
          severity: item.severity,
          reason: item.reason,
          createdAt: item.createdAt,
          customerName: extraction?.customerName ?? null,
          orderReference: extraction?.orderReference ?? null,
        };
      });
    return {
      messagesToday: today.length,
      processedToday: today.filter((message) => message.processingStatus === "processed").length,
      reviewBacklog: this.state.exceptions.filter((item) => item.status === "open").length,
      failedOrDelayed: this.state.messages.filter((message) => {
        if (message.processingStatus === "failed") return true;
        if (message.processingStatus !== "received" && message.processingStatus !== "processing") return false;
        return new Date(message.eventReceivedAt).getTime() < delayedBefore;
      }).length,
      latestMessageAt: recent[0]?.eventReceivedAt ?? null,
      recent,
      attention,
      day: countIstDay(this.state.messages, this.state.exceptions.filter((item) => item.status === "open").length, now),
    };
  }

  async listActivity(fromIso: string, toIso: string) {
    const start = new Date(fromIso).getTime();
    const end = new Date(toIso).getTime();
    const points = this.state.messages
      .filter((message) => {
        const received = new Date(message.eventReceivedAt).getTime();
        return received >= start && received < end;
      })
      .sort((a, b) => a.eventReceivedAt.localeCompare(b.eventReceivedAt))
      .map((message) => {
        const extraction = this.state.extractions.find((item) => item.messageId === message.id) ?? null;
        return {
          id: message.id,
          eventReceivedAt: message.eventReceivedAt,
          senderName: message.senderName,
          senderId: message.senderId,
          processingStatus: message.processingStatus,
          intent: extraction?.intent ?? null,
          orderReference: extraction?.orderReference ?? null,
          customerName: extraction?.customerName ?? null,
          amountMinor: extraction?.amountMinor ?? null,
          preview: extraction?.preview || message.text.replace(/\s+/g, " ").trim().slice(0, 180),
        };
      });
    return { points: points.slice(0, 2000), truncated: points.length > 2000 };
  }

  async listSenderActivity(fromIso: string, toIso: string) {
    const start = new Date(fromIso).getTime();
    const end = new Date(toIso).getTime();
    return this.state.messages
      .filter((message) => {
        const received = new Date(message.eventReceivedAt).getTime();
        return received >= start && received < end;
      })
      .map((message) => ({
        id: message.id,
        senderId: message.senderId,
        senderName: message.senderName,
        text: message.text,
        threadTs: message.threadTs,
        slackMessageTs: message.slackMessageTs,
        processingStatus: message.processingStatus,
        eventReceivedAt: message.eventReceivedAt,
      }));
  }

  async senderAliases() {
    return { ...(this.state.senderAliases ?? {}) };
  }

  async saveSenderName(senderId: string, name: string) {
    this.state.senderAliases = { ...(this.state.senderAliases ?? {}), [senderId]: name };
    for (const message of this.state.messages) {
      if (message.senderId === senderId) message.senderName = name;
    }
  }

  async channels() {
    return [...this.state.channels];
  }

  async healthFacts(): Promise<HealthFacts> {
    const latest = [...this.state.messages].sort((a, b) => b.eventReceivedAt.localeCompare(a.eventReceivedAt))[0];
    const errored = this.state.messages
      .filter((message) => message.processingError)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    return {
      lastEventAt: latest?.eventReceivedAt ?? null,
      lastError: errored?.processingError ? { at: errored.updatedAt, summary: errored.processingError } : null,
      pendingCount: this.state.messages.filter((message) => message.processingStatus === "received" || message.processingStatus === "processing").length,
      failedCount: this.state.messages.filter((message) => message.processingStatus === "failed").length,
    };
  }

  async insertInbound(input: InboundDraft): Promise<InsertResult> {
    const existing = this.state.messages.find(
      (message) =>
        (input.slackEventId && message.slackEventId === input.slackEventId) ||
        (message.slackChannelId === input.slackChannelId && message.slackMessageTs === input.slackMessageTs),
    );
    if (existing) return { ok: true as const, duplicate: true, message: existing };
    const now = new Date().toISOString();
    const message: SlackMessage = {
      id: id(),
      slackTeamId: input.slackTeamId,
      slackChannelId: input.slackChannelId,
      slackChannelName: input.slackChannelName,
      slackMessageTs: input.slackMessageTs,
      slackEventId: input.slackEventId,
      senderId: input.senderId,
      senderName: input.senderName,
      text: input.text,
      threadTs: input.threadTs,
      permalink: input.permalink,
      subtype: input.subtype,
      botId: input.botId,
      eventReceivedAt: input.eventReceivedAt,
      processingStatus: "received",
      retryCount: 0,
      processingError: null,
      skipReason: null,
      sourceMetadata: input.sourceMetadata,
      createdAt: now,
      updatedAt: now,
    };
    this.state.messages.push(message);
    if (!this.state.channels.some((channel) => channel.id === input.slackChannelId)) {
      this.state.channels.push({ id: input.slackChannelId, name: input.slackChannelName });
    }
    return { ok: true as const, duplicate: false, message };
  }

  async claim(messageId: string) {
    const message = this.state.messages.find((item) => item.id === messageId);
    if (!message) return null;
    if (message.retryCount >= MAX_PROCESSING_ATTEMPTS) return null;
    if (message.processingStatus !== "received" && message.processingStatus !== "failed") return null;
    message.processingStatus = "processing";
    message.updatedAt = new Date().toISOString();
    return { ...message };
  }

  async complete(messageId: string, result: CompleteResult) {
    const message = this.state.messages.find((item) => item.id === messageId);
    if (!message) throw new Error("Message not found.");
    const now = new Date().toISOString();
    if (result.extraction) {
      const existing = this.state.extractions.find((item) => item.messageId === messageId);
      const extraction: Extraction = {
        id: existing?.id ?? id(),
        messageId,
        ...result.extraction,
        verification: "unverified",
        verifiedCustomerName: existing?.verifiedCustomerName ?? null,
        verifiedOrderReference: existing?.verifiedOrderReference ?? null,
        verifiedAmountMinor: existing?.verifiedAmountMinor ?? null,
        createdAt: existing?.createdAt ?? now,
      };
      if (existing) Object.assign(existing, extraction);
      else this.state.extractions.push(extraction);
    }
    for (const exception of this.state.exceptions) {
      if (exception.messageId === messageId && exception.status === "open") {
        exception.status = "superseded";
        exception.resolutionNote = "Replaced by a later processing attempt.";
        exception.resolvedAt = now;
        exception.resolver = "system";
      }
    }
    for (const draft of result.exceptions) {
      const exception: ExceptionRecord = {
        id: id(),
        messageId,
        ...draft,
        status: "open",
        resolutionNote: null,
        resolvedAt: null,
        resolver: null,
        createdAt: now,
      };
      this.state.exceptions.push(exception);
      await this.appendAudit({
        action: "exception_created",
        entityType: "exception",
        entityId: exception.id,
        outcome: "success",
        actor: "system",
        summary: `${draft.type}: ${draft.reason}`,
        createdAt: now,
      });
    }
    message.processingStatus = result.status;
    message.skipReason = result.skipReason;
    message.processingError = null;
    message.updatedAt = now;
    this.state.attempts.push({
      id: id(),
      messageId,
      attemptNumber: result.attemptNumber,
      startedAt: result.startedAt,
      finishedAt: now,
      outcome: result.status === "skipped" ? "skipped" : "success",
      errorSummary: null,
    });
    await this.appendAudit({
      action: result.status === "skipped" ? "message_skipped" : "processing_completed",
      entityType: "slack_message",
      entityId: messageId,
      outcome: "success",
      actor: "system",
      summary: result.skipReason ? `Skipped (${result.skipReason}).` : `Processing finished as ${result.status}.`,
      createdAt: now,
    });
  }

  async fail(messageId: string, errorSummary: string, attemptNumber: number, startedAt: string) {
    const message = this.state.messages.find((item) => item.id === messageId);
    if (!message) throw new Error("Message not found.");
    const now = new Date().toISOString();
    message.processingStatus = "failed";
    message.processingError = errorSummary.slice(0, 280);
    message.retryCount += 1;
    message.updatedAt = now;
    this.state.attempts.push({
      id: id(),
      messageId,
      attemptNumber,
      startedAt,
      finishedAt: now,
      outcome: "failure",
      errorSummary: message.processingError,
    });
    await this.appendAudit({
      action: "processing_failed",
      entityType: "slack_message",
      entityId: messageId,
      outcome: "failure",
      actor: "system",
      summary: message.processingError,
      createdAt: now,
    });
  }

  async findBySlackTs(channelId: string, ts: string) {
    return this.state.messages.find((item) => item.slackChannelId === channelId && item.slackMessageTs === ts) ?? null;
  }

  async flagThreadAdvance(parentId: string, replyId: string, amountText: string | null) {
    const parent = this.state.messages.find((item) => item.id === parentId);
    if (!parent || parent.processingStatus === "skipped") return;
    const already = this.state.exceptions.some((item) => item.messageId === parentId && item.status === "open" && item.relevantFields.replyMessageId === replyId);
    if (already) return;
    const now = new Date().toISOString();
    const exception: ExceptionRecord = {
      id: id(),
      messageId: parentId,
      type: "missing_info",
      severity: "medium",
      reason: amountText
        ? `A thread reply reports an advance of ${amountText}. This is not a verified payment.`
        : "A thread reply reports an advance. This is not a verified payment.",
      relevantFields: { replyMessageId: replyId, amountText },
      status: "open",
      resolutionNote: null,
      resolvedAt: null,
      resolver: null,
      createdAt: now,
    };
    this.state.exceptions.push(exception);
    if (parent.processingStatus === "processed") parent.processingStatus = "needs_review";
    parent.updatedAt = now;
  }

  async reopen(messageId: string) {
    const message = this.state.messages.find((item) => item.id === messageId);
    if (!message) return false;
    if (!["processed", "needs_review", "skipped", "failed"].includes(message.processingStatus)) return false;
    message.processingStatus = "received";
    message.updatedAt = new Date().toISOString();
    return true;
  }

  async rememberSender(senderId: string, senderName: string) {
    for (const message of this.state.messages) {
      if (message.senderId === senderId && !message.senderName) message.senderName = senderName;
    }
  }

  async findByOrderReferences(refs: string[], excludeMessageId: string) {
    const wanted = new Set(refs.map((ref) => ref.toUpperCase()));
    return this.state.extractions
      .filter((item) => item.messageId !== excludeMessageId && item.orderReference)
      .flatMap((item) => {
        const parts = item.orderReference!.split(",").map((part) => part.trim().toUpperCase());
        if (!parts.some((part) => wanted.has(part))) return [];
        const message = this.state.messages.find((entry) => entry.id === item.messageId);
        return [
          {
            messageId: item.messageId,
            orderReference: item.orderReference,
            amountMinor: item.amountMinor,
            receivedAt: message?.eventReceivedAt ?? item.createdAt,
          },
        ];
      });
  }

  async resolveException(exceptionId: string, note: string, actor: string) {
    const trimmed = note.trim();
    if (trimmed.length < 8) throw new Error("A resolution note of at least 8 characters is required.");
    const exception = this.state.exceptions.find((item) => item.id === exceptionId);
    if (!exception) throw new Error("Exception not found.");
    if (exception.status !== "open") throw new Error("Only an open exception can be resolved.");
    const now = new Date().toISOString();
    exception.status = "resolved";
    exception.resolutionNote = trimmed.slice(0, 1000);
    exception.resolvedAt = now;
    exception.resolver = actor;
    const stillOpen = this.state.exceptions.some((item) => item.messageId === exception.messageId && item.status === "open");
    const message = this.state.messages.find((item) => item.id === exception.messageId);
    if (message && !stillOpen && message.processingStatus === "needs_review") {
      message.processingStatus = "processed";
      message.updatedAt = now;
    }
    await this.appendAudit({
      action: "exception_resolved",
      entityType: "exception",
      entityId: exception.id,
      outcome: "success",
      actor,
      summary: trimmed.slice(0, 180),
      createdAt: now,
    });
    return { ...exception };
  }

  async reclaimStuck(olderThanMs: number) {
    const cutoff = Date.now() - olderThanMs;
    let count = 0;
    for (const message of this.state.messages) {
      if (message.processingStatus !== "processing") continue;
      if (new Date(message.updatedAt).getTime() >= cutoff) continue;
      message.processingStatus = "failed";
      message.processingError = "Processing was interrupted before completion.";
      message.retryCount += 1;
      message.updatedAt = new Date().toISOString();
      count += 1;
    }
    return count;
  }

  async appendAudit(entry: Omit<AuditEntry, "id" | "createdAt"> & { createdAt?: string }) {
    this.state.audit.push({
      id: id(),
      createdAt: entry.createdAt ?? new Date().toISOString(),
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      outcome: entry.outcome,
      actor: entry.actor,
      summary: entry.summary,
    });
  }
}

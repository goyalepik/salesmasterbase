import { dateInputToBounds } from "@/lib/format";
import { PAGE_SIZE, PROCESSING_STATUSES, type ExceptionQuery, type ExceptionSeverity, type ExceptionStatus, type ExceptionType, type InboxRow, type MessageQuery, type ProcessingStatus, EXCEPTION_TYPES } from "@/lib/types";

export function sanitizeSearch(input: string): string {
  return input.replace(/[^a-zA-Z0-9 #._-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

export function reviewFor(status: ProcessingStatus, openExceptions: number): InboxRow["review"] {
  if (status === "skipped") return "not_applicable";
  if (status === "needs_review" || openExceptions > 0) return "required";
  return "clear";
}

export function matchesInboxQuery(row: InboxRow, query: MessageQuery): boolean {
  if (query.status !== "all" && row.processingStatus !== query.status) return false;
  if (query.channel && row.channelId !== query.channel) return false;
  const { start, end } = dateInputToBounds(query.from, query.to);
  const received = new Date(row.eventReceivedAt).getTime();
  if (start && received < start.getTime()) return false;
  if (end && received >= end.getTime()) return false;
  const q = sanitizeSearch(query.q).toLowerCase();
  if (!q) return true;
  const haystack = [row.text, row.preview, row.customerName, row.orderReference, row.senderId, row.senderName, row.channelName, row.channelId]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

export function parsePage(value: string | undefined): number {
  const page = Number(value);
  if (!Number.isInteger(page) || page < 1) return 1;
  return page;
}

export function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export function messageQuery(params: Record<string, string | string[] | undefined>): MessageQuery {
  const status = firstParam(params.status);
  return {
    q: firstParam(params.q),
    status: PROCESSING_STATUSES.includes(status as ProcessingStatus) ? (status as ProcessingStatus) : "all",
    channel: firstParam(params.channel),
    from: firstParam(params.from),
    to: firstParam(params.to),
    page: parsePage(firstParam(params.page) || undefined),
    pageSize: PAGE_SIZE,
    view: firstParam(params.view) === "all" ? "all" : "orders",
  };
}

const EXCEPTION_STATUSES: ExceptionStatus[] = ["open", "resolved", "superseded"];
const SEVERITIES: ExceptionSeverity[] = ["low", "medium", "high"];

export function exceptionQuery(params: Record<string, string | string[] | undefined>): ExceptionQuery {
  const status = firstParam(params.status) || "open";
  const type = firstParam(params.type);
  const severity = firstParam(params.severity);
  return {
    status: status === "all" || EXCEPTION_STATUSES.includes(status as ExceptionStatus) ? (status as ExceptionStatus | "all") : "open",
    type: EXCEPTION_TYPES.includes(type as ExceptionType) ? (type as ExceptionType) : "all",
    severity: SEVERITIES.includes(severity as ExceptionSeverity) ? (severity as ExceptionSeverity) : "all",
    page: parsePage(firstParam(params.page) || undefined),
    pageSize: PAGE_SIZE,
  };
}

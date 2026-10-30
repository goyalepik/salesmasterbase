import { DEMO_DISCLAIMER } from "@/lib/copy";
import Link from "next/link";
import type { ReactNode } from "react";
import { EXCEPTION_LABELS, STATUS_LABELS, type ExceptionSeverity, type ExceptionType, type ProcessingStatus } from "@/lib/types";

export function PageHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="max-w-3xl">
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <h2 className="text-[13px] font-semibold text-ink">{children}</h2>
      {aside}
    </div>
  );
}

const STATUS_CLASS: Record<ProcessingStatus, string> = {
  received: "text-accent",
  processing: "text-accent",
  processed: "text-good",
  needs_review: "text-warn",
  failed: "text-bad",
  skipped: "text-faint",
};

export function StatusText({ status }: { status: ProcessingStatus }) {
  return <span className={STATUS_CLASS[status]}>{STATUS_LABELS[status]}</span>;
}

export function ReviewText({ review }: { review: "required" | "clear" | "not_applicable" }) {
  if (review === "required") return <span className="text-warn">Review</span>;
  if (review === "clear") return <span className="text-muted">Clear</span>;
  return <span className="text-faint">—</span>;
}

export function SeverityText({ severity }: { severity: ExceptionSeverity }) {
  const label = severity === "high" ? "High" : severity === "medium" ? "Medium" : "Low";
  const tone = severity === "high" ? "text-bad" : severity === "medium" ? "text-warn" : "text-muted";
  return <span className={tone}>{label}</span>;
}

export function ExceptionLabel({ type }: { type: ExceptionType }) {
  return <span>{EXCEPTION_LABELS[type]}</span>;
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="panel-strong px-4 py-8">
      <p className="text-[13px] font-medium text-ink">{title}</p>
      <p className="mt-1 max-w-lg text-[13px] text-muted">{detail}</p>
    </div>
  );
}

export function Pager({ path, page, pageSize, total, preserve }: { path: string; page: number; pageSize: number; total: number; preserve: Record<string, string> }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const href = (next: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(preserve)) {
      if (value) params.set(key, value);
    }
    if (next > 1) params.set("page", String(next));
    const query = params.toString();
    return query ? `${path}?${query}` : path;
  };
  return (
    <div className="mt-3 flex items-center justify-between gap-3 text-[12px] text-muted">
      <p className="tabular-nums">{total === 0 ? "No rows" : `${from}–${to} of ${total}`}</p>
      <div className="flex gap-3">
        {page > 1 ? <Link href={href(page - 1)}>Previous</Link> : <span className="text-faint">Previous</span>}
        <span className="tabular-nums">Page {Math.min(page, pages)} of {pages}</span>
        {page < pages ? <Link href={href(page + 1)}>Next</Link> : <span className="text-faint">Next</span>}
      </div>
    </div>
  );
}

export function DemoNotice() {
  return (
    <p className="demo-banner" role="status">
      {DEMO_DISCLAIMER}
    </p>
  );
}

export function TextButton({ children }: { children: ReactNode }) {
  return (
    <button type="submit" className="glow-button h-9 rounded-[14px] px-3.5 text-[13px] font-medium text-white">
      {children}
    </button>
  );
}

export function fieldClassName(): string {
  return "field h-9 w-full px-3 text-[13px] outline-none";
}

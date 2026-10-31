import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronDown, Download } from "lucide-react";
import { LINE_LABELS, STAGE_LABELS, STAGE_OWNER, type LineStatus, type OrderStage, type Role } from "@/lib/ops/types";

const STAGE_TONE: Record<OrderStage, string> = {
  awaiting_payment: "tone-warn",
  awaiting_inventory: "tone-info",
  awaiting_stock: "tone-violet",
  ready_to_dispatch: "tone-accent",
  out_for_delivery: "tone-teal",
  delivered: "tone-good",
  on_hold: "tone-bad",
  cancelled: "tone-muted",
};

const LINE_TONE: Record<LineStatus, string> = {
  pending: "tone-warn",
  reserved: "tone-good",
  awaiting_po: "tone-violet",
  procuring: "tone-violet",
  brand_direct: "tone-info",
  rejected: "tone-bad",
  dispatched: "tone-teal",
  cancelled: "tone-muted",
};

export const ROLE_LABELS: Record<Role, string> = {
  sales: "Sales",
  revops: "RevOps",
  inventory: "Inventory",
  procurement: "Procurement",
  logistics: "Logistics",
  installation: "Installation",
  admin: "Admin",
};

export const STAGE_QUEUE: Partial<Record<OrderStage, string>> = {
  awaiting_payment: "/revops",
  awaiting_inventory: "/inventory/decisions",
  awaiting_stock: "/procurement",
  ready_to_dispatch: "/dispatch",
  out_for_delivery: "/dispatch",
};

export function StageBadge({ stage }: { stage: OrderStage }) {
  return <span className={`badge ${STAGE_TONE[stage]}`}>{STAGE_LABELS[stage]}</span>;
}

export function LineBadge({ status }: { status: LineStatus }) {
  return <span className={`badge ${LINE_TONE[status]}`}>{LINE_LABELS[status]}</span>;
}

export function ownerLabel(stage: OrderStage): string {
  const owner = STAGE_OWNER[stage];
  return owner ? ROLE_LABELS[owner] : "—";
}

export function Panel({ title, subtitle, aside, children, className = "" }: { title?: ReactNode; subtitle?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`dashboard-panel ${className}`}>
      {title || aside ? (
        <div className="dashboard-panel-header">
          <div className="min-w-0">
            {title ? <h2 className="dashboard-panel-title">{title}</h2> : null}
            {subtitle ? <p className="dashboard-panel-subtitle">{subtitle}</p> : null}
          </div>
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Kpi({ label, value, note, href, tone }: { label: string; value: ReactNode; note?: ReactNode; href?: string; tone?: "warn" | "bad" | "good" }) {
  const body = (
    <>
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className={`mt-1.5 text-[24px] leading-none font-semibold tabular-nums tracking-[-0.03em] ${tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : tone === "good" ? "text-good" : "text-ink"}`}>{value}</dd>
      {note ? <p className="mt-1.5 text-[11px] text-faint">{note}</p> : null}
    </>
  );
  return href ? (
    <Link href={href} className="glass-stat block hover:border-white/30">{body}</Link>
  ) : (
    <div className="glass-stat">{body}</div>
  );
}

/** Labelled input for action forms. Big enough to tap. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-[12px] text-muted">
      {label}
      <span className="mt-1 block">{children}</span>
      {hint ? <span className="mt-1 block text-[11px] text-faint">{hint}</span> : null}
    </label>
  );
}

export const inputClass = "field h-11 w-full px-3 text-[14px] outline-none";

export function TableWrap({ children, minWidth = 720 }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="table-scroll">
      <table className="ops-table" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

/** A panel that opens on tap, for input forms that are not needed every minute. */
export function FoldPanel({ title, subtitle, icon, open = false, id, children }: { title: string; subtitle: string; icon?: ReactNode; open?: boolean; id?: string; children: ReactNode }) {
  return (
    <details className="dashboard-panel fold-panel mb-2.5" open={open} id={id}>
      <summary>
        {icon ? <span className="fold-icon">{icon}</span> : null}
        <span className="min-w-0 flex-1">
          <span className="dashboard-panel-title block">{title}</span>
          <span className="dashboard-panel-subtitle block">{subtitle}</span>
        </span>
        <ChevronDown size={18} className="fold-chevron shrink-0 text-muted" />
      </summary>
      <div className="pt-3">{children}</div>
    </details>
  );
}

/** Opens a spreadsheet of the list (CSV, opens in Excel and Google Sheets). */
export function DownloadButton({ kind, label = "Download Excel" }: { kind: string; label?: string }) {
  return (
    <a href={`/api/export/${kind}`} className="btn-quiet inline-flex h-10 shrink-0 items-center gap-2 rounded-[12px] px-3.5 text-[13px] font-medium" download>
      <Download size={15} />
      {label}
    </a>
  );
}

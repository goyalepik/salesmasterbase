"use client";

import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { BUCKETS, QUEUE, QUEUES } from "../domain/config";
import type { Ticket } from "../domain/types";
import { CHANNEL_ICON, CHANNEL_NAME, LabelBadge, SlaChip, when } from "./bits";
import { CustomerPanel } from "./customer-panel";
import { useCx } from "./cx-store";
import { TicketDetail } from "./ticket-detail";

const VIEWS = [
  { id: "open", label: "Open" },
  { id: "risk", label: "At risk" },
  { id: "mine", label: "Mine" },
  { id: "all", label: "All" },
] as const;

type Filters = { level: string; queue: string; bucket: string; channel: string; type: string; label: string };
const NONE: Filters = { level: "", queue: "", bucket: "", channel: "", type: "", label: "" };

/** L1 home: the ticket list, the open ticket, and the customer's history, side by side. */
export function Console() {
  const { rows, total, query, setQuery, now, open, openId, detail, loadMore, nameOf } = useCx();
  const [q, setQ] = useState(query.q);
  const filters: Filters = { level: query.level, queue: query.queue, bucket: query.bucket, channel: query.channel, type: query.type, label: query.label };
  const setFilters = (f: Filters) => setQuery(f);

  // Search runs on the server, a moment after typing stops.
  useEffect(() => {
    if (q === query.q) return;
    const timer = window.setTimeout(() => setQuery({ q }), 300);
    return () => window.clearTimeout(timer);
  }, [q, query.q, setQuery]);

  // With nothing opened yet, open the first ticket in the list.
  useEffect(() => {
    if (!openId && rows?.length) open(rows[0].id);
  }, [openId, rows, open]);

  const current = detail && detail.ticket.id === openId ? detail : null;
  const filterCount = Object.values(filters).filter(Boolean).length;

  return (
    <div className="cx-console">
      <aside className="cx-list">
        <div className="cx-list-head">
          <label className="cx-search">
            <Search size={14} aria-hidden="true" />
            <span className="sr-only">Search</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Phone, ticket, PIK number or word" />
            {q ? <button type="button" aria-label="Clear" onClick={() => setQ("")}><X size={13} /></button> : null}
          </label>
          <div className="cx-views" role="tablist">
            {VIEWS.map((v) => (
              <button key={v.id} type="button" role="tab" aria-selected={query.view === v.id} onClick={() => setQuery({ view: v.id })}>{v.label}</button>
            ))}
          </div>
          <details className="cx-filters">
            <summary>Filters{filterCount ? ` · ${filterCount}` : ""}</summary>
            <div className="cx-filter-grid">
              <Select label="Level" value={filters.level} onChange={(v) => setFilters({ ...filters, level: v })} options={["L0", "L1", "L2", "L3"].map((l) => [l, l])} />
              <Select label="Queue" value={filters.queue} onChange={(v) => setFilters({ ...filters, queue: v })} options={QUEUES.map((x) => [x.id, x.name])} />
              <Select label="Bucket" value={filters.bucket} onChange={(v) => setFilters({ ...filters, bucket: v })} options={BUCKETS.map((b) => [b.id, `${b.id} · ${b.name}`])} />
              <Select label="Channel" value={filters.channel} onChange={(v) => setFilters({ ...filters, channel: v })} options={Object.entries(CHANNEL_NAME)} />
              <Select label="Type" value={filters.type} onChange={(v) => setFilters({ ...filters, type: v })} options={[["informative", "Informative"], ["actionable", "Actionable"]]} />
              <Select label="Label" value={filters.label} onChange={(v) => setFilters({ ...filters, label: v })} options={["VIP", "High", "Medium", "Low"].map((l) => [l, l])} />
            </div>
            {filterCount ? <button type="button" className="cx-link" onClick={() => setFilters(NONE)}>Clear filters</button> : null}
          </details>
        </div>
        <ol className="cx-rows">
          {(rows ?? []).map((t) => (
            <Row key={t.id} ticket={t} now={now} active={openId === t.id} onOpen={() => open(t.id)} owner={t.ownerId ? nameOf(t.ownerId) : QUEUE.get(t.queueId)?.name ?? ""} />
          ))}
          {rows && !rows.length ? <li className="cx-empty">Nothing here. {query.view === "risk" ? "No ticket is close to its SLA." : ""}</li> : null}
          {!rows ? <li className="cx-empty">Loading…</li> : null}
          {rows && rows.length < total ? (
            <li><button type="button" className="cx-link cx-more" onClick={loadMore}>Show more ({total - rows.length} left)</button></li>
          ) : null}
        </ol>
      </aside>
      <section className="cx-detail">
        {current ? <TicketDetail key={current.ticket.id} ticket={current.ticket} events={current.events} />
          : openId ? <div className="cx-empty is-big">Opening the ticket…</div>
          : <div className="cx-empty is-big">Pick a ticket on the left.</div>}
      </section>
      <aside className="cx-side">{current ? <CustomerPanel view={current.customer} ticketId={current.ticket.id} onOpenTicket={open} /> : null}</aside>
    </div>
  );
}

function Row({ ticket: t, now, active, onOpen, owner }: { ticket: Ticket; now: Date; active: boolean; onOpen: () => void; owner: string }) {
  const Icon = CHANNEL_ICON[t.channel];
  return (
    <li>
      <button type="button" className={`cx-row ${active ? "is-active" : ""} is-${t.priority.toLowerCase()}`} onClick={onOpen}>
        <span className="cx-row-top">
          <LabelBadge label={t.label} />
          <span className="cx-prio">{t.priority}</span>
          <span className="cx-code">{t.ref ?? t.id}</span>
          <span className="cx-row-when">{when(t.createdAt, now)}</span>
        </span>
        <span className="cx-row-subject">{t.subject}</span>
        <span className="cx-row-meta">
          <Icon size={13} aria-label={CHANNEL_NAME[t.channel]} />
          <span>{t.level} · {owner}</span>
          <SlaChip ticket={t} events={[]} now={now} />
        </span>
      </button>
    </li>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<[string, string]> | Array<readonly [string, string]> }) {
  return (
    <label className="cx-field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Any</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

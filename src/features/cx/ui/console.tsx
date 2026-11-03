"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { BUCKETS, PRIORITY_RANK, QUEUE, QUEUES } from "../domain/config";
import { actorName } from "../domain/service";
import { slaState } from "../domain/sla";
import type { Ticket, TicketEvent } from "../domain/types";
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
  const { data, now, actor } = useCx();
  const [view, setView] = useState<(typeof VIEWS)[number]["id"]>("open");
  const [filters, setFilters] = useState<Filters>(NONE);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const eventsBy = useMemo(() => {
    const map = new Map<string, TicketEvent[]>();
    for (const e of data?.events ?? []) map.set(e.ticketId, [...(map.get(e.ticketId) ?? []), e]);
    return map;
  }, [data?.events]);

  const rows = useMemo(() => {
    const list = (data?.tickets ?? []).filter((t) => {
      const open = t.status !== "closed" && t.status !== "resolved";
      if (view === "open" && !open) return false;
      if (view === "risk" && (!open || slaState(t, eventsBy.get(t.id) ?? [], now).state === "ok")) return false;
      if (view === "mine" && t.ownerId !== actor.id) return false;
      if (filters.level && t.level !== filters.level) return false;
      if (filters.queue && t.queueId !== filters.queue) return false;
      if (filters.bucket && t.bucket !== filters.bucket) return false;
      if (filters.channel && t.channel !== filters.channel) return false;
      if (filters.type && t.type !== filters.type) return false;
      if (filters.label && t.label !== filters.label) return false;
      if (q) {
        const needle = q.toLowerCase().replace(/\s+/g, "");
        const hay = `${t.id}${t.customerUid}${t.orderRef ?? ""}${t.entities.orderRefs.join("")}${t.subject}${t.body}${t.scenarioId}`.toLowerCase().replace(/\s+/g, "");
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    // Most urgent first, then whoever is closest to breaching.
    return list
      .map((t) => ({ t, s: slaState(t, eventsBy.get(t.id) ?? [], now) }))
      .sort((a, b) => {
        const doneA = a.s.state === "met" ? 1 : 0;
        const doneB = b.s.state === "met" ? 1 : 0;
        return doneA - doneB || PRIORITY_RANK[a.t.priority] - PRIORITY_RANK[b.t.priority] || a.s.remainingMs - b.s.remainingMs;
      });
  }, [data?.tickets, eventsBy, now, view, filters, q, actor.id]);

  const current = selected ? data?.tickets.find((t) => t.id === selected) ?? null : rows[0]?.t ?? null;
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
              <button key={v.id} type="button" role="tab" aria-selected={view === v.id} onClick={() => setView(v.id)}>{v.label}</button>
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
          {rows.map(({ t }) => (
            <Row key={t.id} ticket={t} events={eventsBy.get(t.id) ?? []} now={now} active={current?.id === t.id} onOpen={() => setSelected(t.id)} />
          ))}
          {!rows.length ? <li className="cx-empty">Nothing here. {view === "risk" ? "No ticket is close to its SLA." : ""}</li> : null}
        </ol>
      </aside>
      <section className="cx-detail">
        {current ? <TicketDetail key={current.id} ticket={current} events={eventsBy.get(current.id) ?? []} /> : <div className="cx-empty is-big">Pick a ticket on the left.</div>}
      </section>
      <aside className="cx-side">{current ? <CustomerPanel uid={current.customerUid} onOpenTicket={setSelected} /> : null}</aside>
    </div>
  );
}

function Row({ ticket: t, events, now, active, onOpen }: { ticket: Ticket; events: TicketEvent[]; now: Date; active: boolean; onOpen: () => void }) {
  const Icon = CHANNEL_ICON[t.channel];
  return (
    <li>
      <button type="button" className={`cx-row ${active ? "is-active" : ""} is-${t.priority.toLowerCase()}`} onClick={onOpen}>
        <span className="cx-row-top">
          <LabelBadge label={t.label} />
          <span className="cx-prio">{t.priority}</span>
          <span className="cx-code">{t.scenarioId}</span>
          <span className="cx-row-when">{when(t.createdAt, now)}</span>
        </span>
        <span className="cx-row-subject">{t.subject}</span>
        <span className="cx-row-meta">
          <Icon size={13} aria-label={CHANNEL_NAME[t.channel]} />
          <span>{t.level} · {t.ownerId ? actorName(t.ownerId) : QUEUE.get(t.queueId)?.name}</span>
          <SlaChip ticket={t} events={events} now={now} />
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

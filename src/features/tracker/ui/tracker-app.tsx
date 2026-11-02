"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties, type DragEvent } from "react";
import { AlertTriangle, ArrowLeft, Clock3, Hourglass, Inbox, KanbanSquare, LayoutList, MessageSquare, Plus, RotateCcw, Search, Trophy, Users, UsersRound, X } from "lucide-react";
import { EpikLogo } from "@/features/brand/epik-logo";
import { applyChange, canCreate, createTicket, TrackerError, type Change, type NewTicket } from "../lib/actions";
import { daysLate, flagFor, summarise, todayIst } from "../lib/insights";
import { DEFAULT_PEOPLE, ROLES, STATUSES, TEAMS, teamOf, type Person, type Status, type TeamId, type Ticket } from "../lib/model";
import { sampleTickets } from "../lib/samples";
import { Face, PriorityMark, TeamTag, shortDate } from "./bits";
import { NewTicketDialog, TicketDrawer } from "./ticket-drawer";
import { PeopleView, TeamsView } from "./team-views";

const STORAGE_KEY = "epik-tracker-v1";

type Saved = { people: Person[]; tickets: Ticket[]; me: string };
type View = "board" | "list" | "teams" | "people";
type Quick = "all" | "mine" | "late" | "waiting" | "unpicked";

function fresh(): Saved {
  return { people: DEFAULT_PEOPLE, tickets: sampleTickets(), me: "bhavya" };
}

function load(): Saved {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Saved;
      if (Array.isArray(saved.people) && Array.isArray(saved.tickets)) return saved;
    }
  } catch {
    // Private window or broken data: start again from the samples.
  }
  return fresh();
}

const noop = () => () => {};

/** Team Tracker. Front end only for now: everything lives in this browser. */
export function TrackerApp() {
  // Rendered only in the browser, because the data comes from this browser's storage.
  const ready = useSyncExternalStore(noop, () => true, () => false);
  if (!ready) return <div className="tk-loading" aria-busy="true" />;
  return <Tracker />;
}

function Tracker() {
  const [data, setData] = useState<Saved>(load);
  const [view, setView] = useState<View>("board");
  const [quick, setQuick] = useState<Quick>("all");
  const [teams, setTeams] = useState<TeamId[]>([]);
  const [person, setPerson] = useState<string>("");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [askWaiting, setAskWaiting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string; key: number } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<Status | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Storage full or blocked: the board still works until the tab closes.
    }
  }, [data]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), toast.ok ? 3500 : 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const now = new Date();
  const today = todayIst(now);
  const people = data.people;
  const me = people.find((p) => p.id === data.me) ?? people[0];
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const summary = summarise(data.tickets, today, now);

  const shown = data.tickets.filter((t) => {
    if (teams.length && !teams.includes(t.team)) return false;
    if (person && t.assignee !== person) return false;
    if (quick === "mine" && t.assignee !== me.id && t.requestedBy !== me.id) return false;
    if (quick === "late" && daysLate(t, today) === 0) return false;
    if (quick === "waiting" && t.status !== "waiting") return false;
    if (quick === "unpicked" && !(t.status === "new")) return false;
    if (q) {
      const text = `${t.title} ${t.description} #${t.number} ${byId.get(t.assignee ?? "")?.name ?? ""}`.toLowerCase();
      if (!text.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  function say(ok: boolean, text: string) {
    setToast((prev) => ({ ok, text, key: (prev?.key ?? 0) + 1 }));
  }

  function change(id: string, c: Change, message?: string): boolean {
    const ticket = data.tickets.find((t) => t.id === id);
    if (!ticket) return false;
    try {
      const next = applyChange(ticket, c, me, people);
      setData((d) => ({ ...d, tickets: d.tickets.map((t) => (t.id === id ? next : t)) }));
      if (message) say(true, message);
      return true;
    } catch (error) {
      say(false, error instanceof TrackerError ? error.message : "Could not save that.");
      return false;
    }
  }

  function create(input: NewTicket): boolean {
    try {
      const ticket = createTicket(data.tickets, input, me);
      setData((d) => ({ ...d, tickets: [ticket, ...d.tickets] }));
      say(true, `#${ticket.number} raised for ${teamOf(ticket.team).name}.`);
      return true;
    } catch (error) {
      say(false, error instanceof TrackerError ? error.message : "Could not raise the ticket.");
      return false;
    }
  }

  function drop(status: Status, event: DragEvent) {
    event.preventDefault();
    const id = dragId ?? event.dataTransfer.getData("text/plain");
    setDragId(null);
    setOver(null);
    const ticket = data.tickets.find((t) => t.id === id);
    if (!ticket || ticket.status === status) return;
    if (status === "waiting") {
      // Waiting needs a who and a why, so open the ticket and ask.
      setOpenId(id);
      setAskWaiting(true);
      return;
    }
    change(id, { kind: "status", status }, `#${ticket.number} moved to ${STATUSES.find((s) => s.id === status)?.label}.`);
  }

  function reset() {
    if (!window.confirm("Put the sample tickets back? Your changes in this browser will be lost.")) return;
    setData(fresh());
    setOpenId(null);
    say(true, "Sample data restored.");
  }

  const open = openId ? data.tickets.find((t) => t.id === openId) ?? null : null;
  const QUICK: Array<{ id: Quick; label: string; value: number; icon: typeof Inbox; tone: string }> = [
    { id: "all", label: "Open", value: summary.open, icon: Inbox, tone: "plain" },
    { id: "late", label: "Late", value: summary.late, icon: AlertTriangle, tone: summary.late ? "bad" : "plain" },
    { id: "waiting", label: "Waiting on someone", value: summary.waiting, icon: Hourglass, tone: summary.waiting ? "warn" : "plain" },
    { id: "unpicked", label: "Not picked up", value: data.tickets.filter((t) => t.status === "new").length, icon: Clock3, tone: summary.unpicked ? "warn" : "plain" },
  ];

  const VIEWS = [
    { id: "board", label: "Board", icon: KanbanSquare, title: "Team board", sub: "Every team's work in one place. Late and stuck tickets rise to the top." },
    { id: "list", label: "List", icon: LayoutList, title: "All tickets", sub: "Most late first." },
    { id: "teams", label: "Teams", icon: UsersRound, title: "Teams", sub: "Who is late, and who is holding up whom." },
    { id: "people", label: "People", icon: Users, title: "People and roles", sub: "Who is on which team, and what they can do." },
  ] as const;
  const current = VIEWS.find((v) => v.id === view)!;
  const filtering = view === "board" || view === "list";

  return (
    <div className="tk">
      <header className="tk-bar">
        <div className="tk-brand">
          {/* A full page load, so the operations shell comes back (the root layout does not re-render on client navigation). */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" className="tk-back" title="Back to EPIK Operations" aria-label="Back to EPIK Operations"><ArrowLeft size={16} /></a>
          <EpikLogo height={24} className="tk-logo" />
          <span className="tk-brand-name">Team Tracker</span>
        </div>
        <nav className="tk-tabs" aria-label="Views">
          {VIEWS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" aria-current={view === id ? "page" : undefined} onClick={() => setView(id)}>
              <Icon size={15} /> <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="tk-bar-right">
          <label className="tk-search">
            <Search size={14} aria-hidden="true" />
            <span className="sr-only">Search tickets</span>
            <input value={q} onChange={(e) => { setQ(e.target.value); if (!filtering) setView("board"); }} placeholder="Search tickets" />
            {q ? <button type="button" aria-label="Clear search" onClick={() => setQ("")}><X size={13} /></button> : null}
          </label>
          <label className="tk-me" title={ROLES[me.role].can}>
            <Face person={me} size={26} />
            <select value={me.id} onChange={(e) => setData((d) => ({ ...d, me: e.target.value }))} aria-label="You are">
              {people.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name} · {ROLES[p.role].label}</option>)}
            </select>
          </label>
          <button type="button" className="tk-primary" onClick={() => setCreating(true)} disabled={!canCreate(me)} title={canCreate(me) ? "Raise a ticket" : "Viewers cannot raise tickets"}>
            <Plus size={15} /> <span>New ticket</span>
          </button>
        </div>
      </header>

      <main className={`tk-main is-${view}`}>
        <div className="tk-titlerow">
          <div className="min-w-0">
            <h1>{current.title}</h1>
            <p>{current.sub}</p>
          </div>
          <div className="tk-metrics" role="group" aria-label="Summary">
            {QUICK.map((s) => {
              const Icon = s.icon;
              return (
                <button key={s.id} type="button" className={`tk-metric is-${s.tone}`} aria-pressed={quick === s.id} onClick={() => { setQuick(quick === s.id && s.id !== "all" ? "all" : s.id); if (!filtering) setView("board"); }}>
                  <Icon size={14} />
                  <b>{s.value}</b>
                  <span>{s.label}</span>
                </button>
              );
            })}
            <span className="tk-metric is-good is-static">
              <Trophy size={14} />
              <b>{summary.doneThisWeek}</b>
              <span>Done this week{summary.avgDaysToDone != null ? ` · ${summary.avgDaysToDone}d avg` : ""}</span>
            </span>
          </div>
        </div>

        {filtering ? (
          <div className="tk-filterbar">
            <div className="tk-teamchips" role="group" aria-label="Filter by team">
              {TEAMS.map((t) => {
                const on = teams.includes(t.id);
                return (
                  <button key={t.id} type="button" aria-pressed={on} style={{ "--team": t.colour } as CSSProperties} onClick={() => setTeams(on ? teams.filter((x) => x !== t.id) : [...teams, t.id])}>
                    <i /> {t.short}
                    <span>{data.tickets.filter((x) => x.team === t.id && x.status !== "done").length}</span>
                  </button>
                );
              })}
            </div>
            <div className="tk-filters">
              <select className="tk-select" value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Filter by person">
                <option value="">Everyone</option>
                {people.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button type="button" className="tk-chip" aria-pressed={quick === "mine"} onClick={() => setQuick(quick === "mine" ? "all" : "mine")}>Mine</button>
              {teams.length || person || quick !== "all" || q ? (
                <button type="button" className="tk-clear" onClick={() => { setTeams([]); setPerson(""); setQuick("all"); setQ(""); }}>Clear</button>
              ) : null}
            </div>
          </div>
        ) : null}

      {view === "board" ? (
        <div className="tk-board">
          {STATUSES.map((col) => {
            const cards = shown
              .filter((t) => t.status === col.id)
              .sort((a, b) => (col.id === "done" ? (b.doneAt ?? "").localeCompare(a.doneAt ?? "") : daysLate(b, today) - daysLate(a, today) || rank(a) - rank(b) || (a.due ?? "9").localeCompare(b.due ?? "9")));
            return (
              <section
                key={col.id}
                className={`tk-col is-${col.id} ${over === col.id ? "is-over" : ""}`}
                onDragOver={(e) => { e.preventDefault(); if (over !== col.id) setOver(col.id); }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }}
                onDrop={(e) => drop(col.id, e)}
                aria-label={col.label}
              >
                <header>
                  <span className="tk-col-dot" />
                  <h2>{col.label}</h2>
                  <span className="tk-col-count">{cards.length}</span>
                  <p>{col.hint}</p>
                </header>
                <div className="tk-col-body">
                  {cards.map((t) => (
                    <Card key={t.id} ticket={t} people={byId} today={today} now={now} dragging={dragId === t.id}
                      onOpen={() => { setOpenId(t.id); setAskWaiting(false); }}
                      onDragStart={(e) => { e.dataTransfer.setData("text/plain", t.id); e.dataTransfer.effectAllowed = "move"; setDragId(t.id); }}
                      onDragEnd={() => { setDragId(null); setOver(null); }}
                    />
                  ))}
                  {!cards.length ? <p className="tk-col-empty">{col.id === "waiting" ? "Nothing stuck. Nice." : "Drop a ticket here"}</p> : null}
                </div>
              </section>
            );
          })}
        </div>
      ) : null}

      {view === "list" ? <ListView tickets={shown} people={byId} today={today} now={now} onOpen={(id) => { setOpenId(id); setAskWaiting(false); }} /> : null}
      {view === "teams" ? <TeamsView tickets={data.tickets} people={people} today={today} now={now} onOpen={(id) => { setOpenId(id); setAskWaiting(false); }} onTeam={(team) => { setTeams([team]); setView("board"); }} /> : null}
      {view === "people" ? (
        <PeopleView
          people={people}
          tickets={data.tickets}
          me={me}
          today={today}
          onSave={(next) => { setData((d) => ({ ...d, people: next })); say(true, "People saved."); }}
          onError={(text) => say(false, text)}
        />
      ) : null}

      <footer className="tk-foot">
        <span>Demo: tickets are saved in this browser only. Switch the person at the top right to see what each role can do.</span>
        <button type="button" onClick={reset}><RotateCcw size={13} /> Reset sample data</button>
      </footer>
      </main>

      {open ? (
        <TicketDrawer
          key={open.id}
          ticket={open}
          people={people}
          me={me}
          today={today}
          askWaiting={askWaiting}
          onClose={() => { setOpenId(null); setAskWaiting(false); }}
          onChange={(c, message) => change(open.id, c, message)}
        />
      ) : null}
      {creating ? <NewTicketDialog people={people} me={me} today={today} onClose={() => setCreating(false)} onCreate={(input) => { const ok = create(input); if (ok) setCreating(false); return ok; }} /> : null}

      <div className="tk-toast-wrap" aria-live="polite">
        {toast ? <p key={toast.key} className={`tk-toast ${toast.ok ? "is-ok" : "is-bad"}`} role={toast.ok ? "status" : "alert"}>{toast.text}</p> : null}
      </div>
    </div>
  );
}

function rank(t: Ticket): number {
  return { urgent: 0, high: 1, normal: 2, low: 3 }[t.priority];
}

function Card({ ticket: t, people, today, now, dragging, onOpen, onDragStart, onDragEnd }: {
  ticket: Ticket;
  people: Map<string, Person>;
  today: string;
  now: Date;
  dragging: boolean;
  onOpen: () => void;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
}) {
  const flag = flagFor(t, today, now);
  const assignee = t.assignee ? people.get(t.assignee) : null;
  const team = teamOf(t.team);
  const late = daysLate(t, today) > 0;
  return (
    <button
      type="button"
      className={`tk-card ${dragging ? "is-dragging" : ""} ${t.status === "done" ? "is-done" : ""} ${late ? "is-late" : ""}`}
      style={{ "--team": team.colour } as CSSProperties}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
    >
      <span className="tk-card-top">
        <TeamTag team={t.team} small />
        <span className="tk-card-num">#{t.number}</span>
        <PriorityMark priority={t.priority} />
      </span>
      <span className="tk-card-title">{t.dropped ? <s>{t.title}</s> : t.title}</span>
      {t.status === "waiting" && t.waiting ? (
        <span className="tk-card-wait">
          <Hourglass size={12} /> Waiting on <b>{t.waiting.person ? people.get(t.waiting.person)?.name ?? teamOf(t.waiting.team).short : teamOf(t.waiting.team).short}</b>
        </span>
      ) : null}
      {t.requestingTeam !== t.team && t.status !== "done" ? <span className="tk-card-from">From {teamOf(t.requestingTeam).short}</span> : null}
      <span className="tk-card-foot">
        <Face person={assignee} size={22} title={assignee ? `Assigned to ${assignee.name}` : "Unassigned"} />
        {flag ? <span className={`tk-flag is-${flag.tone}`}>{flag.text}</span> : <span className="tk-card-due">{t.status === "done" ? (t.dropped ? "Dropped" : "Done") : `Due ${shortDate(t.due)}`}</span>}
        {t.comments.length ? <span className="tk-card-comments"><MessageSquare size={12} /> {t.comments.length}</span> : null}
      </span>
    </button>
  );
}

function ListView({ tickets, people, today, now, onOpen }: { tickets: Ticket[]; people: Map<string, Person>; today: string; now: Date; onOpen: (id: string) => void }) {
  const rows = [...tickets].sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || daysLate(b, today) - daysLate(a, today) || (a.due ?? "9").localeCompare(b.due ?? "9"));
  if (!rows.length) return <p className="tk-empty">No tickets match.</p>;
  return (
    <div className="tk-list">
      <table>
        <thead>
          <tr><th>Ticket</th><th>Team</th><th>Owner</th><th>Status</th><th>Due</th><th>Flag</th></tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const flag = flagFor(t, today, now);
            const owner = t.assignee ? people.get(t.assignee) : null;
            return (
              <tr key={t.id} onClick={() => onOpen(t.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") onOpen(t.id); }}>
                <td>
                  <span className="tk-list-title"><PriorityMark priority={t.priority} /> <span className="text-faint">#{t.number}</span> {t.title}</span>
                </td>
                <td><TeamTag team={t.team} small /></td>
                <td><span className="inline-flex items-center gap-2"><Face person={owner} size={20} /> {owner?.name ?? <span className="text-faint">Unassigned</span>}</span></td>
                <td><span className={`tk-status is-${t.status}`}>{STATUSES.find((s) => s.id === t.status)?.label}</span></td>
                <td className="tabular-nums">{shortDate(t.due)}</td>
                <td>{flag ? <span className={`tk-flag is-${flag.tone}`}>{flag.text}</span> : null}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

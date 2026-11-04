"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties, type DragEvent } from "react";
import { AlertTriangle, ArrowLeft, Ban, CalendarClock, Inbox, KanbanSquare, MessageSquare, Network, Plus, RotateCcw, Search, Trophy, UserRound, X } from "lucide-react";
import { EpikLogo } from "@/features/brand/epik-logo";
import { applyChange, createTicket, TrackerError, type Change, type NewTicket } from "../lib/actions";
import { branchHealth, daysLate, endOfWeek, flagFor, summarise, todayIst } from "../lib/insights";
import { DEFAULT_ORG, STATUSES, type OrgNode, type Status, type Ticket } from "../lib/model";
import { branchMembers, branchOf } from "../lib/org";
import { sampleTickets } from "../lib/samples";
import { BranchTag, Face, dueText } from "./bits";
import { OrgChart } from "./org-chart";
import { NewTicketDialog, TicketDrawer } from "./ticket-drawer";

export const STORAGE_KEY = "epik-tracker-v2";

type Saved = { org: OrgNode[]; tickets: Ticket[]; me: string };
type View = "board" | "mine" | "team";
type Quick = "all" | "late" | "today" | "blocked";

function fresh(): Saved {
  return { org: DEFAULT_ORG, tickets: sampleTickets(), me: "bhavya" };
}

function load(): Saved {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Saved;
      if (Array.isArray(saved.org) && saved.org.length && Array.isArray(saved.tickets)) return saved;
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

const VIEWS = [
  { id: "board", label: "Board", icon: KanbanSquare, title: "Team board", sub: "Everyone's work. Late work rises to the top." },
  { id: "mine", label: "My work", icon: UserRound, title: "My work", sub: "What is on you, most urgent first." },
  { id: "team", label: "Team", icon: Network, title: "Team chart", sub: "Founder, branches and their people. Click anyone to edit." },
] as const;

function Tracker() {
  const [data, setData] = useState<Saved>(load);
  const [view, setView] = useState<View>("board");
  const [quick, setQuick] = useState<Quick>("all");
  const [branch, setBranch] = useState<string>("");
  const [person, setPerson] = useState<string>("");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
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
    const timer = window.setTimeout(() => setToast(null), toast.ok ? 3000 : 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const now = new Date();
  const today = todayIst(now);
  const { org, tickets } = data;
  const me = org.some((n) => n.id === data.me) ? data.me : org[0].id;
  const byId = useMemo(() => new Map(org.map((n) => [n.id, n])), [org]);
  const summary = summarise(tickets, today, now);
  const health = branchHealth(org, tickets, today);
  const branchPeople = branch ? new Set(branchMembers(org, branch)) : null;

  const shown = tickets.filter((t) => {
    if (branchPeople && !(t.assignee && branchPeople.has(t.assignee))) return false;
    if (person && t.assignee !== person) return false;
    if (quick === "late" && daysLate(t, today) === 0) return false;
    if (quick === "today" && (t.due !== today || t.status === "done")) return false;
    if (quick === "blocked" && !(t.blocked && t.status !== "done")) return false;
    if (q) {
      const text = `${t.title} ${t.note} #${t.number} ${byId.get(t.assignee ?? "")?.name ?? ""}`.toLowerCase();
      if (!text.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  const say = (ok: boolean, text: string) => setToast((prev) => ({ ok, text, key: (prev?.key ?? 0) + 1 }));

  function change(id: string, c: Change, message?: string): boolean {
    const ticket = tickets.find((t) => t.id === id);
    if (!ticket) return false;
    try {
      const next = applyChange(ticket, c, me, org);
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
      const ticket = createTicket(tickets, input, me, org);
      setData((d) => ({ ...d, tickets: [ticket, ...d.tickets] }));
      say(true, `#${ticket.number} created${ticket.assignee ? ` for ${byId.get(ticket.assignee)?.name}` : ""}.`);
      return true;
    } catch (error) {
      say(false, error instanceof TrackerError ? error.message : "Could not create the ticket.");
      return false;
    }
  }

  function drop(status: Status, event: DragEvent) {
    event.preventDefault();
    const id = dragId ?? event.dataTransfer.getData("text/plain");
    setDragId(null);
    setOver(null);
    const ticket = tickets.find((t) => t.id === id);
    if (!ticket || ticket.status === status) return;
    change(id, { kind: "status", status }, `#${ticket.number} moved to ${STATUSES.find((s) => s.id === status)?.label}.`);
  }

  function reset() {
    if (!window.confirm("Put the sample team and tickets back? Your changes in this browser will be lost.")) return;
    setData(fresh());
    setOpenId(null);
    say(true, "Sample data restored.");
  }

  const open = openId ? tickets.find((t) => t.id === openId) ?? null : null;
  const current = VIEWS.find((v) => v.id === view)!;
  const QUICK: Array<{ id: Quick; label: string; value: number; icon: typeof Inbox; tone: string }> = [
    { id: "all", label: "Open", value: summary.open, icon: Inbox, tone: "plain" },
    { id: "late", label: "Late", value: summary.late, icon: AlertTriangle, tone: summary.late ? "bad" : "plain" },
    { id: "today", label: "Due today", value: summary.dueToday, icon: CalendarClock, tone: "plain" },
    { id: "blocked", label: "Blocked", value: summary.blocked, icon: Ban, tone: summary.blocked ? "warn" : "plain" },
  ];

  return (
    <div className="tk">
      <header className="tk-bar">
        <div className="tk-brand">
          {/* A full page load, so the operations shell comes back (the root layout does not re-render on client navigation). */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" className="tk-back" title="Back to EPIK home" aria-label="Back to EPIK home"><ArrowLeft size={16} /></a>
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
            <input value={q} onChange={(e) => { setQ(e.target.value); if (view !== "board") setView("board"); }} placeholder="Search" />
            {q ? <button type="button" aria-label="Clear search" onClick={() => setQ("")}><X size={13} /></button> : null}
          </label>
          <label className="tk-me" title="Who you are (demo)">
            <Face person={byId.get(me)} size={26} />
            <select value={me} onChange={(e) => setData((d) => ({ ...d, me: e.target.value }))} aria-label="You are">
              {org.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
          </label>
          <button type="button" className="tk-primary" onClick={() => setCreating(true)}>
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
          {view === "board" ? (
            <div className="tk-metrics" role="group" aria-label="Summary">
              {QUICK.map((s) => {
                const Icon = s.icon;
                return (
                  <button key={s.id} type="button" className={`tk-metric is-${s.tone}`} aria-pressed={quick === s.id} onClick={() => setQuick(quick === s.id && s.id !== "all" ? "all" : s.id)}>
                    <Icon size={14} />
                    <b>{s.value}</b>
                    <span>{s.label}</span>
                  </button>
                );
              })}
              <span className="tk-metric is-good is-static"><Trophy size={14} /><b>{summary.doneThisWeek}</b><span>Done this week</span></span>
            </div>
          ) : null}
        </div>

        {view === "board" ? (
          <>
            <div className="tk-filterbar">
              <div className="tk-teamchips" role="group" aria-label="Filter by branch">
                {health.filter((b) => b.open || b.id !== "founders").map((b) => {
                  const on = branch === b.id;
                  const waiting = b.waitingOn[0];
                  return (
                    <button key={b.id} type="button" aria-pressed={on} style={{ "--team": b.colour } as CSSProperties} onClick={() => setBranch(on ? "" : b.id)}
                      title={waiting ? `Waiting on ${waiting.name} for ${waiting.count}` : undefined}>
                      <i /> {b.name}
                      <span>{b.open}</span>
                      {b.late ? <span className="is-bad">{b.late} late</span> : null}
                    </button>
                  );
                })}
              </div>
              <div className="tk-filters">
                <select className="tk-select" value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Filter by person">
                  <option value="">Everyone</option>
                  {org.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                </select>
                {branch || person || quick !== "all" || q ? (
                  <button type="button" className="tk-clear" onClick={() => { setBranch(""); setPerson(""); setQuick("all"); setQ(""); }}>Clear</button>
                ) : null}
              </div>
            </div>
            <div className="tk-board">
              {STATUSES.map((col) => {
                const cards = shown
                  .filter((t) => t.status === col.id)
                  .sort((a, b) => (col.id === "done" ? (b.doneAt ?? "").localeCompare(a.doneAt ?? "") : daysLate(b, today) - daysLate(a, today) || (a.due ?? "9").localeCompare(b.due ?? "9")));
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
                    </header>
                    <div className="tk-col-body">
                      {cards.map((t) => (
                        <Card key={t.id} ticket={t} org={org} today={today} now={now} dragging={dragId === t.id}
                          onOpen={() => setOpenId(t.id)}
                          onDragStart={(e) => { e.dataTransfer.setData("text/plain", t.id); e.dataTransfer.effectAllowed = "move"; setDragId(t.id); }}
                          onDragEnd={() => { setDragId(null); setOver(null); }}
                        />
                      ))}
                      {!cards.length ? <p className="tk-col-empty">{col.id === "done" ? "Nothing finished yet" : "Drop a ticket here"}</p> : null}
                    </div>
                  </section>
                );
              })}
            </div>
          </>
        ) : null}

        {view === "mine" ? <MyWork tickets={tickets} org={org} me={me} today={today} now={now} onOpen={setOpenId} onNew={() => setCreating(true)} /> : null}

        {view === "team" ? (
          <OrgChart
            org={org}
            tickets={tickets}
            me={me}
            today={today}
            onSave={(next, message) => { setData((d) => ({ ...d, org: next })); say(true, message); }}
            onRemove={(next, removed, message) => {
              setData((d) => ({ ...d, org: next, me: d.me === removed ? next[0].id : d.me, tickets: d.tickets.map((t) => (t.assignee === removed && t.status !== "done" ? { ...t, assignee: null } : t)) }));
              say(true, message);
            }}
            onError={(text) => say(false, text)}
            onSeeWork={(id) => { setPerson(id); setBranch(""); setQuick("all"); setView("board"); }}
          />
        ) : null}

        <footer className="tk-foot">
          <span>Demo: saved in this browser only. Pick who you are at the top right.</span>
          <button type="button" onClick={reset}><RotateCcw size={13} /> Reset sample data</button>
        </footer>
      </main>

      {open ? <TicketDrawer key={open.id} ticket={open} org={org} me={me} today={today} onClose={() => setOpenId(null)} onChange={(c, message) => change(open.id, c, message)} /> : null}
      {creating ? <NewTicketDialog org={org} me={me} today={today} onClose={() => setCreating(false)} onCreate={(input) => { const ok = create(input); if (ok) setCreating(false); return ok; }} /> : null}

      <div className="tk-toast-wrap" aria-live="polite">
        {toast ? <p key={toast.key} className={`tk-toast ${toast.ok ? "is-ok" : "is-bad"}`} role={toast.ok ? "status" : "alert"}>{toast.text}</p> : null}
      </div>
    </div>
  );
}

function Card({ ticket: t, org, today, now, dragging, onOpen, onDragStart, onDragEnd }: {
  ticket: Ticket;
  org: OrgNode[];
  today: string;
  now: Date;
  dragging: boolean;
  onOpen: () => void;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
}) {
  const flag = flagFor(t, today, now);
  const who = org.find((n) => n.id === t.assignee) ?? null;
  const b = branchOf(org, t.assignee);
  const late = daysLate(t, today) > 0;
  return (
    <button
      type="button"
      className={`tk-card ${dragging ? "is-dragging" : ""} ${t.status === "done" ? "is-done" : ""} ${late ? "is-late" : ""}`}
      style={{ "--team": b?.colour ?? "#9ca3af" } as CSSProperties}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
    >
      <span className="tk-card-title">{t.title}</span>
      {t.blocked && t.status !== "done" ? (
        <span className="tk-card-wait"><Ban size={12} /> Blocked by <b>{org.find((n) => n.id === t.blocked!.by)?.name ?? "someone"}</b></span>
      ) : null}
      <span className="tk-card-foot">
        <Face person={who} size={22} title={who ? who.name : "Nobody yet"} />
        <span className="tk-card-who">{who?.name.split(" ")[0] ?? "Nobody yet"}</span>
        {flag ? <span className={`tk-flag is-${flag.tone}`}>{flag.text}</span> : <span className="tk-card-due">{t.status === "done" ? "Done" : dueText(t.due, today)}</span>}
        {t.comments.length ? <span className="tk-card-comments"><MessageSquare size={12} /> {t.comments.length}</span> : null}
      </span>
    </button>
  );
}

/** One person's day: what is on them, grouped by when, plus what others are waiting on them for. */
function MyWork({ tickets, org, me, today, now, onOpen, onNew }: { tickets: Ticket[]; org: OrgNode[]; me: string; today: string; now: Date; onOpen: (id: string) => void; onNew: () => void }) {
  const mine = tickets.filter((t) => t.assignee === me && t.status !== "done");
  const week = endOfWeek(today);
  const groups = [
    { id: "late", title: "Late", tone: "bad", rows: mine.filter((t) => daysLate(t, today) > 0) },
    { id: "today", title: "Today", tone: "", rows: mine.filter((t) => t.due === today) },
    { id: "week", title: "This week", tone: "", rows: mine.filter((t) => t.due && t.due > today && t.due <= week) },
    { id: "later", title: "Later", tone: "", rows: mine.filter((t) => !t.due || t.due > week) },
    { id: "waiting", title: "Others are waiting on you", tone: "warn", rows: tickets.filter((t) => t.blocked?.by === me && t.status !== "done") },
    { id: "asked", title: "You asked others", tone: "muted", rows: tickets.filter((t) => t.createdBy === me && t.assignee !== me && t.status !== "done") },
  ].filter((g) => g.rows.length);
  const name = org.find((n) => n.id === me)?.name.split(" ")[0] ?? "";

  if (!groups.length) {
    return (
      <div className="tk-empty">
        <p>Nothing on you, {name}. 🎉</p>
        <button type="button" className="tk-primary mt-3" onClick={onNew}><Plus size={14} /> New ticket</button>
      </div>
    );
  }
  return (
    <div className="tk-mine">
      {groups.map((g) => (
        <section key={g.id} className={`tk-mine-group is-${g.tone}`}>
          <h2>{g.title} <span>{g.rows.length}</span></h2>
          <ul>
            {g.rows.map((t) => {
              const flag = flagFor(t, today, now);
              const who = org.find((n) => n.id === t.assignee);
              return (
                <li key={t.id}>
                  <button type="button" onClick={() => onOpen(t.id)}>
                    <span className={`tk-mine-dot is-${t.status}`} title={STATUSES.find((s) => s.id === t.status)?.label} />
                    <span className="tk-mine-title">{t.title}</span>
                    {t.assignee !== me ? <span className="tk-mine-who"><Face person={who} size={18} /> {who?.name.split(" ")[0] ?? "Nobody yet"}</span> : null}
                    <BranchTag branch={g.id === "asked" || g.id === "waiting" ? branchOf(org, t.assignee) : null} small />
                    {t.blocked && t.assignee === me ? <span className="tk-flag is-warn">Blocked</span> : null}
                    {flag ? <span className={`tk-flag is-${flag.tone}`}>{flag.text}</span> : <span className="tk-card-due">{dueText(t.due, today)}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

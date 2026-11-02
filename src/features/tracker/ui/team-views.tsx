"use client";

import { useState, type CSSProperties } from "react";
import { ArrowRight, Lock, Plus, Trash2 } from "lucide-react";
import { canManagePeople } from "../lib/actions";
import { daysLate, handoffs, teamHealth } from "../lib/insights";
import { ROLE_IDS, ROLES, TEAMS, teamOf, type Person, type RoleId, type TeamId, type Ticket } from "../lib/model";
import { Face } from "./bits";

export function TeamsView({ tickets, people, today, now, onOpen, onTeam }: {
  tickets: Ticket[];
  people: Person[];
  today: string;
  now: Date;
  onOpen: (id: string) => void;
  onTeam: (team: TeamId) => void;
}) {
  const health = teamHealth(tickets, people, today, now);
  const chains = handoffs(tickets, now);
  const maxOpen = Math.max(1, ...health.map((h) => h.open));
  return (
    <div className="grid gap-4">
      <section className="tk-panel">
        <header className="tk-panel-head">
          <h2>Who is waiting on whom</h2>
          <p>Tickets one team cannot finish until another team acts. Longest wait first.</p>
        </header>
        {chains.length ? (
          <ul className="tk-chains">
            {chains.map((c) => (
              <li key={`${c.from}-${c.to}`}>
                <span className="tk-chain-team" style={{ "--team": teamOf(c.from).colour } as CSSProperties}>{teamOf(c.from).name}</span>
                <span className="tk-chain-arrow"><span>waiting on</span><ArrowRight size={14} /></span>
                <span className="tk-chain-team" style={{ "--team": teamOf(c.to).colour } as CSSProperties}>{teamOf(c.to).name}</span>
                <span className="tk-chain-count">{c.count} ticket{c.count === 1 ? "" : "s"}</span>
                <span className={`tk-flag ${c.oldestDays >= 3 ? "is-bad" : c.oldestDays >= 2 ? "is-warn" : "is-info"}`}>oldest {c.oldestDays || "<1"}d</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="tk-empty is-inline">No team is blocked by another right now.</p>
        )}
      </section>

      <div className="tk-team-grid">
        {health.map((h) => {
          const team = teamOf(h.team);
          return (
            <article key={h.team} className="tk-team-card" style={{ "--team": team.colour } as CSSProperties}>
              <header>
                <span className="tk-team-dot" />
                <span className="min-w-0 flex-1">
                  <h3>{team.name}</h3>
                  <p>{team.about}</p>
                </span>
                <button type="button" className="tk-ghost is-small" onClick={() => onTeam(h.team)}>Board <ArrowRight size={13} /></button>
              </header>
              <div className="tk-team-bar" aria-hidden="true"><span style={{ width: `${(h.open / maxOpen) * 100}%` }} /></div>
              <dl className="tk-team-stats">
                <div><dt>Open</dt><dd>{h.open}</dd></div>
                <div className={h.late ? "is-bad" : ""}><dt>Late</dt><dd>{h.late}</dd></div>
                <div className={h.blockingOthers ? "is-warn" : ""}><dt>Others wait on them</dt><dd>{h.blockingOthers}</dd></div>
                <div className="is-good"><dt>Done this week</dt><dd>{h.doneThisWeek}</dd></div>
              </dl>
              {h.oldestLate ? (
                <button type="button" className="tk-oldest" onClick={() => onOpen(h.oldestLate!.id)}>
                  <span className="tk-flag is-bad">{daysLate(h.oldestLate, today)}d late</span>
                  <span className="truncate">{h.oldestLate.title}</span>
                </button>
              ) : null}
              <ul className="tk-load">
                {h.load.length ? h.load.map((l) => (
                  <li key={l.person.id}>
                    <Face person={l.person} size={22} />
                    <span className="min-w-0 flex-1 truncate">{l.person.name}</span>
                    <span className="tabular-nums text-muted">{l.open} open</span>
                    {l.late ? <span className="tk-flag is-bad">{l.late} late</span> : null}
                  </li>
                )) : <li className="text-faint">No one added yet. Add people on the People tab.</li>}
              </ul>
            </article>
          );
        })}
      </div>
    </div>
  );
}

export function PeopleView({ people, tickets, me, today, onSave, onError }: {
  people: Person[];
  tickets: Ticket[];
  me: Person;
  today: string;
  onSave: (people: Person[]) => void;
  onError: (text: string) => void;
}) {
  const allowed = canManagePeople(me);
  const [rows, setRows] = useState<Person[]>(people);
  const dirty = JSON.stringify(rows) !== JSON.stringify(people);

  function edit(id: string, patch: Partial<Person>) {
    setRows((r) => r.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function add() {
    const id = `p${Date.now().toString(36)}`;
    setRows((r) => [...r, { id, name: "", title: "", team: "sales", role: "member", active: true }]);
  }

  function save() {
    const clean = rows.map((p) => ({ ...p, name: p.name.replace(/\s+/g, " ").trim().slice(0, 40), title: p.title.trim().slice(0, 40) }));
    if (clean.some((p) => p.active && !p.name)) return onError("Every person needs a name.");
    if (!clean.some((p) => p.active && (p.role === "founder" || p.role === "admin"))) return onError("Keep at least one founder or admin.");
    onSave(clean);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <section className="tk-panel">
        <header className="tk-panel-head">
          <h2>People</h2>
          <p>{allowed ? "Add your team, pick their team and role. Saved in this browser." : "Only a founder or admin can change this list."}</p>
        </header>
        <div className="tk-people">
          {rows.map((p) => {
            const open = tickets.filter((t) => t.assignee === p.id && t.status !== "done");
            const late = open.filter((t) => daysLate(t, today) > 0).length;
            return (
              <div key={p.id} className={`tk-person ${p.active ? "" : "is-off"}`}>
                <Face person={p.name ? p : null} size={32} />
                <input className="tk-input" value={p.name} disabled={!allowed} onChange={(e) => edit(p.id, { name: e.target.value })} placeholder="Name" aria-label="Name" />
                <input className="tk-input" value={p.title} disabled={!allowed} onChange={(e) => edit(p.id, { title: e.target.value })} placeholder="Job, e.g. Inventory" aria-label="Job" />
                <select className="tk-input" value={p.team} disabled={!allowed} onChange={(e) => edit(p.id, { team: e.target.value as TeamId })} aria-label="Team">
                  {TEAMS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <select className="tk-input" value={p.role} disabled={!allowed} onChange={(e) => edit(p.id, { role: e.target.value as RoleId })} aria-label="Role">
                  {ROLE_IDS.map((r) => <option key={r} value={r}>{ROLES[r].label}</option>)}
                </select>
                <span className="tk-person-load">{open.length} open{late ? <b> · {late} late</b> : null}</span>
                {allowed ? (
                  <button type="button" className="tk-icon-btn" title={p.active ? "Remove (keeps their history)" : "Bring back"} aria-label={p.active ? "Remove" : "Bring back"} onClick={() => edit(p.id, { active: !p.active })}>
                    {p.active ? <Trash2 size={14} /> : <Plus size={14} />}
                  </button>
                ) : <Lock size={14} className="text-faint" />}
              </div>
            );
          })}
        </div>
        {allowed ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="tk-ghost" onClick={add}><Plus size={14} /> Add a person</button>
            <span className="flex-1" />
            {dirty ? <button type="button" className="tk-ghost" onClick={() => setRows(people)}>Undo</button> : null}
            <button type="button" className="tk-primary is-small" disabled={!dirty} onClick={save}>Save people</button>
          </div>
        ) : null}
      </section>
      <aside className="tk-panel">
        <header className="tk-panel-head">
          <h2>Roles</h2>
          <p>What each role can do.</p>
        </header>
        <ul className="tk-roles">
          {ROLE_IDS.map((r) => (
            <li key={r}>
              <b>{ROLES[r].label}</b>
              <span>{ROLES[r].can}</span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

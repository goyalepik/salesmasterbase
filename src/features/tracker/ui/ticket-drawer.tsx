"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Check, Hourglass, Lock, Pencil, Send, X } from "lucide-react";
import { canEdit, dueFor, type Change, type NewTicket } from "../lib/actions";
import { daysSince } from "../lib/insights";
import { KINDS, PRIORITIES, STATUSES, TEAMS, teamOf, type Kind, type Person, type Priority, type TeamId, type Ticket } from "../lib/model";
import { Face, TeamTag, ago, shortDate } from "./bits";

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

export function TicketDrawer({ ticket: t, people, me, today, askWaiting, onClose, onChange }: {
  ticket: Ticket;
  people: Person[];
  me: Person;
  today: string;
  askWaiting: boolean;
  onClose: () => void;
  onChange: (change: Change, message?: string) => boolean;
}) {
  useEscape(onClose);
  const editable = canEdit(me, t);
  const [waitOpen, setWaitOpen] = useState(askWaiting);
  const [waitTeam, setWaitTeam] = useState<TeamId>(t.waiting?.team ?? (t.requestingTeam !== t.team ? t.requestingTeam : "founders_office"));
  const [waitPerson, setWaitPerson] = useState<string>(t.waiting?.person ?? "");
  const [waitReason, setWaitReason] = useState("");
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(t.title);
  const [description, setDescription] = useState(t.description);
  const [comment, setComment] = useState("");
  const byId = new Map(people.map((p) => [p.id, p]));
  const name = (id: string | null) => (id ? byId.get(id)?.name ?? "Someone" : "Nobody");
  const late = t.due && t.status !== "done" && t.due < today;

  const timeline = [
    ...t.events.map((e) => ({ at: e.at, by: e.by, text: e.text, comment: false })),
    ...t.comments.map((c) => ({ at: c.at, by: c.by, text: c.text, comment: true })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  function postComment(event: FormEvent) {
    event.preventDefault();
    if (onChange({ kind: "comment", text: comment })) setComment("");
  }

  function saveWaiting(event: FormEvent) {
    event.preventDefault();
    if (onChange({ kind: "status", status: "waiting", waiting: { team: waitTeam, person: waitPerson || null, reason: waitReason } }, "Marked as waiting. The other team can see it on Teams.")) {
      setWaitOpen(false);
      setWaitReason("");
    }
  }

  return (
    <div className="tk-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="tk-drawer" role="dialog" aria-modal="true" aria-label={`Ticket #${t.number}`} style={{ "--team": teamOf(t.team).colour } as React.CSSProperties}>
        <header className="tk-drawer-head">
          <span className="flex min-w-0 items-center gap-2">
            <TeamTag team={t.team} />
            <span className="text-faint text-[12.5px]">#{t.number} · {KINDS.find((k) => k.id === t.kind)?.label}</span>
          </span>
          <button type="button" className="tk-icon-btn" onClick={onClose} aria-label="Close"><X size={17} /></button>
        </header>

        <div className="tk-drawer-body">
          {editing ? (
            <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); if (onChange({ kind: "text", title, description }, "Details saved.")) setEditing(false); }}>
              <input className="tk-input text-[17px] font-semibold" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" autoFocus />
              <textarea className="tk-input min-h-28" value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Details" />
              <span className="flex gap-2">
                <button type="submit" className="tk-primary is-small"><Check size={14} /> Save</button>
                <button type="button" className="tk-ghost" onClick={() => { setEditing(false); setTitle(t.title); setDescription(t.description); }}>Cancel</button>
              </span>
            </form>
          ) : (
            <div className="tk-drawer-title">
              <h2>{t.dropped ? <s>{t.title}</s> : t.title}</h2>
              {editable ? <button type="button" className="tk-icon-btn" onClick={() => setEditing(true)} aria-label="Edit title and details"><Pencil size={14} /></button> : null}
            </div>
          )}
          {!editing && t.description ? <p className="tk-drawer-desc">{t.description}</p> : null}

          {!editable ? (
            <p className="tk-locked"><Lock size={13} /> {me.role === "viewer" ? "Viewers can comment but not change tickets." : `This is ${teamOf(t.team).name}'s ticket, so you can comment but not change it.`}</p>
          ) : null}

          <div className="tk-steps" role="group" aria-label="Status">
            {STATUSES.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`is-${s.id}`}
                aria-pressed={t.status === s.id}
                disabled={!editable}
                title={s.hint}
                onClick={() => {
                  if (s.id === "waiting") { setWaitOpen(true); return; }
                  setWaitOpen(false);
                  onChange({ kind: "status", status: s.id }, `Moved to ${s.label}.`);
                }}
              >
                {s.label}
              </button>
            ))}
          </div>

          {waitOpen && editable ? (
            <form className="tk-wait-form" onSubmit={saveWaiting}>
              <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink"><Hourglass size={14} /> Who is this waiting on?</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <select className="tk-input" value={waitTeam} onChange={(e) => { setWaitTeam(e.target.value as TeamId); setWaitPerson(""); }} aria-label="Team">
                  {TEAMS.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                </select>
                <select className="tk-input" value={waitPerson} onChange={(e) => setWaitPerson(e.target.value)} aria-label="Person">
                  <option value="">Anyone in the team</option>
                  {people.filter((p) => p.active && p.team === waitTeam).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <input className="tk-input" value={waitReason} onChange={(e) => setWaitReason(e.target.value)} placeholder="What do you need from them? e.g. approval for the PO" aria-label="Reason" autoFocus />
              <span className="flex gap-2">
                <button type="submit" className="tk-primary is-small">Mark as waiting</button>
                <button type="button" className="tk-ghost" onClick={() => setWaitOpen(false)}>Cancel</button>
              </span>
            </form>
          ) : null}

          {t.status === "waiting" && t.waiting && !waitOpen ? (
            <div className="tk-waiting">
              <Hourglass size={16} />
              <span className="min-w-0">
                <b>Waiting on {t.waiting.person ? `${name(t.waiting.person)} (${teamOf(t.waiting.team).name})` : teamOf(t.waiting.team).name}</b>
                <span>{t.waiting.reason}</span>
                <span className="text-faint">For {daysSince(t.waiting.since) || "less than 1"} day{daysSince(t.waiting.since) === 1 ? "" : "s"}</span>
              </span>
            </div>
          ) : null}

          <dl className="tk-fields">
            <div>
              <dt>Owner</dt>
              <dd>
                <Face person={t.assignee ? byId.get(t.assignee) : null} size={22} />
                <select value={t.assignee ?? ""} disabled={!editable} onChange={(e) => onChange({ kind: "assign", assignee: e.target.value || null }, e.target.value ? `Given to ${name(e.target.value)}.` : "Unassigned.")} aria-label="Owner">
                  <option value="">Unassigned</option>
                  {people.filter((p) => p.active).sort((a, b) => Number(b.team === t.team) - Number(a.team === t.team)).map((p) => <option key={p.id} value={p.id}>{p.name}{p.team === t.team ? "" : ` (${teamOf(p.team).short})`}</option>)}
                </select>
              </dd>
            </div>
            <div>
              <dt>Due</dt>
              <dd className={late ? "text-bad" : undefined}>
                <input type="date" value={t.due ?? ""} disabled={!editable} onChange={(e) => onChange({ kind: "due", due: e.target.value || null })} aria-label="Due date" />
              </dd>
            </div>
            <div>
              <dt>Priority</dt>
              <dd>
                <select value={t.priority} disabled={!editable} onChange={(e) => onChange({ kind: "priority", priority: e.target.value as Priority })} aria-label="Priority">
                  {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </dd>
            </div>
            <div>
              <dt>Team</dt>
              <dd>
                <select value={t.team} disabled={!editable} onChange={(e) => onChange({ kind: "team", team: e.target.value as TeamId }, `Handed to ${teamOf(e.target.value).name}.`)} aria-label="Team">
                  {TEAMS.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                </select>
              </dd>
            </div>
            <div>
              <dt>Raised by</dt>
              <dd><Face person={byId.get(t.requestedBy)} size={22} /> {name(t.requestedBy)} <span className="text-faint">· {teamOf(t.requestingTeam).short}</span></dd>
            </div>
            <div>
              <dt>Raised</dt>
              <dd>{shortDate(t.createdAt)} <span className="text-faint">· {ago(t.createdAt)}</span></dd>
            </div>
          </dl>

          {editable && t.status !== "done" ? (
            <button type="button" className="tk-link-danger" onClick={() => { if (window.confirm("Drop this ticket? It moves to Done as dropped.")) onChange({ kind: "status", status: "done", dropped: true }, "Ticket dropped."); }}>
              Drop this ticket
            </button>
          ) : null}

          <section className="tk-activity">
            <h3>Activity</h3>
            <form className="tk-comment" onSubmit={postComment}>
              <Face person={me} size={26} />
              <input className="tk-input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write an update or ask a question" aria-label="Comment" />
              <button type="submit" className="tk-icon-btn is-send" aria-label="Post" disabled={!comment.trim()}><Send size={15} /></button>
            </form>
            <ol>
              {timeline.map((item, i) => (
                <li key={i} className={item.comment ? "is-comment" : ""}>
                  <Face person={byId.get(item.by)} size={item.comment ? 26 : 18} />
                  <span className="min-w-0 flex-1">
                    {item.comment ? (
                      <>
                        <span className="tk-act-meta"><b>{name(item.by)}</b> · {ago(item.at)}</span>
                        <span className="tk-act-comment">{item.text}</span>
                      </>
                    ) : (
                      <span className="tk-act-meta"><b>{name(item.by)}</b> {item.text} · {ago(item.at)}</span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </aside>
    </div>
  );
}

export function NewTicketDialog({ people, me, today, onClose, onCreate }: {
  people: Person[];
  me: Person;
  today: string;
  onClose: () => void;
  onCreate: (input: NewTicket) => boolean;
}) {
  useEscape(onClose);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [team, setTeam] = useState<TeamId>(me.team);
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [kind, setKind] = useState<Kind>("task");
  const [due, setDue] = useState(dueFor("normal", today));
  const [dueTouched, setDueTouched] = useState(false);
  const teamPeople = people.filter((p) => p.active && p.team === team);

  return (
    <div className="tk-overlay is-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form
        className="tk-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="New ticket"
        onSubmit={(e) => { e.preventDefault(); onCreate({ title, description, team, assignee: assignee || null, priority, kind, due: due || null }); }}
      >
        <header className="tk-drawer-head">
          <h2 className="text-[17px] font-semibold text-ink">New ticket</h2>
          <button type="button" className="tk-icon-btn" onClick={onClose} aria-label="Close"><X size={17} /></button>
        </header>
        <div className="grid gap-3 p-5">
          <input className="tk-input text-[15px]" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing? e.g. Refund for #PIK3871" aria-label="Title" autoFocus required />
          <textarea className="tk-input min-h-24" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Details, links, order numbers (optional)" aria-label="Details" />
          <div>
            <p className="tk-label">Which team should do it?</p>
            <div className="tk-team-pick">
              {TEAMS.map((x) => (
                <button key={x.id} type="button" aria-pressed={team === x.id} style={{ "--team": x.colour } as React.CSSProperties} onClick={() => { setTeam(x.id); setAssignee(""); }}>
                  <i /> {x.short}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="tk-label">Owner</span>
              <select className="tk-input" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">{teamPeople.length ? "Let the team pick" : "Unassigned (no one added yet)"}</option>
                {teamPeople.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                {me.team !== team ? <option value={me.id}>Me ({me.name})</option> : null}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="tk-label">Type</span>
              <select className="tk-input" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
                {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="tk-label">Priority</span>
              <select className="tk-input" value={priority} onChange={(e) => { const p = e.target.value as Priority; setPriority(p); if (!dueTouched) setDue(dueFor(p, today)); }}>
                {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label} (due in {p.days} day{p.days === 1 ? "" : "s"})</option>)}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="tk-label">Due</span>
              <input type="date" className="tk-input" value={due} min={today} onChange={(e) => { setDue(e.target.value); setDueTouched(true); }} />
            </label>
          </div>
          <p className="text-[12px] text-faint">Raised by {me.name} ({teamOf(me.team).name}). The other team sees it under New until someone picks it up.</p>
          <span className="flex justify-end gap-2">
            <button type="button" className="tk-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="tk-primary">Raise ticket</button>
          </span>
        </div>
      </form>
    </div>
  );
}

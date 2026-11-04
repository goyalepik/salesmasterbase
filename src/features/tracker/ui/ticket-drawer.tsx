"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Ban, Check, Lock, Pencil, Send, X } from "lucide-react";
import { canEdit, type Change, type NewTicket } from "../lib/actions";
import { addDays, daysSince, endOfWeek } from "../lib/insights";
import { STATUSES, type OrgNode, type Ticket } from "../lib/model";
import { branchOf } from "../lib/org";
import { BranchTag, Face, ago, dueText } from "./bits";

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

/** Who can be picked: everyone on the chart, grouped by branch so the list reads like the team. */
function PersonSelect({ org, value, onChange, empty, disabled, label }: { org: OrgNode[]; value: string; onChange: (id: string) => void; empty: string; disabled?: boolean; label: string }) {
  const groups = new Map<string, OrgNode[]>();
  for (const n of org) {
    const b = branchOf(org, n.id)?.name ?? "Team";
    groups.set(b, [...(groups.get(b) ?? []), n]);
  }
  return (
    <select className="tk-input" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-label={label}>
      <option value="">{empty}</option>
      {[...groups.entries()].map(([b, people]) => (
        <optgroup key={b} label={b}>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
      ))}
    </select>
  );
}

/** Today, tomorrow, this week, next week, or a date. One tap for the usual cases. */
function DuePicker({ value, onChange, today, disabled }: { value: string | null; onChange: (due: string | null) => void; today: string; disabled?: boolean }) {
  const quick = [
    { label: "Today", due: today },
    { label: "Tomorrow", due: addDays(today, 1) },
    { label: "This week", due: endOfWeek(today) },
    { label: "Next week", due: addDays(endOfWeek(today), 7) },
  ];
  return (
    <div className="tk-due">
      {quick.map((q) => (
        <button key={q.label} type="button" disabled={disabled} aria-pressed={value === q.due} onClick={() => onChange(q.due)}>{q.label}</button>
      ))}
      <input type="date" className="tk-input" value={value ?? ""} min={today} disabled={disabled} onChange={(e) => onChange(e.target.value || null)} aria-label="Pick a date" />
    </div>
  );
}

export function TicketDrawer({ ticket: t, org, me, today, onClose, onChange }: {
  ticket: Ticket;
  org: OrgNode[];
  me: string;
  today: string;
  onClose: () => void;
  onChange: (change: Change, message?: string) => boolean;
}) {
  useEscape(onClose);
  const editable = canEdit(org, me, t);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(t.title);
  const [note, setNote] = useState(t.note);
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockBy, setBlockBy] = useState("");
  const [blockReason, setBlockReason] = useState("");
  const [comment, setComment] = useState("");
  const person = (id: string | null) => org.find((n) => n.id === id) ?? null;
  const late = t.due && t.status !== "done" && t.due < today;

  const timeline = [
    ...t.history.map((e) => ({ at: e.at, by: e.by, text: e.text, comment: false })),
    ...t.comments.map((c) => ({ at: c.at, by: c.by, text: c.text, comment: true })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  function block(event: FormEvent) {
    event.preventDefault();
    if (!blockBy) return;
    if (onChange({ kind: "block", by: blockBy, reason: blockReason }, "Marked as blocked.")) {
      setBlockOpen(false);
      setBlockReason("");
    }
  }

  return (
    <div className="tk-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="tk-drawer" role="dialog" aria-modal="true" aria-label={`Ticket #${t.number}`}>
        <header className="tk-drawer-head">
          <span className="flex min-w-0 items-center gap-2">
            <BranchTag branch={branchOf(org, t.assignee)} />
            <span className="text-faint text-[12.5px]">#{t.number}</span>
          </span>
          <button type="button" className="tk-icon-btn" onClick={onClose} aria-label="Close"><X size={17} /></button>
        </header>

        <div className="tk-drawer-body">
          {editing ? (
            <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); if (onChange({ kind: "edit", title, note }, "Saved.")) setEditing(false); }}>
              <input className="tk-input text-[17px] font-semibold" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="What needs doing" autoFocus />
              <textarea className="tk-input min-h-24" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" placeholder="Any detail that helps (optional)" />
              <span className="flex gap-2">
                <button type="submit" className="tk-primary"><Check size={14} /> Save</button>
                <button type="button" className="tk-ghost" onClick={() => { setEditing(false); setTitle(t.title); setNote(t.note); }}>Cancel</button>
              </span>
            </form>
          ) : (
            <>
              <div className="tk-drawer-title">
                <h2>{t.title}</h2>
                {editable ? <button type="button" className="tk-icon-btn" onClick={() => setEditing(true)} aria-label="Edit"><Pencil size={15} /></button> : null}
              </div>
              {t.note ? <p className="tk-drawer-desc">{t.note}</p> : null}
            </>
          )}

          {!editable ? <p className="tk-locked"><Lock size={13} /> Only {person(t.assignee)?.name ?? "the owner"}, {person(t.createdBy)?.name ?? "the creator"} or an admin can change this. You can comment.</p> : null}

          <div className="tk-steps" role="group" aria-label="Status">
            {STATUSES.map((s) => (
              <button key={s.id} type="button" className={`is-${s.id}`} aria-pressed={t.status === s.id} disabled={!editable} onClick={() => onChange({ kind: "status", status: s.id }, `Moved to ${s.label}.`)}>{s.label}</button>
            ))}
          </div>

          {t.blocked ? (
            <div className="tk-waiting">
              <Ban size={16} />
              <span>
                <b>Blocked by {person(t.blocked.by)?.name ?? "someone"} · {daysSince(t.blocked.since) || "today"}{daysSince(t.blocked.since) ? " days" : ""}</b>
                {t.blocked.reason}
              </span>
              {editable ? <button type="button" className="tk-ghost ml-auto" onClick={() => onChange({ kind: "unblock" }, "Unblocked.")}>Unblock</button> : null}
            </div>
          ) : editable && t.status !== "done" ? (
            blockOpen ? (
              <form className="tk-wait-form" onSubmit={block}>
                <label><span className="tk-label">Blocked by</span><PersonSelect org={org.filter((n) => n.id !== t.assignee)} value={blockBy} onChange={setBlockBy} empty="Who are you waiting on?" label="Blocked by" /></label>
                <label><span className="tk-label">Waiting for what</span><input className="tk-input" value={blockReason} onChange={(e) => setBlockReason(e.target.value)} placeholder="e.g. approval for the PO" autoFocus /></label>
                <span className="flex gap-2">
                  <button type="submit" className="tk-primary" disabled={!blockBy || !blockReason.trim()}>Mark blocked</button>
                  <button type="button" className="tk-ghost" onClick={() => setBlockOpen(false)}>Cancel</button>
                </span>
              </form>
            ) : (
              <button type="button" className="tk-blocklink" onClick={() => setBlockOpen(true)}><Ban size={13} /> Stuck on someone?</button>
            )
          ) : null}

          <dl className="tk-fields">
            <div>
              <dt>Who</dt>
              <dd><Face person={person(t.assignee)} size={20} /><PersonSelect org={org} value={t.assignee ?? ""} onChange={(id) => onChange({ kind: "assignee", assignee: id || null }, id ? `Given to ${person(id)?.name}.` : "Unassigned.")} empty="Nobody yet" disabled={!editable} label="Who" /></dd>
            </div>
            <div>
              <dt>Created by</dt>
              <dd><Face person={person(t.createdBy)} size={20} /> {person(t.createdBy)?.name ?? "Someone"} · {ago(t.createdAt)}</dd>
            </div>
            <div className="tk-fields-wide">
              <dt>By when {late ? <b className="text-bad">· late</b> : null}</dt>
              <dd><DuePicker value={t.due} today={today} disabled={!editable} onChange={(due) => onChange({ kind: "due", due }, due ? `Due ${dueText(due, today)}.` : "Date removed.")} /></dd>
            </div>
          </dl>

          <section className="tk-activity">
            <h3>Comments and history</h3>
            <form className="tk-comment" onSubmit={(e) => { e.preventDefault(); if (onChange({ kind: "comment", text: comment })) setComment(""); }}>
              <input className="tk-input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write a comment" />
              <button type="submit" className="tk-icon-btn" aria-label="Send comment" disabled={!comment.trim()}><Send size={15} /></button>
            </form>
            <ol>
              {timeline.map((e, i) => (
                <li key={i} className={e.comment ? "is-comment" : ""}>
                  <Face person={person(e.by)} size={22} />
                  <span className="min-w-0">
                    <span className="tk-act-meta"><b>{person(e.by)?.name ?? "Someone"}</b> {e.comment ? "" : e.text.charAt(0).toLowerCase() + e.text.slice(1)} · {ago(e.at)}</span>
                    {e.comment ? <span className="tk-act-comment">{e.text}</span> : null}
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

export function NewTicketDialog({ org, me, today, onClose, onCreate }: { org: OrgNode[]; me: string; today: string; onClose: () => void; onCreate: (input: NewTicket) => boolean }) {
  useEscape(onClose);
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState(me);
  const [due, setDue] = useState<string | null>(endOfWeek(today));
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);

  return (
    <div className="tk-overlay is-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="tk-dialog tk-new" role="dialog" aria-modal="true" aria-label="New ticket" onSubmit={(e) => { e.preventDefault(); onCreate({ title, note, assignee: assignee || null, due }); }}>
        <header className="tk-drawer-head">
          <b className="text-ink">New ticket</b>
          <button type="button" className="tk-icon-btn" onClick={onClose} aria-label="Close"><X size={17} /></button>
        </header>
        <div className="grid gap-4 p-5">
          <label>
            <span className="tk-label">What needs doing?</span>
            <input className="tk-input text-[15px]" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Send the Dreame PO to the vendor" autoFocus />
          </label>
          <label>
            <span className="tk-label">Who will do it?</span>
            <PersonSelect org={org} value={assignee} onChange={setAssignee} empty="Nobody yet" label="Who will do it" />
          </label>
          <div>
            <span className="tk-label">By when?</span>
            <DuePicker value={due} onChange={setDue} today={today} />
          </div>
          {showNote ? (
            <label><span className="tk-label">Note</span><textarea className="tk-input min-h-20" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Any detail that helps" /></label>
          ) : (
            <button type="button" className="tk-blocklink" onClick={() => setShowNote(true)}>+ Add a note</button>
          )}
        </div>
        <footer className="tk-new-foot">
          <button type="button" className="tk-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="tk-primary" disabled={!title.trim()}>Create</button>
        </footer>
      </form>
    </div>
  );
}

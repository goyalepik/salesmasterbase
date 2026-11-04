"use client";

import { useState, type CSSProperties, type FormEvent } from "react";
import { ListChecks, Plus, Shield, Trash2, UserPlus, X } from "lucide-react";
import { loadOf } from "../lib/insights";
import { MAX_LEVELS, type OrgNode, type Ticket } from "../lib/model";
import { addPerson, branchOf, branches, canAddUnder, childrenOf, isAdmin, levelOf, movePerson, OrgError, removePerson, updatePerson } from "../lib/org";
import { Face } from "./bits";

type Props = {
  org: OrgNode[];
  tickets: Ticket[];
  me: string;
  today: string;
  onSave: (next: OrgNode[], message: string) => void;
  onRemove: (next: OrgNode[], removedId: string, message: string) => void;
  onError: (text: string) => void;
  onSeeWork: (personId: string) => void;
};

/** The team chart: founder at the top, branches below, their people under each branch. Three levels, no more. */
export function OrgChart({ org, tickets, me, today, onSave, onRemove, onError, onSeeWork }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [addingUnder, setAddingUnder] = useState<string | null | undefined>(undefined);
  const canManage = isAdmin(org, me);
  const roots = childrenOf(org, null);
  const colours = new Map(branches(org).map((b) => [b.id, b.colour]));

  const run = (fn: () => OrgNode[], message: string) => {
    try {
      onSave(fn(), message);
      return true;
    } catch (error) {
      onError(error instanceof OrgError ? error.message : "Could not save that.");
      return false;
    }
  };

  const pick = (id: string) => { setSelected(id); setAddingUnder(undefined); };
  const add = (parentId: string | null) => { setAddingUnder(parentId); setSelected(null); };

  const node = (n: OrgNode, level: number) => {
    const load = loadOf(tickets, n.id, today);
    return (
      <div className={`tk-node is-l${level} ${selected === n.id ? "is-selected" : ""}`} style={{ "--team": colours.get(level === 2 ? n.id : n.parentId ?? "") ?? "#111827" } as CSSProperties}>
        <button type="button" className="tk-node-main" onClick={() => pick(n.id)}>
          <Face person={n} size={level === 1 ? 40 : level === 2 ? 34 : 28} />
          <span className="tk-node-text">
            <b>{n.name}</b>
            <span>{n.title || (level === 1 ? "Founder" : "")}</span>
          </span>
          {n.admin && level > 1 ? <Shield size={12} className="tk-node-admin" aria-label="Admin" /> : null}
        </button>
        <span className="tk-node-load">
          {load.open ? <span>{load.open} open</span> : <span className="text-faint">No open work</span>}
          {load.late ? <span className="is-bad">{load.late} late</span> : null}
          {load.blocked ? <span className="is-warn">{load.blocked} blocked</span> : null}
        </span>
        {canManage && canAddUnder(org, n.id) ? (
          <button type="button" className="tk-node-add" onClick={() => add(n.id)} title={`Add someone under ${n.name}`} aria-label={`Add someone under ${n.name}`}><Plus size={13} /></button>
        ) : null}
      </div>
    );
  };

  return (
    <div className="tk-orgwrap">
      <div className="tk-org" aria-label="Team chart">
        {roots.map((root) => {
          const heads = childrenOf(org, root.id);
          return (
            <div key={root.id} className="tk-org-tree">
              <div className="tk-org-root">{node(root, 1)}</div>
              {heads.length ? (
                <div className="tk-org-branches" style={{ "--n": heads.length } as CSSProperties}>
                  {heads.map((h) => (
                    <div key={h.id} className="tk-org-branch">
                      <span className="tk-branch-name" style={{ "--team": colours.get(h.id) } as CSSProperties}><i />{h.branch || h.title}</span>
                      {node(h, 2)}
                      <div className="tk-org-people">
                        {childrenOf(org, h.id).map((p) => <div key={p.id} className="tk-org-person">{node(p, 3)}</div>)}
                        {canManage ? <button type="button" className="tk-org-addrow" onClick={() => add(h.id)}><UserPlus size={13} /> Add person</button> : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
        {canManage ? (
          <div className="tk-org-addbranch">
            {roots.length === 1 ? <button type="button" className="tk-ghost" onClick={() => add(roots[0].id)}><Plus size={14} /> New branch</button> : null}
            <button type="button" className="tk-ghost" onClick={() => add(null)}><Plus size={14} /> Add a founder</button>
          </div>
        ) : null}
      </div>

      <aside className="tk-orgside">
        {addingUnder !== undefined ? (
          <AddForm org={org} parentId={addingUnder} onCancel={() => setAddingUnder(undefined)} onAdd={(input) => { if (run(() => addPerson(org, input), `${input.name.trim()} added.`)) setAddingUnder(undefined); }} />
        ) : selected && org.some((n) => n.id === selected) ? (
          <EditForm
            key={selected}
            org={org}
            id={selected}
            canManage={canManage}
            tickets={tickets}
            onClose={() => setSelected(null)}
            onSave={(patch) => run(() => updatePerson(org, selected, patch), "Saved.")}
            onMove={(parentId) => run(() => movePerson(org, selected, parentId), "Moved.")}
            onAddUnder={() => add(selected)}
            onSeeWork={() => onSeeWork(selected)}
            onRemove={() => {
              const name = org.find((n) => n.id === selected)?.name;
              if (!window.confirm(`Remove ${name} from the chart? Their open tickets will have nobody on them.`)) return;
              try {
                onRemove(removePerson(org, selected), selected, `${name} removed.`);
                setSelected(null);
              } catch (error) {
                onError(error instanceof OrgError ? error.message : "Could not remove.");
              }
            }}
          />
        ) : (
          <div className="tk-orghelp">
            <h3>How the team works</h3>
            <ol>
              <li><b>Founder</b> at the top.</li>
              <li><b>Branch heads</b> below: one per branch, such as Operations or Marketing.</li>
              <li><b>Their people</b> under each branch.</li>
            </ol>
            <p>{MAX_LEVELS} levels, no more. A ticket shows the branch of the person doing it, so nobody has to pick a team.</p>
            <p className="text-faint">{canManage ? "Click a person to edit, move or remove them. Use + to add someone under a person." : "Only founders and admins can change the chart."}</p>
          </div>
        )}
      </aside>
    </div>
  );
}

function AddForm({ org, parentId, onAdd, onCancel }: { org: OrgNode[]; parentId: string | null; onAdd: (input: { name: string; title: string; parentId: string | null; branch?: string }) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [branch, setBranch] = useState("");
  const parent = org.find((n) => n.id === parentId);
  const newBranch = parent ? levelOf(org, parent.id) === 1 : false;
  const submit = (e: FormEvent) => { e.preventDefault(); onAdd({ name, title, parentId, branch: newBranch ? branch : undefined }); };
  return (
    <form className="tk-orgform" onSubmit={submit}>
      <header><h3>{!parent ? "Add a founder" : newBranch ? "New branch" : `Add to ${parent.branch || parent.name}`}</h3><button type="button" className="tk-icon-btn" onClick={onCancel} aria-label="Close"><X size={15} /></button></header>
      {parent ? <p className="text-muted">Reports to {parent.name}.</p> : null}
      {newBranch ? <label><span className="tk-label">Branch name</span><input className="tk-input" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="e.g. Sales" autoFocus /></label> : null}
      <label><span className="tk-label">{newBranch ? "Branch head" : "Name"}</span><input className="tk-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" autoFocus={!newBranch} /></label>
      <label><span className="tk-label">Title</span><input className="tk-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Inventory lead" /></label>
      <button type="submit" className="tk-primary" disabled={!name.trim()}><UserPlus size={14} /> Add</button>
    </form>
  );
}

function EditForm({ org, id, canManage, tickets, onClose, onSave, onMove, onAddUnder, onSeeWork, onRemove }: {
  org: OrgNode[];
  id: string;
  canManage: boolean;
  tickets: Ticket[];
  onClose: () => void;
  onSave: (patch: Partial<Pick<OrgNode, "name" | "title" | "branch" | "admin">>) => boolean;
  onMove: (parentId: string | null) => boolean;
  onAddUnder: () => void;
  onSeeWork: () => void;
  onRemove: () => void;
}) {
  const n = org.find((x) => x.id === id)!;
  const level = levelOf(org, id);
  const [name, setName] = useState(n.name);
  const [title, setTitle] = useState(n.title);
  const [branch, setBranch] = useState(n.branch ?? "");
  // Possible managers: founders and branch heads, never the person themself.
  const managers = org.filter((x) => x.id !== id && levelOf(org, x.id) < MAX_LEVELS);
  const open = tickets.filter((t) => t.assignee === id && t.status !== "done").length;
  const dirty = name !== n.name || title !== n.title || branch !== (n.branch ?? "");

  return (
    <form className="tk-orgform" onSubmit={(e) => { e.preventDefault(); onSave(level === 2 ? { name, title, branch } : { name, title }); }}>
      <header>
        <span className="flex items-center gap-2"><Face person={n} size={30} /><h3>{n.name}</h3></span>
        <button type="button" className="tk-icon-btn" onClick={onClose} aria-label="Close"><X size={15} /></button>
      </header>
      <p className="text-muted">{level === 1 ? "Founder" : level === 2 ? `Heads ${n.branch || "a branch"}` : `In ${branchOf(org, id)?.name ?? "a branch"}`} · {open} open ticket{open === 1 ? "" : "s"}</p>
      <button type="button" className="tk-ghost" onClick={onSeeWork}><ListChecks size={14} /> See their work</button>
      {canManage ? (
        <>
          <label><span className="tk-label">Name</span><input className="tk-input" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label><span className="tk-label">Title</span><input className="tk-input" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          {level === 2 ? <label><span className="tk-label">Branch name</span><input className="tk-input" value={branch} onChange={(e) => setBranch(e.target.value)} /></label> : null}
          {dirty ? <button type="submit" className="tk-primary">Save</button> : null}
          <label>
            <span className="tk-label">Reports to</span>
            <select className="tk-input" value={n.parentId ?? ""} onChange={(e) => onMove(e.target.value || null)}>
              <option value="">Nobody (founder)</option>
              {managers.map((m) => <option key={m.id} value={m.id}>{m.name}{m.branch ? ` · ${m.branch}` : ""}</option>)}
            </select>
          </label>
          {level > 1 ? (
            <label className="tk-check">
              <input type="checkbox" checked={Boolean(n.admin)} onChange={(e) => onSave({ admin: e.target.checked })} />
              <span><b>Admin</b> Can change any ticket and this chart.</span>
            </label>
          ) : <p className="tk-check-note"><Shield size={12} /> Founders can change everything.</p>}
          <div className="tk-orgform-actions">
            {canAddUnder(org, id) ? <button type="button" className="tk-ghost" onClick={onAddUnder}><UserPlus size={14} /> Add under {n.name.split(" ")[0]}</button> : null}
            <button type="button" className="tk-ghost is-danger" onClick={onRemove}><Trash2 size={14} /> Remove</button>
          </div>
        </>
      ) : null}
    </form>
  );
}

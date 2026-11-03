"use client";

import { useState, type FormEvent } from "react";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Hand, Pause, Phone, Play, RotateCcw, Send, ShieldAlert, Sparkles, StickyNote, Undo2, UserCheck } from "lucide-react";
import { BUCKETS, QUEUE, QUEUES, scenario } from "../domain/config";
import { ahtMs, artMs, frtMs } from "../domain/metrics";
import * as svc from "../domain/service";
import { slaState } from "../domain/sla";
import type { HoldReason, Level, Priority, Ticket, TicketEvent } from "../domain/types";
import { CHANNEL_ICON, CHANNEL_NAME, LabelBadge, clock, duration, slaText } from "./bits";
import { useCx } from "./cx-store";

const LEVELS: Array<{ id: Level; name: string }> = [
  { id: "L0", name: "AI" },
  { id: "L1", name: "Khadija" },
  { id: "L2", name: "Department" },
  { id: "L3", name: "CEO" },
];

type Panel = null | "assign" | "l3" | "override" | "hold" | "resolve" | "reopen";

const EVENT_TEXT: Partial<Record<TicketEvent["kind"], (p: Record<string, unknown>) => string>> = {
  created: (p) => `Ticket created from ${CHANNEL_NAME[p.channel as keyof typeof CHANNEL_NAME] ?? "a message"}`,
  classified: (p) => `Classified as ${p.scenarioId}, ${p.priority}, ${p.level} → ${QUEUE.get(String(p.queueId))?.name ?? p.queueId} (${Math.round(Number(p.confidence) * 100)}%)`,
  ownership_taken: () => "Took ownership",
  work_started: () => "Started work",
  work_stopped: () => "Stopped work",
  assigned: (p) => `Assigned to ${QUEUE.get(String(p.queueId))?.name ?? p.queueId}`,
  level_changed: (p) => `Moved ${p.from} → ${p.to}${p.reason ? `: ${p.reason}` : ""}`,
  priority_changed: (p) => `Priority ${p.from} → ${p.to}${p.reason ? ` (${p.reason})` : ""}`,
  override: (p) => `Override saved as a training label: ${JSON.stringify((p.old as object) ?? {})} → ${JSON.stringify((p.new as object) ?? {})}`,
  hold_started: (p) => `On hold: waiting on ${p.reason}`,
  hold_ended: () => "Back from hold",
  agent_replied: (p) => (p.text ? `Replied: "${String(p.text).slice(0, 80)}"` : "Replied"),
  customer_replied: (p) => (p.channel === "missed_call" ? `Missed call again (${p.missedCalls} in 7 days)` : "Customer wrote again"),
  note_added: (p) => `Note: ${String(p.text).slice(0, 90)}`,
  outbound_call_logged: (p) => `Called the customer: ${p.outcome === "connected" ? "connected" : "not connected"}`,
  resolved: (p) => `Resolved · ${p.closeReason}: "${String(p.comment).slice(0, 80)}"`,
  closed: () => "Closed",
  reopened: (p) => `Reopened: ${p.reason}`,
  lead_outcome_set: (p) => `Lead outcome: ${String(p.outcome).replace("_", " ")}`,
};

type Run = (action: string, payload: Record<string, unknown>, msg: string) => Promise<boolean>;

export function TicketDetail({ ticket: t, events }: { ticket: Ticket; events: TicketEvent[] }) {
  const { act, now, actor } = useCx();
  const [panel, setPanel] = useState<Panel>(null);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const s = scenario(t.scenarioId);
  const sla = slaState(t, events, now);
  const open = t.status !== "resolved" && t.status !== "closed";
  const readOnly = actor.role === "viewer";
  const Icon = CHANNEL_ICON[t.channel];
  const sorted = [...events].sort((a, b) => b.at.localeCompare(a.at));
  const thread = [...events].filter((e) => e.kind === "agent_replied" || e.kind === "note_added").sort((a, b) => a.at.localeCompare(b.at));
  const art = artMs(events);
  const frt = frtMs(events);
  const isLead = ["D1", "D6", "D7", "B12", "C8", "B1", "X4", "C1", "C2"].includes(t.scenarioId);

  const run: Run = (action, payload, msg) => act(action, t.id, payload, msg).then((ok) => { if (ok) setPanel(null); return ok; });

  async function send(event: FormEvent) {
    event.preventDefault();
    const ok = await act(mode === "reply" ? "reply" : "note", t.id, { text }, mode === "reply" ? "Reply recorded (the pilot does not send messages)." : "Note added.");
    if (ok) setText("");
  }

  return (
    <article className="cx-ticket">
      <header className="cx-t-head">
        <div className="min-w-0">
          <p className="cx-t-id"><Icon size={14} /> {CHANNEL_NAME[t.channel]} · {t.id} · {clock(t.createdAt)}{t.reopenCount ? ` · reopened ${t.reopenCount}×` : ""}</p>
          <h1>{t.subject}</h1>
        </div>
        <div className="cx-t-state">
          <span className={`cx-status is-${t.status}`}>{t.status.replace("_", " ")}</span>
          <span className={`cx-sla-big is-${sla.state}`}>{slaText(sla)}</span>
        </div>
      </header>

      <ol className="cx-ladder" aria-label="Escalation level">
        {LEVELS.map((l, i) => (
          <li key={l.id} className={`${t.level === l.id ? "is-current" : ""} ${LEVELS.findIndex((x) => x.id === t.level) > i ? "is-past" : ""}`}>
            <b>{l.id}</b><span>{l.name}</span>
          </li>
        ))}
      </ol>

      {t.warnings.length ? (
        <div className="cx-warn">
          <AlertTriangle size={16} />
          <div>{t.warnings.map((w) => <p key={w}>{w}</p>)}</div>
        </div>
      ) : null}

      <section className="cx-class">
        <div className="cx-class-grid">
          <Field k="Bucket" v={`${t.bucket} · ${BUCKETS.find((b) => b.id === t.bucket)?.name}`} />
          <Field k="Scenario" v={`${s.id} · ${s.name}`} />
          <Field k="Type" v={t.type === "actionable" ? "Actionable" : "Informative"} />
          <Field k="Priority" v={<span className="flex items-center gap-2">{t.priority} <LabelBadge label={t.label} /></span>} />
          <Field k="Queue" v={`${QUEUE.get(t.queueId)?.name} · ${t.ownerId ? svc.actorName(t.ownerId) : "no owner"}`} />
          <Field k="Confidence" v={<span className="cx-conf"><span className="cx-conf-track"><i style={{ width: `${Math.round(t.confidence * 100)}%` }} /></span> {Math.round(t.confidence * 100)}%</span>} />
        </div>
        <details className="cx-why" open>
          <summary><Sparkles size={14} /> Why the AI decided this</summary>
          <ul>{t.explanation.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </details>
        <Entities ticket={t} />
      </section>

      {!readOnly ? (
        <section className="cx-actions" aria-label="Actions">
          {open ? (
            <>
              <Btn icon={UserCheck} onClick={() => run("take", {}, "You own this ticket.")}>Take ownership</Btn>
              <Btn icon={Play} onClick={() => run("start", {}, "Work started. Handling time is running.")}>Start work</Btn>
              <Btn icon={Hand} onClick={() => run("stop", {}, "Work stopped.")}>Stop work</Btn>
              <Btn icon={ArrowUpRight} on={panel === "assign"} onClick={() => setPanel(panel === "assign" ? null : "assign")}>Assign</Btn>
              {t.level !== "L1" ? <Btn icon={Undo2} onClick={() => run("back_to_l1", {}, "Sent back to L1.")}>Back to L1</Btn> : null}
              <Btn icon={ShieldAlert} on={panel === "l3"} onClick={() => setPanel(panel === "l3" ? null : "l3")}>Escalate to L3</Btn>
              <Btn icon={Sparkles} on={panel === "override"} onClick={() => setPanel(panel === "override" ? null : "override")}>Change priority</Btn>
              {t.status === "on_hold" ? (
                <Btn icon={Play} onClick={() => run("resume", {}, "Back from hold.")}>Resume</Btn>
              ) : (
                <Btn icon={Pause} on={panel === "hold"} onClick={() => setPanel(panel === "hold" ? null : "hold")}>Hold</Btn>
              )}
              <Btn icon={Phone} onClick={() => run("call", { outcome: "connected" }, "Call logged: connected.")}>Called: connected</Btn>
              <Btn icon={Phone} onClick={() => run("call", { outcome: "not_connected" }, "Call logged: not connected.")}>Called: no answer</Btn>
              <Btn icon={CheckCircle2} primary on={panel === "resolve"} onClick={() => setPanel(panel === "resolve" ? null : "resolve")}>Resolve</Btn>
            </>
          ) : (
            <Btn icon={RotateCcw} on={panel === "reopen"} onClick={() => setPanel(panel === "reopen" ? null : "reopen")}>Reopen</Btn>
          )}
          {isLead ? (
            <span className="cx-lead">
              Lead:
              {(["picked", "not_picked", "pending"] as const).map((o) => (
                <button key={o} type="button" aria-pressed={t.leadOutcome === o} onClick={() => run("lead", { outcome: o }, "Lead outcome saved.")}>{o.replace("_", " ")}</button>
              ))}
            </span>
          ) : null}
        </section>
      ) : <p className="cx-muted cx-readonly">Viewer: read only. Switch role at the top to act.</p>}

      {panel ? <ActionPanel panel={panel} ticket={t} onDone={() => setPanel(null)} run={run} /> : null}

      <section className="cx-thread">
        <h2>Conversation</h2>
        <div className="cx-msg is-customer">
          <span className="cx-msg-who">Customer · {clock(t.createdAt)}</span>
          <p>{t.body || "(no text)"}</p>
        </div>
        {thread.map((e) => (
          <div key={e.id} className={`cx-msg ${e.kind === "note_added" ? "is-note" : "is-agent"}`}>
            <span className="cx-msg-who">{e.kind === "note_added" ? "Internal note" : "Reply"} · {svc.actorName(e.actorId)} · {clock(e.at)}</span>
            <p>{String(e.payload.text ?? "")}</p>
          </div>
        ))}
        {!readOnly ? (
          <form className="cx-compose" onSubmit={send}>
            <div className="cx-compose-tabs">
              <button type="button" aria-pressed={mode === "reply"} onClick={() => setMode("reply")}><Send size={13} /> Reply</button>
              <button type="button" aria-pressed={mode === "note"} onClick={() => setMode("note")}><StickyNote size={13} /> Internal note</button>
            </div>
            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={mode === "reply" ? "Write a reply (recorded only; nothing is sent in the pilot)" : "A note only your team sees"} rows={2} />
            <button type="submit" className="cx-btn is-primary" disabled={!text.trim()}>{mode === "reply" ? "Record reply" : "Add note"}</button>
          </form>
        ) : null}
      </section>

      <section className="cx-log">
        <h2>Activity <span className="cx-muted">FRT {frt != null ? duration(frt) : "—"} · AHT {duration(ahtMs(events, now))} · ART {art ? duration(art.total) : "running"}</span></h2>
        <ol>
          {sorted.map((e) => (
            <li key={e.id}>
              <span className="cx-log-dot" />
              <span className="min-w-0 flex-1"><b>{svc.actorName(e.actorId)}</b> {EVENT_TEXT[e.kind]?.(e.payload) ?? e.kind.replace(/_/g, " ")}</span>
              <time>{clock(e.at)}</time>
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="cx-kv">
      <span>{k}</span>
      <b>{v}</b>
    </div>
  );
}

function Entities({ ticket: t }: { ticket: Ticket }) {
  const e = t.entities;
  const chips: string[] = [
    ...e.orderRefs.map((r) => `Order ${r}`),
    ...(e.pincode ? [`Pin ${e.pincode}${e.pincodeValid === false ? " (invalid)" : e.inBangalore ? " · Bangalore" : " · outside Bangalore"}`] : []),
    ...(e.amountRupees ? [`₹${e.amountRupees.toLocaleString("en-IN")}`] : []),
    ...e.brands.map((b) => b[0].toUpperCase() + b.slice(1)),
    ...(e.city ? [e.city[0].toUpperCase() + e.city.slice(1)] : []),
    ...(e.date ? [e.date] : []),
    ...(e.paymentMethod ? [e.paymentMethod.toUpperCase()] : []),
    ...(t.sentiment.tone !== "neu" ? [t.sentiment.tone === "neg" ? "Upset" : "Happy"] : []),
  ];
  if (!chips.length) return null;
  return <div className="cx-chips">{chips.map((c) => <span key={c}>{c}</span>)}</div>;
}

function Btn({ icon: Icon, children, onClick, primary, on }: { icon: typeof Play; children: React.ReactNode; onClick: () => void; primary?: boolean; on?: boolean }) {
  return (
    <button type="button" className={`cx-btn ${primary ? "is-primary" : ""} ${on ? "is-on" : ""}`} onClick={onClick}>
      <Icon size={14} /> {children}
    </button>
  );
}

function ActionPanel({ panel, ticket: t, onDone, run }: { panel: Exclude<Panel, null>; ticket: Ticket; onDone: () => void; run: Run }) {
  const [queue, setQueue] = useState(t.queueId);
  const [reason, setReason] = useState("");
  const [priority, setPriority] = useState<Priority>(t.priority);
  const [label, setLabel] = useState(t.label);
  const [holdReason, setHoldReason] = useState<HoldReason>("brand");
  const [closeReason, setCloseReason] = useState("");
  const [type, setType] = useState(t.type);

  return (
    <form
      className="cx-panel"
      onSubmit={(e) => {
        e.preventDefault();
        if (panel === "assign") void run("assign", { queueId: queue }, `Assigned to ${QUEUE.get(queue)?.name}.`);
        if (panel === "l3") void run("escalate", { reason }, "Escalated to the CEO.");
        if (panel === "override") void run("override", { priority, label }, "Saved. Your change is kept as a training label.");
        if (panel === "hold") void run("hold", { reason: holdReason }, holdReason === "brand" ? "On hold. The SLA clock is paused." : "On hold.");
        if (panel === "resolve") void run("resolve", { comment: reason, closeReason, resolutionType: type }, "Resolved and closed.");
        if (panel === "reopen") void run("reopen", { reason }, "Reopened.");
      }}
    >
      {panel === "assign" ? (
        <label className="cx-field"><span>Send to queue</span>
          <select value={queue} onChange={(e) => setQueue(e.target.value)}>{QUEUES.map((q) => <option key={q.id} value={q.id}>{q.name} ({q.level})</option>)}</select>
        </label>
      ) : null}
      {panel === "override" ? (
        <div className="flex gap-3">
          <label className="cx-field"><span>Priority</span><select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>{["P0", "P1", "P2", "P3"].map((p) => <option key={p}>{p}</option>)}</select></label>
          <label className="cx-field"><span>Label</span><select value={label} onChange={(e) => setLabel(e.target.value as Ticket["label"])}>{["VIP", "High", "Medium", "Low"].map((p) => <option key={p}>{p}</option>)}</select></label>
        </div>
      ) : null}
      {panel === "hold" ? (
        <label className="cx-field"><span>Waiting on</span>
          <select value={holdReason} onChange={(e) => setHoldReason(e.target.value as HoldReason)}>
            <option value="brand">Brand or third party (SLA pauses)</option>
            <option value="customer">Customer</option>
            <option value="internal">Internal team</option>
          </select>
        </label>
      ) : null}
      {panel === "resolve" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="cx-field"><span>Close reason</span>
            <select value={closeReason} onChange={(e) => setCloseReason(e.target.value)} required>
              <option value="">Pick one</option>
              {svc.CLOSE_REASONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
          <label className="cx-field"><span>Resolution</span>
            <select value={type} onChange={(e) => setType(e.target.value as Ticket["type"])}>
              <option value="informative">Informative: information given</option>
              <option value="actionable">Actionable: action done</option>
            </select>
          </label>
        </div>
      ) : null}
      {panel === "l3" || panel === "resolve" || panel === "reopen" ? (
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} required placeholder={panel === "l3" ? "Why does this need the CEO?" : panel === "resolve" ? "Closing comment: what was done for the customer (required)" : "Why reopen?"} />
      ) : null}
      <span className="flex gap-2">
        <button type="submit" className="cx-btn is-primary">Save</button>
        <button type="button" className="cx-btn" onClick={onDone}>Cancel</button>
      </span>
    </form>
  );
}

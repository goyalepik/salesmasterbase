"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, RotateCcw, Sparkles, X } from "lucide-react";
import { askImsAction } from "@/app/actions/ims";
import { parseMarkdown, type Block, type Inline } from "@/lib/ai/markdown";

type Turn = { role: "user" | "assistant"; content: string };
const SUGGESTIONS = ["What's running low?", "How much money is in robot vacuums?", "What came in this week?", "Which products aren't moving?", "What's late from vendors?"];

function inline(items: Inline[]): ReactNode[] {
  return items.map((it, i) => it.type === "bold" ? <strong key={i}>{inline(it.children)}</strong> : it.type === "em" ? <em key={i}>{inline(it.children)}</em> : it.type === "code" ? <code key={i}>{it.text}</code> : <span key={i}>{it.text}</span>);
}
function blocks(list: Block[]): ReactNode[] {
  return list.map((b, i) => {
    if (b.type === "heading") return <p key={i}><strong>{inline(b.content)}</strong></p>;
    if (b.type === "paragraph") return <p key={i}>{inline(b.content)}</p>;
    if (b.type === "list") return b.ordered ? <ol key={i}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ol> : <ul key={i}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>;
    if (b.type === "table") return <div key={i} style={{ overflowX: "auto" }}><table><thead><tr>{b.header.map((h, j) => <th key={j}>{inline(h)}</th>)}</tr></thead><tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{inline(c)}</td>)}</tr>)}</tbody></table></div>;
    if (b.type === "pre") return <p key={i}><code>{b.text}</code></p>;
    return null;
  });
}

function useChat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    const next = [...turns, { role: "user" as const, content: question }];
    setTurns(next);
    setBusy(true);
    try {
      const res = await askImsAction(next);
      setTurns([...next, { role: "assistant", content: res.ok ? res.answer : res.message }]);
    } catch {
      setTurns([...next, { role: "assistant", content: "Couldn't reach the server. Try again." }]);
    } finally {
      setBusy(false);
    }
  }
  return { turns, busy, ask, reset: () => setTurns([]) };
}

function Thread({ turns, busy }: { turns: Turn[]; busy: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [turns, busy]);
  return (
    <>
      {turns.map((t, i) => <div key={i} className={`ims-msg ${t.role === "user" ? "is-user" : "is-bot"}`}>{t.role === "user" ? t.content : blocks(parseMarkdown(t.content))}</div>)}
      {busy ? <div className="ims-msg is-bot"><span className="ims-typing" aria-label="Thinking"><i /><i /><i /></span></div> : null}
      <div ref={end} />
    </>
  );
}

function Composer({ busy, onAsk, autoFocus = false, placeholder }: { busy: boolean; onAsk: (q: string) => void; autoFocus?: boolean; placeholder: string }) {
  const [text, setText] = useState("");
  const send = () => { if (text.trim() && !busy) { onAsk(text); setText(""); } };
  return (
    <form className="ims-ask-row" onSubmit={(e) => { e.preventDefault(); send(); }}>
      <textarea autoFocus={autoFocus} rows={1} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder={placeholder} aria-label="Your question" />
      <button type="submit" disabled={busy || !text.trim()} aria-label="Ask"><ArrowUp size={19} /></button>
    </form>
  );
}

/** The chat at the top of the Overview: ask in plain words, answers from the live sheets. */
export function AskHero() {
  const { turns, busy, ask, reset } = useChat();
  return (
    <section className="ims-hero" aria-label="Ask about inventory">
      <div className="ims-hero-head">
        <span className="ims-hero-icon"><Sparkles size={18} /></span>
        <div>
          <h2>Ask anything about your inventory</h2>
          <p>Stock, serials, what came in, what&apos;s coming, and the money in stock. Answers come live from the team sheets.</p>
        </div>
        {turns.length ? <button type="button" className="ims-icon-btn" onClick={reset} aria-label="New chat" style={{ marginLeft: "auto" }}><RotateCcw size={15} /></button> : null}
      </div>
      {turns.length ? <div className="ims-hero-thread" aria-live="polite"><Thread turns={turns} busy={busy} /></div> : null}
      <Composer busy={busy} onAsk={(q) => void ask(q)} placeholder="e.g. How many Dreame L50 Ultra do we have, and is more coming?" />
      {!turns.length ? <div className="ims-chips">{SUGGESTIONS.map((s) => <button key={s} type="button" onClick={() => void ask(s)}>{s}</button>)}</div> : null}
    </section>
  );
}

const noop = () => () => {};

/** "Ask" in the top bar: the same assistant in a side sheet, on every page (⌘K). Rendered at page level. */
export function AskPanel() {
  const [open, setOpen] = useState(false);
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const { turns, busy, ask, reset } = useChat();
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); } if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  const sheet = (
    <div className="ims ims-ask-layer">
      <div className="ims-ask-scrim" onClick={() => setOpen(false)} aria-hidden="true" />
      <aside className="ims-ask-panel" role="dialog" aria-label="Ask about inventory">
        <div className="ims-ask-head">
          <strong><Sparkles size={16} style={{ color: "var(--accent)" }} /> Ask about inventory</strong>
          <div style={{ display: "flex", gap: 6 }}>
            {turns.length ? <button type="button" className="ims-icon-btn" onClick={reset} aria-label="New chat"><RotateCcw size={15} /></button> : null}
            <button type="button" className="ims-icon-btn" onClick={() => setOpen(false)} aria-label="Close"><X size={16} /></button>
          </div>
        </div>
        <div className="ims-ask-body" aria-live="polite">
          {!turns.length ? <p className="ims-note">Answers come live from the team sheets: stock, serials, what came in, what&apos;s coming, and the money in stock.</p> : null}
          <Thread turns={turns} busy={busy} />
        </div>
        <div className="ims-ask-foot">
          {!turns.length ? <div className="ims-chips">{SUGGESTIONS.map((s) => <button key={s} type="button" onClick={() => void ask(s)}>{s}</button>)}</div> : null}
          <Composer busy={busy} onAsk={(q) => void ask(q)} autoFocus placeholder="Ask anything about stock…" />
        </div>
      </aside>
    </div>
  );
  return (
    <>
      <button type="button" className="ims-pillbtn is-accent" onClick={() => setOpen(true)} title="Ask (⌘K)"><Sparkles size={15} /><span className="ims-hide-sm">Ask</span></button>
      {open && mounted ? createPortal(sheet, document.body) : null}
    </>
  );
}

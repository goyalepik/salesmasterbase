"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, RotateCcw, Sparkles, X } from "lucide-react";
import { askHqAction } from "@/app/actions/hq";
import { parseMarkdown, type Block, type Inline } from "@/lib/ai/markdown";

type Turn = { role: "user" | "assistant"; content: string };
const CHIPS = ["What's our NM% this month?", "Which category makes the most margin?", "What is our CAC and ROAS?", "Who are the top 5 CDEs?", "How many orders are not delivered yet?"];

const inl = (items: Inline[]): ReactNode[] => items.map((it, i) => it.type === "bold" ? <strong key={i}>{inl(it.children)}</strong> : it.type === "em" ? <em key={i}>{inl(it.children)}</em> : it.type === "code" ? <code key={i}>{it.text}</code> : <span key={i}>{it.text}</span>);
const blk = (l: Block[]): ReactNode[] => l.map((b, i) => b.type === "paragraph" ? <p key={i}>{inl(b.content)}</p> : b.type === "heading" ? <p key={i}><strong>{inl(b.content)}</strong></p> : b.type === "list" ? (b.ordered ? <ol key={i}>{b.items.map((x, j) => <li key={j}>{inl(x)}</li>)}</ol> : <ul key={i}>{b.items.map((x, j) => <li key={j}>{inl(x)}</li>)}</ul>) : b.type === "table" ? <div key={i} style={{ overflowX: "auto" }}><table><thead><tr>{b.header.map((h, j) => <th key={j}>{inl(h)}</th>)}</tr></thead><tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{inl(c)}</td>)}</tr>)}</tbody></table></div> : null);

/** Header button (and ⌘K) that slides the chat in from the right. */
export function AskButton({ range }: { range: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  return (
    <>
      <button type="button" className="hq-ask-btn" onClick={() => setOpen(true)} aria-label="Ask HQ"><Sparkles size={15} />Ask anything<kbd>⌘K</kbd></button>
      {open && typeof document !== "undefined" ? createPortal(
        <div className="hq hq-layer">
          <button type="button" className="hq-scrim" aria-label="Close" onClick={() => setOpen(false)} />
          <aside className="hq-drawer" role="dialog" aria-label="Ask HQ">
            <button type="button" className="hq-circle hq-drawer-x" onClick={() => setOpen(false)} aria-label="Close"><X size={17} /></button>
            <HqAsk range={range} />
          </aside>
        </div>, document.body) : null}
    </>
  );
}

/** "Hey, need help? Just ask me anything!": answers from the live numbers of the chosen period. */
export function HqAsk({ range }: { range: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [turns, busy]);
  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    const next = [...turns, { role: "user" as const, content: question }];
    setTurns(next); setText(""); setBusy(true);
    try { const r = await askHqAction(next, range); setTurns([...next, { role: "assistant", content: r.answer }]); }
    catch { setTurns([...next, { role: "assistant", content: "Couldn't reach the server. Try again." }]); }
    finally { setBusy(false); }
  }
  return (
    <section className="hq-ask" aria-label="Ask">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <h2>Hey, need help? 👋<span>Just ask me anything!</span></h2>
        {turns.length ? <button type="button" className="hq-circle" style={{ background: "var(--soft)" }} onClick={() => setTurns([])} aria-label="New chat"><RotateCcw size={16} /></button> : null}
      </div>
      {turns.length ? (
        <div className="hq-thread" aria-live="polite">
          {turns.map((t, i) => <div key={i} className={`hq-msg ${t.role === "user" ? "is-user" : "is-bot"}`}>{t.role === "user" ? t.content : blk(parseMarkdown(t.content))}</div>)}
          {busy ? <div className="hq-msg is-bot"><span className="hq-typing"><i /><i /><i /></span></div> : null}
          <div ref={end} />
        </div>
      ) : null}
      <form className="hq-ask-row" onSubmit={(e) => { e.preventDefault(); void ask(text); }}>
        <textarea rows={1} autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(text); } }} placeholder="Ask about sales, margin, CAC, CDEs, delivery…" aria-label="Your question" />
        <button type="submit" disabled={busy || !text.trim()} aria-label="Ask"><ArrowUp size={20} /></button>
      </form>
      {!turns.length ? <div className="hq-chips">{CHIPS.map((c) => <button key={c} type="button" onClick={() => void ask(c)}>{c}</button>)}</div> : null}
    </section>
  );
}

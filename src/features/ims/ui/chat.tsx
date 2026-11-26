"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, RotateCcw, Sparkles } from "lucide-react";
import { askImsAction } from "@/app/actions/ims";
import { parseMarkdown, type Block, type Inline } from "@/lib/ai/markdown";

type Turn = { role: "user" | "assistant"; content: string };

function inline(items: Inline[]): ReactNode[] {
  return items.map((it, i) => {
    if (it.type === "bold") return <strong key={i}>{inline(it.children)}</strong>;
    if (it.type === "em") return <em key={i}>{inline(it.children)}</em>;
    if (it.type === "code") return <code key={i}>{it.text}</code>;
    return <span key={i}>{it.text}</span>;
  });
}

function blocks(list: Block[]): ReactNode[] {
  return list.map((b, i) => {
    switch (b.type) {
      case "heading":
        return <p key={i}><strong>{inline(b.content)}</strong></p>;
      case "paragraph":
        return <p key={i}>{inline(b.content)}</p>;
      case "list":
        return b.ordered ? <ol key={i}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ol> : <ul key={i}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>;
      case "table":
        return (
          <div key={i} style={{ overflowX: "auto" }}>
            <table>
              <thead><tr>{b.header.map((h, j) => <th key={j}>{inline(h)}</th>)}</tr></thead>
              <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{inline(c)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        );
      case "pre":
        return <p key={i}><code>{b.text}</code></p>;
      default:
        return null;
    }
  });
}

/** The opening of the IMS: ask anything about stock in plain words; answers come from the live sheets. */
export function ImsChat({ suggestions }: { suggestions: string[] }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [turns, busy]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const next = [...turns, { role: "user" as const, content: q }];
    setTurns(next);
    setText("");
    setBusy(true);
    try {
      const res = await askImsAction(next);
      setTurns([...next, { role: "assistant", content: res.ok ? res.answer : res.message }]);
    } catch {
      setTurns([...next, { role: "assistant", content: "Couldn't reach the server. Check the connection and try again." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ims-card ims-ask" aria-label="Ask about inventory">
      {turns.length ? (
        <div className="ims-thread" aria-live="polite">
          {turns.map((t, i) => (
            <div key={i} className={`ims-msg ${t.role === "user" ? "is-user" : "is-bot"}`}>
              {t.role === "user" ? t.content : blocks(parseMarkdown(t.content))}
            </div>
          ))}
          {busy ? <div className="ims-msg is-bot"><span className="ims-typing" aria-label="Thinking"><i /><i /><i /></span></div> : null}
          <div ref={end} />
        </div>
      ) : null}
      <form
        className="ims-ask-row"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(text);
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(text);
            }
          }}
          rows={1}
          placeholder="Ask anything: how many L50 Ultra do we have? What's late from Dreame? Where is serial R5057…?"
          aria-label="Ask about inventory"
        />
        <button type="submit" className="ims-ask-send" disabled={busy || !text.trim()} aria-label="Ask"><ArrowUp size={20} /></button>
      </form>
      <div className="ims-chips">
        {!turns.length ? <span className="inline-flex items-center gap-1 text-[12.5px] text-[var(--ims-muted)]"><Sparkles size={14} /> Try:</span> : null}
        {turns.length ? (
          <button type="button" onClick={() => setTurns([])}><RotateCcw size={12} className="mr-1 inline" />New chat</button>
        ) : (
          suggestions.map((s) => <button key={s} type="button" onClick={() => void ask(s)}>{s}</button>)
        )}
      </div>
    </section>
  );
}

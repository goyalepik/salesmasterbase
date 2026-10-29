"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/ui";

type Answer = {
  available: boolean;
  usedModel: boolean;
  text: string;
  sources: Array<{ id: string; href: string; label: string }>;
  rangeLabel: string;
  error: string | null;
};

type Turn = { question: string; answer: Answer | null; pending: boolean; failed: string | null };

const SUGGESTIONS = [
  "What payment updates arrived today?",
  "Show messages that need review.",
  "Who should get incentive for the last 5 days?",
  "Summarise this week's activity.",
  "Which messages have missing amounts?",
];

export function AssistantScreen({ initialQuestion, openaiConfigured }: { initialQuestion: string; openaiConfigured: boolean }) {
  const opening = initialQuestion.trim();
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>(opening.length >= 2 ? [{ question: opening, answer: null, pending: true, failed: null }] : []);
  const started = useRef(false);

  async function ask(question: string) {
    const trimmed = question.trim();
    if (trimmed.length < 2) return;
    setTurns((current) => [...current, { question: trimmed, answer: null, pending: true, failed: null }]);
    setDraft("");
    await complete(trimmed, false);
  }

  async function complete(question: string, replaceOpening: boolean) {
    try {
      const response = await fetch("/api/ai/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const payload = (await response.json()) as Answer & { error?: string };
      setTurns((current) => current.map((turn, index) => {
        const target = replaceOpening ? index === 0 : index === current.length - 1;
        if (!target) return turn;
        if (!response.ok) return { ...turn, pending: false, failed: payload.error || "The question could not be answered." };
        return { ...turn, pending: false, answer: payload };
      }));
    } catch {
      setTurns((current) => current.map((turn, index) => {
        const target = replaceOpening ? index === 0 : index === current.length - 1;
        if (!target) return turn;
        return { ...turn, pending: false, failed: "The request did not finish." };
      }));
    }
  }

  useEffect(() => {
    if (started.current || opening.length < 2) return;
    started.current = true;
    void complete(opening, true);
  }, [opening]);

  return (
    <section className="mx-auto flex min-h-[calc(100vh-7rem)] max-w-3xl flex-col">
      <header className="mb-5">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Assistant</h1>
        <p className="mt-1 max-w-2xl text-[13px] text-muted">A short answer from stored records. If a name, customer, or amount is missing, the reply says so.</p>
        <p className="mt-2 text-[12px] text-muted">{openaiConfigured ? "OpenAI is configured. This reply stays on the stored counts, so it does not invent a payout." : "OpenAI is not configured. The reply still uses the stored counts."}</p>
      </header>
      <div className="mb-4 flex flex-wrap gap-2">
        {SUGGESTIONS.map((prompt) => (
          <button key={prompt} type="button" className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-left text-[12px] text-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]" onClick={() => void ask(prompt)}>{prompt}</button>
        ))}
      </div>
      <div className="flex-1 space-y-3">
        {turns.length === 0 ? <EmptyState title="Ask a question" detail="Use the box below or one of the suggested questions. Answers cite inbox and exception records." /> : null}
        {turns.map((turn, index) => (
          <article key={`${turn.question}-${index}`} className="panel p-4">
            <p className="text-[13px] font-medium">{turn.question}</p>
            {turn.pending ? <p className="mt-3 text-[13px] text-muted">Looking up records…</p> : null}
            {turn.failed ? (
              <div className="mt-3">
                <p className="text-[13px] text-bad">{turn.failed}</p>
                <button type="button" className="mt-2 text-[13px] text-info" onClick={() => void ask(turn.question)}>Retry</button>
              </div>
            ) : null}
            {turn.answer ? (
              <div className="mt-3 space-y-3 text-[13px] leading-6">
                {turn.answer.error ? <p className="text-warn">{turn.answer.error}</p> : null}
                <p className="whitespace-pre-wrap">{turn.answer.text}</p>
                {turn.answer.sources.length > 0 ? (
                  <ul className="space-y-1 text-[12px]">
                    {turn.answer.sources.map((source) => <li key={source.id}><Link className="text-info" href={source.href}>{source.label}</Link></li>)}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </article>
        ))}
      </div>
      <form className="glass-panel sticky bottom-3 mt-4 flex gap-2 p-2" onSubmit={(event) => { event.preventDefault(); void ask(draft); }}>
        <label className="sr-only" htmlFor="assistant-question">Question</label>
        <input id="assistant-question" value={draft} onChange={(event) => setDraft(event.target.value)} className="field h-11 min-w-0 flex-1 px-3" placeholder="Ask about stored messages" />
        <button type="submit" className="h-11 rounded-[10px] bg-accent px-3 text-[13px] font-medium text-white">Send</button>
      </form>
    </section>
  );
}

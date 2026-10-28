"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/ui";

type Answer = {
  available: boolean;
  usedModel: boolean;
  text: string;
  sources: Array<{ id: string; href: string; label: string }>;
  counts: Record<string, number>;
  rangeLabel: string;
  error: string | null;
};

type Turn = { question: string; answer: Answer | null; pending: boolean; failed: string | null };

const SUGGESTIONS = [
  "What payment updates arrived today?",
  "Show messages that need review.",
  "Which salesperson has the most Slack-attributed messages?",
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
        <p className="mt-1 max-w-2xl text-[13px] text-muted">Questions are answered from stored records. The model only summarises those results. It cannot run SQL or change data.</p>
        <p className="mt-2 text-[12px] text-muted">{openaiConfigured ? "An API key is present. A successful model call is confirmed only after a response is marked as model-written." : "OpenAI is not configured. Counts below still come from the database, and the model is not called."}</p>
      </header>
      <div className="mb-4 flex flex-wrap gap-2">
        {SUGGESTIONS.map((prompt) => (
          <button key={prompt} type="button" className="rounded-[9px] border border-line px-2.5 py-1.5 text-left text-[12px] text-muted" onClick={() => void ask(prompt)}>{prompt}</button>
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
                <p>{turn.answer.usedModel ? "Model summary, limited to the counts below." : "Database summary. The model did not supply this wording."}</p>
                {turn.answer.error ? <p className="text-warn">{turn.answer.error}</p> : null}
                <p className="whitespace-pre-wrap">{turn.answer.text}</p>
                <p className="text-[12px] text-muted">{turn.answer.rangeLabel}</p>
                <ul className="space-y-1 text-[12px]">
                  {Object.entries(turn.answer.counts).map(([label, value]) => <li key={label} className="tabular-nums">{label}: {value}</li>)}
                </ul>
                {turn.answer.sources.length > 0 ? (
                  <ul className="space-y-1">
                    {turn.answer.sources.map((source) => <li key={source.id}><Link className="text-info" href={source.href}>{source.label}</Link></li>)}
                  </ul>
                ) : <p className="text-muted">No source rows matched.</p>}
              </div>
            ) : null}
          </article>
        ))}
      </div>
      <form className="glass-panel sticky bottom-3 mt-4 flex gap-2 p-2" onSubmit={(event) => { event.preventDefault(); void ask(draft); }}>
        <label className="sr-only" htmlFor="assistant-question">Question</label>
        <input id="assistant-question" value={draft} onChange={(event) => setDraft(event.target.value)} className="h-11 min-w-0 flex-1 rounded-[10px] border border-line bg-[#141518] px-3" placeholder="Ask about stored messages" />
        <button type="submit" className="h-11 rounded-[10px] bg-accent px-3 text-[13px] font-medium text-white">Send</button>
      </form>
    </section>
  );
}

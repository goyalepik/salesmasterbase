"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { EmptyState } from "@/components/ui";
import { parseMarkdown, type Block, type Inline } from "@/lib/ai/markdown";

type Step = { tool: string; input: Record<string, unknown>; summary: string; ok: boolean };
export type AssistantResult = { answer: string; steps: Step[]; model: string; provider: "anthropic" | "openai" | "rules"; notice: string | null };
type Turn = { id: number; question: string; result: AssistantResult | null; pending: boolean; failed: string | null };
type Status = { provider: "anthropic" | "openai" | "rules"; model: string };

const SUGGESTIONS = [
  "What's stuck right now?",
  "Orders waiting for stock and when they arrive",
  "Today's sales by hub",
  "How many DREAME L50s Pro Ultra are free?",
  "COD to collect today",
  "Which POC sold most in the last 5 days?",
];

const TOOL_LABELS: Record<string, string> = {
  search_orders: "Searched orders",
  get_order: "Opened order",
  pipeline_summary: "Read the pipeline",
  sales_summary: "Totalled sales",
  stock_lookup: "Checked stock",
  low_stock: "Checked low stock",
  open_procurement: "Read open procurement",
  open_purchase_orders: "Read open POs",
  dispatch_queue: "Read the dispatch queue",
  installations_due: "Read installations",
  stuck_orders: "Looked for stuck orders",
  recent_activity: "Read recent activity",
  search_slack_messages: "Searched Slack messages",
};

// ── Markdown rendering (no HTML injection) ───────────────────────────────────

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return <Fragment key={index}>{node.text}</Fragment>;
      case "bold":
        return <strong key={index} className="font-semibold text-ink">{renderInline(node.children)}</strong>;
      case "em":
        return <em key={index}>{renderInline(node.children)}</em>;
      case "code":
        return <code key={index} className="rounded bg-white/10 px-1 py-0.5 text-[12px]">{node.text}</code>;
      case "order":
        return <Link key={index} href={node.href} className="text-info underline-offset-2 hover:underline">{node.text}</Link>;
    }
  });
}

function renderBlock(block: Block, index: number): ReactNode {
  switch (block.type) {
    case "heading":
      return <p key={index} className="pt-1 text-[13px] font-semibold text-ink">{renderInline(block.content)}</p>;
    case "paragraph":
      return <p key={index}>{renderInline(block.content)}</p>;
    case "rule":
      return <hr key={index} className="border-line" />;
    case "pre":
      return <pre key={index} className="overflow-x-auto rounded-[10px] bg-white/5 p-3 text-[12px]">{block.text}</pre>;
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag key={index} className={`${block.ordered ? "list-decimal" : "list-disc"} space-y-1 pl-5 marker:text-faint`}>
          {block.items.map((item, i) => <li key={i}>{renderInline(item)}</li>)}
        </Tag>
      );
    }
    case "table":
      return (
        <div key={index} className="overflow-x-auto rounded-[10px] border border-line">
          <table className="w-full min-w-max border-collapse text-left text-[12px] tabular-nums">
            <thead className="bg-white/5 text-muted">
              <tr>{block.header.map((cell, i) => <th key={i} className="px-2.5 py-1.5 font-medium">{renderInline(cell)}</th>)}</tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-t border-line">
                  {row.map((cell, c) => <td key={c} className="px-2.5 py-1.5 align-top">{renderInline(cell)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function Markdown({ text }: { text: string }) {
  return <div className="space-y-2.5 text-[13px] leading-6">{parseMarkdown(text).map(renderBlock)}</div>;
}

function describeInput(input: Record<string, unknown>): string {
  const parts = Object.entries(input)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  return parts.length ? parts.join(", ") : "no filters";
}

export function StepList({ steps, provider, model }: { steps: Step[]; provider: Status["provider"]; model: string }) {
  if (!steps.length) return null;
  return (
    <details className="group rounded-[10px] border border-line px-3 py-2 text-[12px] text-muted">
      <summary className="cursor-pointer select-none list-none">
        <span className="text-info">How I got this</span> · {steps.length} lookup{steps.length === 1 ? "" : "s"} · {provider === "rules" ? "fixed report" : model}
      </summary>
      <ol className="mt-2 space-y-1.5">
        {steps.map((step, i) => (
          <li key={i} className="leading-5">
            <span className={step.ok ? "text-ink" : "text-bad"}>{TOOL_LABELS[step.tool] ?? step.tool}</span>
            <span className="text-faint"> ({describeInput(step.input)})</span>
            <span> — {step.summary}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

function historyOf(turns: Turn[]): Array<{ role: "user" | "assistant"; content: string }> {
  return turns
    .filter((t) => t.result && !t.pending)
    .flatMap((t) => [
      { role: "user" as const, content: t.question },
      { role: "assistant" as const, content: t.result!.answer },
    ]);
}

async function askApi(question: string, history: ReturnType<typeof historyOf>): Promise<{ ok: true; result: AssistantResult } | { ok: false; error: string }> {
  try {
    const response = await fetch("/api/ai/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, history }),
    });
    const payload = (await response.json().catch(() => null)) as (AssistantResult & { error?: string }) | null;
    if (!response.ok || !payload) return { ok: false, error: payload?.error || `The question could not be answered (HTTP ${response.status}).` };
    return { ok: true, result: payload };
  } catch {
    return { ok: false, error: "The request did not finish. Check your connection and retry." };
  }
}

export function AssistantScreen({ initialQuestion, status }: { initialQuestion: string; status: Status }) {
  const opening = initialQuestion.trim();
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>(opening.length >= 2 ? [{ id: 1, question: opening, result: null, pending: true, failed: null }] : []);
  const nextId = useRef(2);
  const started = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);
  const busy = turns.some((t) => t.pending);

  const run = useCallback(async (id: number, question: string, history: ReturnType<typeof historyOf>) => {
    const reply = await askApi(question, history);
    setTurns((current) =>
      current.map((turn) => (turn.id !== id ? turn : reply.ok ? { ...turn, pending: false, result: reply.result, failed: null } : { ...turn, pending: false, failed: reply.error })),
    );
  }, []);

  function ask(question: string) {
    const trimmed = question.trim();
    if (trimmed.length < 2 || busy) return;
    const id = nextId.current++;
    const history = historyOf(turns);
    setTurns((current) => [...current, { id, question: trimmed, result: null, pending: true, failed: null }]);
    setDraft("");
    void run(id, trimmed, history);
  }

  function retry(turn: Turn) {
    if (busy) return;
    const history = historyOf(turns.filter((t) => t.id < turn.id));
    setTurns((current) => current.map((t) => (t.id === turn.id ? { ...t, pending: true, failed: null } : t)));
    void run(turn.id, turn.question, history);
  }

  useEffect(() => {
    if (started.current || opening.length < 2) return;
    started.current = true;
    void run(1, opening, []);
  }, [opening, run]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length]);

  const statusLine =
    status.provider === "anthropic"
      ? `Claude (${status.model}) answers by querying orders, stock, POs and deliveries. Every number comes from a lookup you can inspect.`
      : status.provider === "openai"
        ? `OpenAI (${status.model}) answers by querying orders, stock, POs and deliveries. Set ANTHROPIC_API_KEY to use Claude.`
        : "No AI key is configured. You get fixed reports from the same lookups. Set ANTHROPIC_API_KEY for written analysis.";

  return (
    <section className="mx-auto flex min-h-[calc(100vh-7rem)] max-w-3xl flex-col">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Assistant</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-muted">Ask about orders, stock, procurement, deliveries, COD and sales. Answers cite order IDs and say what data is missing.</p>
          <p className="mt-2 text-[12px] text-faint">{statusLine}</p>
        </div>
        {turns.length > 0 ? (
          <button type="button" disabled={busy} className="shrink-0 rounded-full border border-white/15 px-3 py-1.5 text-[12px] text-muted disabled:opacity-50" onClick={() => setTurns([])}>
            New chat
          </button>
        ) : null}
      </header>

      <div className="flex-1 space-y-4">
        {turns.length === 0 ? <EmptyState title="Ask a question" detail="Type below or pick a suggestion. Follow-up questions keep the conversation's context." /> : null}
        {turns.map((turn) => (
          <article key={turn.id} className="space-y-2">
            <div className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap rounded-[14px] bg-accent-soft px-3.5 py-2 text-[13px]">{turn.question}</p>
            </div>
            <div className="panel space-y-3 p-4">
              {turn.pending ? <p className="animate-pulse text-[13px] text-muted">Looking it up…</p> : null}
              {turn.failed ? (
                <div>
                  <p className="text-[13px] text-bad">{turn.failed}</p>
                  <button type="button" disabled={busy} className="mt-2 text-[13px] text-info disabled:opacity-50" onClick={() => retry(turn)}>Retry</button>
                </div>
              ) : null}
              {turn.result ? (
                <>
                  {turn.result.notice ? <p className="text-[12px] text-warn">{turn.result.notice}</p> : null}
                  <Markdown text={turn.result.answer} />
                  <StepList steps={turn.result.steps} provider={turn.result.provider} model={turn.result.model} />
                </>
              ) : null}
            </div>
          </article>
        ))}
        <div ref={bottom} />
      </div>

      <div className="sticky bottom-3 mt-4 space-y-2">
        {turns.length === 0 || !busy ? (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((prompt) => (
              <button key={prompt} type="button" disabled={busy} className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-left text-[12px] text-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] disabled:opacity-50" onClick={() => ask(prompt)}>
                {prompt}
              </button>
            ))}
          </div>
        ) : null}
        <form className="glass-panel flex items-end gap-2 p-2" onSubmit={(event) => { event.preventDefault(); ask(draft); }}>
          <label className="sr-only" htmlFor="assistant-question">Question</label>
          <textarea
            id="assistant-question"
            rows={1}
            value={draft}
            maxLength={2000}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                ask(draft);
              }
            }}
            className="field max-h-40 min-h-11 min-w-0 flex-1 resize-y px-3 py-2.5"
            placeholder={turns.length ? "Ask a follow-up" : "Ask about orders, stock, deliveries or sales"}
          />
          <button type="submit" disabled={busy || draft.trim().length < 2} className="h-11 rounded-[10px] bg-accent px-4 text-[13px] font-medium text-white disabled:opacity-50">
            {busy ? "Working…" : "Send"}
          </button>
        </form>
      </div>
    </section>
  );
}

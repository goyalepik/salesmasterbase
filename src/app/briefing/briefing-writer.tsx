"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Markdown, StepList, type AssistantResult } from "@/components/assistant-screen";

type Payload = AssistantResult & { cachedAt: string | null };

export function BriefingWriter({ writer }: { writer: string }) {
  const [result, setResult] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(true);
  const started = useRef(false);

  const load = useCallback(async (fresh: boolean) => {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/ai/briefing${fresh ? "?fresh=1" : ""}`, { method: "POST" });
      const payload = (await response.json().catch(() => null)) as (Payload & { error?: string }) | null;
      if (!response.ok || !payload) setError(payload?.error || `The briefing could not be written (HTTP ${response.status}).`);
      else setResult(payload);
    } catch {
      setError("The request did not finish. Retry in a moment.");
    } finally {
      setPending(false);
    }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void load(false);
  }, [load]);

  return (
    <div className="panel-strong mt-6 space-y-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-semibold">Founder briefing</h2>
        <button type="button" disabled={pending} className="rounded-full border border-white/15 px-3 py-1 text-[12px] text-muted disabled:opacity-50" onClick={() => void load(true)}>
          {pending ? "Writing…" : "Refresh"}
        </button>
      </div>
      <p className="text-[12px] text-faint">{writer}</p>
      {pending && !result ? <p className="animate-pulse text-[13px] text-muted">Reading orders, stock, deliveries and sales…</p> : null}
      {error ? <p className="text-[13px] text-bad">{error}</p> : null}
      {result ? (
        <>
          {result.notice ? <p className="text-[12px] text-warn">{result.notice}</p> : null}
          {result.cachedAt ? <p className="text-[12px] text-faint">Written at {new Date(result.cachedAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })} IST. Refresh for a new one.</p> : null}
          <Markdown text={result.answer} />
          <StepList steps={result.steps} provider={result.provider} model={result.model} />
        </>
      ) : null}
    </div>
  );
}

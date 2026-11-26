"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { refreshImsAction, saveImsSourcesAction } from "@/app/actions/ims";

type Field = { id: string; label: string; hint: string; value: string };

export function SourcesForm({ fields }: { fields: Field[] }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <form
      className="grid gap-3"
      action={(form) => start(async () => setResult(await saveImsSourcesAction(form)))}
    >
      {fields.map((f) => (
        <label key={f.id} className="grid gap-1">
          <span className="text-[13px] font-semibold">{f.label}</span>
          <input name={f.id} defaultValue={f.value} className="ims-input" placeholder="https://docs.google.com/spreadsheets/d/…/edit?gid=…" autoComplete="off" />
          <span className="text-[12px] text-[var(--ims-muted)]">{f.hint}</span>
        </label>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="ims-btn" disabled={pending}>{pending ? "Checking…" : "Save and check"}</button>
        <button type="button" className="ims-btn is-quiet" disabled={pending} onClick={() => start(async () => { await refreshImsAction(); setResult({ ok: true, message: "Read the sheets again." }); })}>
          <RefreshCw size={15} /> Read now
        </button>
        {result ? <span className={`text-[13px] ${result.ok ? "text-[var(--ims-good)]" : "text-[var(--ims-bad)]"}`}>{result.message}</span> : null}
      </div>
    </form>
  );
}

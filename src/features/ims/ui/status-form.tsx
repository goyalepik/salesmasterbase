"use client";

import { useState, useTransition } from "react";
import { addStatusAction } from "@/app/actions/ims";

/** Editors: set a new status (and ETA for PO lines) on one row. Saved as a new update; the latest one shows. */
export function StatusForm({ kind, refKey, options, current, withEta = false }: { kind: "po" | "dispatch"; refKey: string; options: readonly string[]; current?: string | null; withEta?: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <form className="ims-inline-form" style={{ opacity: pending ? 0.6 : 1 }} action={(f) => start(async () => setMsg(await addStatusAction(f)))}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="ref" value={refKey} />
      <select name="status" defaultValue={current && options.includes(current) ? current : ""} className="ims-select" aria-label="Status" required>
        <option value="" disabled>Update…</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      {withEta ? <input type="date" name="eta" className="ims-input" aria-label="New ETA" /> : null}
      <button type="submit" className="ims-btn is-small is-quiet" disabled={pending}>Save</button>
      {msg ? <span className={msg.ok ? "ims-msg-ok" : "ims-msg-bad"}>{msg.message}</span> : null}
    </form>
  );
}

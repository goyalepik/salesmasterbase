"use client";

import { useState, useTransition } from "react";
import { refreshHqAction, saveHqSourcesAction } from "@/app/actions/hq";

export function HqSourcesForm({ copySheet, salesTab, adsSheet }: { copySheet: string; salesTab: string; adsSheet: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const input = { height: 42, width: "100%", padding: "0 12px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--soft)", fontSize: 13.5 } as const;
  return (
    <form action={(f) => start(async () => setMsg(await saveHqSourcesAction(f)))} style={{ display: "grid", gap: 10, opacity: pending ? 0.6 : 1 }}>
      <label className="hq-label">Live copy sheet (link or ID)<input name="copySheet" defaultValue={copySheet} style={input} /></label>
      <label className="hq-label">Tab with the Sales Tracker copy<input name="salesTab" defaultValue={salesTab} style={input} /></label>
      <label className="hq-label">Getepik Tracker (Meta spend), link or ID<input name="adsSheet" defaultValue={adsSheet} style={input} /></label>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="submit" className="hq-pill" style={{ background: "var(--ink)", color: "#fff", height: 38, padding: "0 16px" }}>Save and check</button>
        <button type="button" className="hq-pill" style={{ height: 38 }} onClick={() => start(async () => { await refreshHqAction(); setMsg({ ok: true, message: "Read again." }); })}>Read now</button>
        {msg ? <span style={{ fontSize: 13, color: msg.ok ? "var(--good)" : "var(--bad)" }}>{msg.message}</span> : null}
      </div>
    </form>
  );
}

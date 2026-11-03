"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ArrowLeft, FlaskConical, Inbox, RotateCcw } from "lucide-react";
import { EpikLogo } from "@/features/brand/epik-logo";
import { slaState } from "../domain/sla";
import { CxProvider, PERSONAS, useCx } from "./cx-store";

const TABS = [
  { href: "/cx", label: "Console", icon: Inbox },
  { href: "/cx/simulator", label: "Simulator", icon: FlaskConical },
];
const SOON = ["Queues", "Insights", "Floor TV", "Settings"];

export function CxShell({ children }: { children: ReactNode }) {
  return (
    <CxProvider>
      <Frame>{children}</Frame>
    </CxProvider>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { data, now, persona, setPersona, toast, reset } = useCx();
  const open = data?.tickets.filter((t) => t.status !== "closed" && t.status !== "resolved") ?? [];
  const byTicket = new Map<string, NonNullable<typeof data>["events"]>();
  for (const e of data?.events ?? []) byTicket.set(e.ticketId, [...(byTicket.get(e.ticketId) ?? []), e]);
  const states = open.map((t) => slaState(t, byTicket.get(t.id) ?? [], now).state);
  const kpis = [
    { label: "Open", value: open.length, tone: "" },
    { label: "P0 open", value: open.filter((t) => t.priority === "P0").length, tone: "is-hot" },
    { label: "About to breach", value: states.filter((s) => s === "at_risk").length, tone: "is-warn" },
    { label: "Breached", value: states.filter((s) => s === "breached").length, tone: "is-bad" },
    { label: "Callbacks waiting", value: open.filter((t) => t.queueId === "callbacks").length, tone: "" },
  ];

  return (
    <div className="cx">
      <header className="cx-bar">
        <div className="cx-brand">
          {/* A full page load back to the EPIK home, which has its own layout. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" className="cx-back" aria-label="Back to EPIK home"><ArrowLeft size={16} /></a>
          <EpikLogo height={22} className="cx-logo" />
          <span className="cx-product">Support</span>
          <span className="cx-pilot">Pilot</span>
        </div>
        <nav className="cx-tabs" aria-label="Support">
          {TABS.map((t) => {
            const Icon = t.icon;
            const on = t.href === "/cx" ? path === "/cx" : path.startsWith(t.href);
            return (
              <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined}>
                <Icon size={15} /> {t.label}
              </Link>
            );
          })}
          {SOON.map((s) => <span key={s} className="cx-soon" title="Next phase">{s}</span>)}
        </nav>
        <div className="cx-bar-right">
          <label className="cx-persona" title={persona.note}>
            <span className="sr-only">Pilot role</span>
            <select value={persona.id} onChange={(e) => setPersona(e.target.value)}>
              {PERSONAS.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.note.split(" · ")[0]}</option>)}
            </select>
          </label>
        </div>
      </header>
      <div className="cx-kpis" aria-label="Right now">
        {kpis.map((k) => (
          <span key={k.label} className={`cx-kpi ${k.tone}`}><b>{data ? k.value : "–"}</b> {k.label}</span>
        ))}
        <button type="button" className="cx-reset" onClick={() => { if (window.confirm("Reset the pilot to the sample data? Changes in this browser are lost.")) void reset(); }}>
          <RotateCcw size={13} /> Reset sample data
        </button>
      </div>
      <main className="cx-body">{data ? children : <div className="cx-loading">Loading the sample week…</div>}</main>
      <div className="cx-toast-wrap" aria-live="polite">
        {toast ? <p key={toast.key} className={`cx-toast ${toast.ok ? "" : "is-bad"}`} role={toast.ok ? "status" : "alert"}>{toast.text}</p> : null}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ArrowLeft, FlaskConical, Inbox, LogOut, Monitor, Moon, RefreshCw, RotateCcw, Sun } from "lucide-react";
import { EpikLogo } from "@/features/brand/epik-logo";
import { slaState } from "../domain/sla";
import { CxProvider, useCx, type CxUser } from "./cx-store";
import { useIsDark, useTheme, type ThemeChoice } from "./theme";

const TABS = [
  { href: "/cx", label: "Console", icon: Inbox },
  { href: "/cx/simulator", label: "Simulator", icon: FlaskConical },
];

const ROLE_NAME: Record<CxUser["role"], string> = { l1: "L1", l2: "L2", l3: "L3", admin: "Admin", viewer: "Viewer" };

export type SignInOptions = { google: boolean; dev: boolean; devPeople: Array<{ id: string; name: string; note: string }> };

export function CxShell({ user, signIn, children }: { user: CxUser | null; signIn: SignInOptions; children: ReactNode }) {
  if (!user) return <SignIn options={signIn} />;
  return (
    <CxProvider user={user}>
      <Frame>{children}</Frame>
    </CxProvider>
  );
}

const SIGNIN_ERROR: Record<string, string> = {
  domain: "Use your @getepik.in Google account.",
  expired: "The sign-in took too long. Try again.",
  cancelled: "Sign-in was cancelled.",
  failed: "Google sign-in did not finish. Try again.",
  not_configured: "Google sign-in is not set up yet.",
};

function SignIn({ options }: { options: SignInOptions }) {
  const error = useSearchParams().get("signin");
  const [theme] = useTheme();
  return (
    <div className="cx cx-signin" data-theme={theme}>
      <section className="cx-card">
        <EpikLogo height={26} className="cx-logo" />
        <h1>Sign in to Support</h1>
        <p className="cx-muted">Every action is saved with your name, so the team knows who did what.</p>
        {error ? <p className="cx-source-error" role="alert">{SIGNIN_ERROR[error] ?? "Sign-in failed."}</p> : null}
        {options.google ? (
          // A full page load: Google sign-in is a redirect, not a client route.
          <a className="cx-btn is-primary" href="/api/cx/auth/google">Sign in with Google (@getepik.in)</a>
        ) : null}
        {options.dev ? (
          <form method="post" action="/api/cx/auth/dev" className="cx-signin-dev">
            <label className="cx-field"><span>Pick who you are</span>
              <select name="person" defaultValue="khadija">
                {options.devPeople.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.note}</option>)}
              </select>
            </label>
            <button type="submit" className="cx-btn">Sign in</button>
            <p className="cx-muted">Quick sign-in for the pilot. It switches off by itself once Google sign-in is set up.</p>
          </form>
        ) : null}
        {!options.google && !options.dev ? <p className="cx-muted">Sign-in is not set up yet. Ask the admin to add Google sign-in.</p> : null}
      </section>
    </div>
  );
}

const RANGES = [
  { id: "today", label: "Today" },
  { id: "last_7_days", label: "Last 7 days" },
  { id: "last_30_days", label: "Last 30 days" },
];

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** Where the shared tickets come from, and (for L1/Admin) a button to pull new ones from Sagepilot. */
function SyncStrip() {
  const { meta, user, sagepilot, sampleAllowed, sync, syncing, resetTo, storeKind } = useCx();
  const [range, setRange] = useState("last_7_days");
  const canSync = sagepilot && (user.role === "l1" || user.role === "admin");
  const note = syncing ? "Reading Sagepilot…"
    : meta?.syncError ? `Sync failed: ${meta.syncError}`
    : meta?.source === "sagepilot" && meta.syncedAt ? `Sagepilot · read-only · synced ${clock(meta.syncedAt)}`
    : meta?.source === "sample" ? "Sample week, no real customers"
    : "No tickets yet";
  return (
    <span className="cx-source">
      <span className={`cx-source-note ${meta?.syncError ? "is-warn" : ""}`} title={storeKind === "mock" ? "Shared store: this computer's memory (local test)" : "Shared store: Vercel KV"}>{note}</span>
      {canSync ? (
        <>
          <select value={range} disabled={syncing} onChange={(e) => setRange(e.target.value)} aria-label="Date range">
            {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <button type="button" className="cx-icon" aria-label="Sync from Sagepilot" disabled={syncing} onClick={() => void sync(range)}>
            <RefreshCw size={13} className={syncing ? "animate-spin" : undefined} />
          </button>
        </>
      ) : null}
      {user.role === "admin" && sampleAllowed ? (
        <button type="button" className="cx-reset" onClick={() => { if (window.confirm("Replace everyone's tickets with the sample week?")) void resetTo("sample"); }}>
          <RotateCcw size={13} /> Sample
        </button>
      ) : null}
    </span>
  );
}

const THEMES: Array<{ id: ThemeChoice; label: string; icon: typeof Sun }> = [
  { id: "system", label: "System", icon: Monitor },
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
];

/** One tap between light and dark, from the top bar. */
function ThemeButton() {
  const [, setTheme] = useTheme();
  const dark = useIsDark();
  return (
    <button type="button" className="cx-icon cx-theme-btn" aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} title={dark ? "Light mode" : "Dark mode"} onClick={() => setTheme(dark ? "light" : "dark")}>
      {dark ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}

function UserMenu() {
  const [theme, setTheme] = useTheme();
  const { user } = useCx();
  const initials = user.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <details className="cx-user">
      <summary aria-label="Your account">
        <span className="cx-avatar is-small">{initials}</span>
        <span className="cx-user-text"><b>{user.name}</b><span>{ROLE_NAME[user.role]}</span></span>
      </summary>
      <div className="cx-user-menu">
        <p><b>{user.name}</b><span>{user.email}</span><span>Role: {ROLE_NAME[user.role]}</span></p>
        <div className="cx-seg cx-theme" role="group" aria-label="Appearance">
          {THEMES.map((t) => {
            const Icon = t.icon;
            return <button key={t.id} type="button" aria-pressed={theme === t.id} onClick={() => setTheme(t.id)}><Icon size={13} /> {t.label}</button>;
          })}
        </div>
        <form method="post" action="/api/cx/auth/signout"><button type="submit"><LogOut size={14} /> Sign out</button></form>
      </div>
    </details>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { data, now, toast, loadError, meta, storeKind, sharedNote } = useCx();
  const [theme] = useTheme();
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
    <div className="cx" data-theme={theme}>
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
        </nav>
        <div className="cx-bar-right">
          <ThemeButton />
          <UserMenu />
        </div>
      </header>
      <div className="cx-kpis" aria-label="Right now">
        {kpis.map((k) => (
          <span key={k.label} className={`cx-kpi ${k.tone}`}><b>{data ? k.value : "–"}</b> {k.label}</span>
        ))}
        <SyncStrip />
      </div>
      {storeKind === "mock" && sharedNote ? <p className="cx-pilot-note">{sharedNote}</p> : null}
      {loadError ? <p className="cx-source-error" role="alert">{loadError}</p> : null}
      <main className="cx-body">
        {!data ? <div className="cx-loading">Loading tickets… The first load reads Sagepilot and can take about 10 seconds.</div>
          : !data.tickets.length && meta?.source !== "sample" ? <EmptyStart /> : children}
      </main>
      <div className="cx-toast-wrap" aria-live="polite">
        {toast ? <p key={toast.key} className={`cx-toast ${toast.ok ? "" : "is-bad"}`} role={toast.ok ? "status" : "alert"}>{toast.text}</p> : null}
      </div>
    </div>
  );
}

function EmptyStart() {
  const { user, sagepilot, sync, syncing, sampleAllowed, resetTo } = useCx();
  const lead = user.role === "l1" || user.role === "admin";
  return (
    <div className="cx-empty cx-start">
      <h2>No tickets yet</h2>
      {lead && sagepilot ? <button type="button" className="cx-btn is-primary" disabled={syncing} onClick={() => void sync("last_7_days")}>{syncing ? "Reading Sagepilot…" : "Sync the last 7 days from Sagepilot"}</button> : null}
      {user.role === "admin" && sampleAllowed ? <button type="button" className="cx-btn" onClick={() => void resetTo("sample")}>Load the sample week</button> : null}
      {!lead ? <p className="cx-muted">Tickets appear here once N Khadija or an admin syncs from Sagepilot.</p> : null}
    </div>
  );
}

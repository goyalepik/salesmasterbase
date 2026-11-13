"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ArrowLeft, FlaskConical, Inbox, LogOut, Monitor, Moon, RefreshCw, RotateCcw, Sun, Users } from "lucide-react";
import { EpikLogo } from "@/features/brand/epik-logo";
import { CxProvider, useCx, type CxUser } from "./cx-store";
import { useIsDark, useTheme, type ThemeChoice } from "./theme";

const TABS = [
  { href: "/cx", label: "Console", icon: Inbox },
  { href: "/cx/simulator", label: "Simulator", icon: FlaskConical },
];

const ROLE_NAME: Record<CxUser["role"], string> = { l1: "L1", l2: "L2", l3: "L3", admin: "Admin", viewer: "Viewer" };

export type SignInOptions = {
  mode: "codes" | "google";
  google: boolean;
  /** After a level's code was accepted: that level's names to pick from. */
  pick: { level: string; levelName: string; people: Array<{ id: string; name: string; department: string }> } | null;
};

export function CxShell({ user, signIn, children }: { user: CxUser | null; signIn: SignInOptions; children: ReactNode }) {
  if (!user) return <SignIn options={signIn} />;
  return (
    <CxProvider user={user}>
      <Frame>{children}</Frame>
    </CxProvider>
  );
}

const SIGNIN_ERROR: Record<string, string> = {
  wrong_code: "That code did not work. Check it with your lead.",
  too_many: "Too many tries. Wait 10 minutes and try again.",
  expired: "That took too long. Type the code again.",
  not_on_roster: "Your name is not on the list for this level. Ask an Admin to add you.",
  domain: "Use your @getepik.in Google account.",
  cancelled: "Sign-in was cancelled.",
  failed: "Google sign-in did not finish. Try again.",
  not_configured: "Google sign-in is not set up yet.",
};

/** Sign-in: the code for your level, then your name. Rights come from the level; your name goes on every action. */
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
        {options.pick ? (
          <form method="post" action="/api/cx/auth/pick" className="cx-signin-dev">
            <label className="cx-field"><span>Who are you? ({options.pick.levelName})</span>
              <select name="person" required defaultValue="">
                <option value="" disabled>Pick your name</option>
                {options.pick.people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.department ? ` · ${p.department}` : ""}</option>)}
              </select>
            </label>
            <button type="submit" className="cx-btn is-primary">Continue</button>
            {!options.pick.people.length ? <p className="cx-muted">Nobody is on the list for this level yet. Ask an Admin.</p> : null}
          </form>
        ) : options.mode === "google" && options.google ? (
          // A full page load: Google sign-in is a redirect, not a client route.
          <a className="cx-btn is-primary" href="/api/cx/auth/google">Sign in with Google (@getepik.in)</a>
        ) : (
          <form method="post" action="/api/cx/auth/code" className="cx-signin-dev">
            <label className="cx-field"><span>Access code for your level</span>
              <input name="code" type="password" autoComplete="current-password" required minLength={4} maxLength={80} placeholder="Code from your lead" />
            </label>
            <button type="submit" className="cx-btn is-primary">Next</button>
            <p className="cx-muted">L1, L2 (departments), L3, Admin and Viewer each have their own code.</p>
          </form>
        )}
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
  const { meta, sagepilot, sampleAllowed, sync, syncing, resetTo, storeKind, can } = useCx();
  const [range, setRange] = useState("last_7_days");
  const canSync = sagepilot && can("sync");
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
      {can("settings") && sampleAllowed ? (
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
        <span className="cx-user-text"><b>{user.name}</b><span>{ROLE_NAME[user.role]}{user.department ? ` · ${user.department}` : ""}</span></span>
      </summary>
      <div className="cx-user-menu">
        <p><b>{user.name}</b><span>Level: {ROLE_NAME[user.role]}</span>{user.department ? <span>{user.department}</span> : null}</p>
        <div className="cx-seg cx-theme" role="group" aria-label="Appearance">
          {THEMES.map((t) => {
            const Icon = t.icon;
            return <button key={t.id} type="button" aria-pressed={theme === t.id} onClick={() => setTheme(t.id)}><Icon size={13} /> {t.label}</button>;
          })}
        </div>
        <form method="post" action="/api/cx/auth/switch"><button type="submit"><Users size={14} /> Switch user</button></form>
        <form method="post" action="/api/cx/auth/signout"><button type="submit"><LogOut size={14} /> Sign out</button></form>
      </div>
    </details>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { counters, rows, toast, loadError, meta, storeKind, sharedNote } = useCx();
  const [theme] = useTheme();
  const kpis = [
    { label: "Open", value: counters?.open, tone: "" },
    { label: "P0 open", value: counters?.p0, tone: "is-hot" },
    { label: "About to breach", value: counters?.atRisk, tone: "is-warn" },
    { label: "Breached", value: counters?.breached, tone: "is-bad" },
    { label: "Callbacks waiting", value: counters?.callbacks, tone: "" },
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
          <span key={k.label} className={`cx-kpi ${k.tone}`}><b>{k.value ?? "–"}</b> {k.label}</span>
        ))}
        <SyncStrip />
      </div>
      {storeKind === "mock" && sharedNote ? <p className="cx-pilot-note">{sharedNote}</p> : null}
      {loadError ? <p className="cx-source-error" role="alert">{loadError}</p> : null}
      <main className="cx-body">
        {!meta && !rows ? <div className="cx-loading">Loading tickets… The first load reads Sagepilot and can take about 10 seconds.</div>
          : meta && !meta.total && meta.source !== "sample" ? <EmptyStart /> : children}
      </main>
      <div className="cx-toast-wrap" aria-live="polite">
        {toast ? <p key={toast.key} className={`cx-toast ${toast.ok ? "" : "is-bad"}`} role={toast.ok ? "status" : "alert"}>{toast.text}</p> : null}
      </div>
    </div>
  );
}

function EmptyStart() {
  const { sagepilot, sync, syncing, sampleAllowed, resetTo, can } = useCx();
  const lead = can("sync");
  return (
    <div className="cx-empty cx-start">
      <h2>No tickets yet</h2>
      {lead && sagepilot ? <button type="button" className="cx-btn is-primary" disabled={syncing} onClick={() => void sync("last_7_days")}>{syncing ? "Reading Sagepilot…" : "Sync the last 7 days from Sagepilot"}</button> : null}
      {can("settings") && sampleAllowed ? <button type="button" className="cx-btn" onClick={() => void resetTo("sample")}>Load the sample week</button> : null}
      {!lead ? <p className="cx-muted">Tickets appear here once N Khadija or an admin syncs from Sagepilot.</p> : null}
    </div>
  );
}

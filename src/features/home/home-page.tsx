import { Suspense } from "react";
import { Inter, Instrument_Serif } from "next/font/google";
import {
  ArrowRight,
  ArrowUpRight,
  BadgeIndianRupee,
  Boxes,
  ClipboardPlus,
  KanbanSquare,
  ListOrdered,
  PackageCheck,
  ShieldCheck,
  Sparkles,
  Truck,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { EpikLogo } from "@/features/brand/epik-logo";
import { metricsFor } from "@/lib/ops-ui/cached";
import { loadOps } from "@/lib/ops-ui/load";
import { inrCompact } from "@/lib/ops-ui/format";
import { quoteOfTheDay } from "./quotes";
import { COMING, SHORTCUTS, WORKSPACES, type Workspace } from "./workspaces";
import { TrackerStat } from "./tracker-stat";

const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-serif" });
const sans = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sans" });

const CARD_ICON: Record<Workspace["id"], LucideIcon> = { ops: PackageCheck, tracker: KanbanSquare, assistant: Sparkles, admin: ShieldCheck };
const SHORTCUT_ICON: Record<string, LucideIcon> = {
  "/orders/new": ClipboardPlus,
  "/revops": BadgeIndianRupee,
  "/inventory": Boxes,
  "/dispatch": Truck,
  "/installations": Wrench,
  "/orders": ListOrdered,
};

function greeting(now: Date): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hourCycle: "h23" }).format(now));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** The EPIK home: a quote for the day, four equal workspace cards, shortcuts. One screen. */
export async function HomePage({ name, mode }: { name: string; mode: "demo" | "live" | "blocked" }) {
  const now = new Date();
  const first = name === "Dashboard" ? null : name.split(" ")[0];
  const initials = first ? name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase() : "EP";
  const date = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" }).format(now);
  const quote = quoteOfTheDay(now);

  return (
    <div className={`hm ${serif.variable} ${sans.variable}`}>
      <div className="hm-watermark" aria-hidden="true">We are Epikkkkkkk</div>

      <header className="hm-bar">
        <span className="hm-bar-side">{date}</span>
        <EpikLogo height={30} className="hm-logo" />
        <span className="hm-bar-side is-right">
          <span className={`hm-mode is-${mode}`}><i />{mode === "demo" ? "Demo data" : mode === "live" ? "Live" : "Setup needed"}</span>
          <span className="hm-me" title={name}>{initials}</span>
        </span>
      </header>

      <section className="hm-quote">
        <p className="hm-hello">{greeting(now)}{first ? `, ${first}` : ""}</p>
        <blockquote>
          <p>&ldquo;{quote.text}&rdquo;</p>
          {quote.by ? <cite>{quote.by}</cite> : <cite>Team EPIK</cite>}
        </blockquote>
      </section>

      <main className="hm-grid">
        <Card id="ops">
          <Suspense fallback={<p className="hm-figure"><b className="is-muted">—</b><span>open orders</span></p>}>
            <OpsFigures />
          </Suspense>
        </Card>
        <Card id="tracker">
          <TrackerStat />
        </Card>
        <Card id="assistant">
          <form action="/assistant" className="hm-ask">
            <label htmlFor="hm-q" className="sr-only">Ask EPIK</label>
            <input id="hm-q" name="q" placeholder="What is stuck today?" autoComplete="off" />
            <button type="submit" aria-label="Ask"><ArrowRight size={17} /></button>
          </form>
        </Card>
        <Card id="admin">
          <p className="hm-figure"><b>7</b><span>roles to assign</span></p>
          <dl className="hm-pair">
            <div><dt>Sign-in today</dt><dd>Shared code</dd></div>
            <div><dt>Next</dt><dd>Personal logins</dd></div>
          </dl>
        </Card>
      </main>

      <footer className="hm-foot">
        <nav className="hm-shortcuts" aria-label="Shortcuts">
          {SHORTCUTS.map((s) => {
            const Icon = SHORTCUT_ICON[s.href] ?? ArrowUpRight;
            return (
              <a key={s.href} href={s.href}>
                <Icon size={15} strokeWidth={1.8} /> {s.label}
              </a>
            );
          })}
        </nav>
        <p className="hm-next">
          <span>Coming next</span>
          {COMING.map((c) => <em key={c.title}>{c.title}</em>)}
        </p>
      </footer>
    </div>
  );
}

function Card({ id, children }: { id: Workspace["id"]; children: React.ReactNode }) {
  const w = WORKSPACES.find((x) => x.id === id)!;
  const Icon = CARD_ICON[id];
  return (
    <article className={`hm-card is-${id}`}>
      <header className="hm-card-head">
        <span className="hm-icon"><Icon size={18} strokeWidth={1.8} /></span>
        {/* The title link covers the whole card, so the card is one big button. */}
        <h2><a href={w.href} className="hm-stretch">{w.title}</a></h2>
        <ArrowUpRight size={18} className="hm-go" />
      </header>
      <p className="hm-desc">{w.description}</p>
      <div className="hm-card-foot">{children}</div>
    </article>
  );
}

async function OpsFigures() {
  const ops = await loadOps();
  if (ops.kind !== "ready") return <p className="hm-desc">Setup needed before live numbers show here.</p>;
  const m = await metricsFor(ops.store);
  const p = m.pipeline;
  const open = p.awaiting_payment + p.awaiting_inventory + p.awaiting_stock + p.ready_to_dispatch + p.out_for_delivery + p.on_hold;
  return (
    <>
      <p className="hm-figure"><b>{open}</b><span>open orders</span></p>
      <dl className="hm-pair">
        <div><dt>Out for delivery</dt><dd>{p.out_for_delivery}</dd></div>
        <div><dt>Stock value</dt><dd>{inrCompact(m.stock.valueMinor)}</dd></div>
      </dl>
    </>
  );
}

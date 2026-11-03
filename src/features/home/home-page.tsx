import { Suspense } from "react";
import { Inter, Instrument_Serif } from "next/font/google";
import { ArrowRight, Headset, KanbanSquare, PackageCheck, ShieldCheck, Sparkles, type LucideIcon } from "lucide-react";
import { EpikLogo } from "@/features/brand/epik-logo";
import { metricsFor } from "@/lib/ops-ui/cached";
import { loadOps } from "@/lib/ops-ui/load";
import { quoteOfTheDay } from "./quotes";
import { WORKSPACES, type Workspace } from "./workspaces";
import { TrackerStat } from "./tracker-stat";

const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["italic"], variable: "--font-serif" });
const sans = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans" });

const ICON: Record<Workspace["id"], LucideIcon> = { ops: PackageCheck, tracker: KanbanSquare, support: Headset, assistant: Sparkles, admin: ShieldCheck };

function greeting(now: Date): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hourCycle: "h23" }).format(now));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** The EPIK home: a quote for the day and the four workspaces. Nothing else. */
export async function HomePage({ name }: { name: string; mode: "demo" | "live" | "blocked" }) {
  const now = new Date();
  const first = name === "Dashboard" ? null : name.split(" ")[0];
  const quote = quoteOfTheDay(now);

  return (
    <div className={`hm ${serif.variable} ${sans.variable}`}>
      <main className="hm-page">
        <EpikLogo height={34} className="hm-logo" />

        <p className="hm-hello">{greeting(now)}{first ? `, ${first}` : ""}</p>
        <blockquote className="hm-quote">
          <p>&ldquo;{quote.text}&rdquo;</p>
          <cite>{quote.by ?? "Team EPIK"}</cite>
        </blockquote>

        <nav className="hm-list" aria-label="Workspaces">
          {WORKSPACES.map((w) => {
            const Icon = ICON[w.id];
            return (
              <a key={w.id} href={w.href} className="hm-row">
                <span className="hm-icon"><Icon size={18} strokeWidth={1.8} /></span>
                <span className="hm-text">
                  <b>{w.title}</b>
                  <span>{w.description}</span>
                </span>
                <span className="hm-stat">
                  {w.id === "ops" ? (
                    <Suspense fallback={null}><OpsStat /></Suspense>
                  ) : w.id === "tracker" ? (
                    <TrackerStat />
                  ) : null}
                </span>
                <ArrowRight size={17} className="hm-arrow" />
              </a>
            );
          })}
        </nav>
      </main>
    </div>
  );
}

async function OpsStat() {
  const ops = await loadOps();
  if (ops.kind !== "ready") return null;
  const p = (await metricsFor(ops.store)).pipeline;
  const open = p.awaiting_payment + p.awaiting_inventory + p.awaiting_stock + p.ready_to_dispatch + p.out_for_delivery + p.on_hold;
  return <>{open} open orders</>;
}

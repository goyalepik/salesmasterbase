import { Suspense } from "react";
import Link from "next/link";
import { ArrowUp, Info, Sparkles, SunMedium } from "lucide-react";
import { BlockedState } from "@/components/blocked-state";
import { OverviewBody, SectionSkeleton } from "@/components/ops/overview";
import { assistantStatus } from "@/lib/ai/runtime";
import { demoSeedLabel } from "@/lib/ops";
import { actorName } from "@/lib/ops-ui/actor";
import { loadOps } from "@/lib/ops-ui/load";

const PROMPTS = [
  ["What is stuck?", "Which orders are stuck and who needs to act?"],
  ["COD to collect", "How much COD is out for delivery today, by driver?"],
  ["Stock to reorder", "Which fast-selling products are out of stock?"],
  ["This week's sales", "Summarise this week's sales by hub and POC."],
] as const;

function greeting(now: Date): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hourCycle: "h23" }).format(now));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default async function OverviewPage() {
  const ops = await loadOps();
  if (ops.kind !== "ready") return <BlockedState health={ops.workspace.health} />;
  const now = new Date();
  const name = await actorName();
  const firstName = name === "Dashboard" ? "" : `, ${name.split(" ")[0]}`;
  return (
    <div className="overview-page">
      <section className="ai-hero">
        <p className="ai-greeting">{greeting(now)}{firstName} <SunMedium size={15} className="text-warn" /></p>
        <h1>Ask anything about EPIK</h1>
        <form action="/assistant" className="ai-prompt">
          <Sparkles size={17} className="shrink-0 text-info" />
          <label className="sr-only" htmlFor="overview-ask">Ask anything about EPIK</label>
          <input id="overview-ask" name="q" placeholder="Ask about orders, payments, stock or deliveries…" />
          <button type="submit" aria-label="Ask"><ArrowUp size={16} /></button>
        </form>
        <div className="suggested-questions">
          {PROMPTS.map(([label, question]) => (
            <Link key={label} href={`/assistant?q=${encodeURIComponent(question)}`}>{label}</Link>
          ))}
        </div>
        {ops.workspace.mode === "demo" ? (
          <p className="info-banner" role="status">
            <Info size={17} className="shrink-0 text-info" />
            <span>Demo: {demoSeedLabel()}. Changes stay in memory until the server restarts.</span>
          </p>
        ) : null}
      </section>
      <Suspense fallback={<><SectionSkeleton height={112} /><SectionSkeleton height={300} /><SectionSkeleton height={380} /></>}>
        <OverviewBody store={ops.store} nowIso={now.toISOString()} health={ops.workspace.health} assistant={assistantStatus()} />
      </Suspense>
    </div>
  );
}

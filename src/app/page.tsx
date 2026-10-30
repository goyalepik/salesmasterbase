import { Suspense } from "react";
import Link from "next/link";
import { ArrowUp, Sparkles } from "lucide-react";
import { BlockedState } from "@/components/blocked-state";
import { OverviewBody, RecentActivity, SectionSkeleton } from "@/components/ops/overview";
import { DemoNotice } from "@/components/ui";
import { demoSeedLabel } from "@/lib/ops";
import { loadOps } from "@/lib/ops-ui/load";

const PROMPTS = [
  ["What is stuck?", "Which orders are stuck and who needs to act?"],
  ["COD to collect", "How much COD is out for delivery today, by driver?"],
  ["Stock to reorder", "Which fast-selling products are out of stock?"],
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
  return (
    <div className="overview-page">
      <section className="ai-hero">
        <p>{greeting(now)}</p>
        <h1>Ask anything about EPIK</h1>
        <form action="/assistant" className="ai-prompt">
          <Sparkles size={15} className="shrink-0 text-info" />
          <label className="sr-only" htmlFor="overview-ask">Ask anything about EPIK</label>
          <input id="overview-ask" name="q" placeholder="Ask about orders, payments, stock or deliveries…" />
          <button type="submit" aria-label="Ask"><ArrowUp size={15} /></button>
        </form>
      </section>
      <div className="suggested-questions">
        {PROMPTS.map(([label, question]) => (
          <Link key={label} href={`/assistant?q=${encodeURIComponent(question)}`}>{label}</Link>
        ))}
      </div>
      {ops.workspace.mode === "demo" ? (
        <>
          <DemoNotice />
          <p className="-mt-2 mb-3 text-center text-[11px] text-faint">Operations data: {demoSeedLabel()}. Changes here stay in memory until the server restarts.</p>
        </>
      ) : null}
      <Suspense fallback={<><SectionSkeleton height={110} /><SectionSkeleton height={130} /><SectionSkeleton height={380} /></>}>
        <OverviewBody store={ops.store} nowIso={now.toISOString()} />
      </Suspense>
      <Suspense fallback={<SectionSkeleton height={300} />}>
        <RecentActivity store={ops.store} />
      </Suspense>
    </div>
  );
}

import Link from "next/link";
import { BlockedState } from "@/components/blocked-state";
import { PageHeader } from "@/components/ui";
import { assistantStatus, toolContext } from "@/lib/ai/runtime";
import { inr, todayIst } from "@/lib/ai/util";
import { loadWorkspace } from "@/lib/workspace";
import { BriefingWriter } from "./briefing-writer";

export default async function BriefingPage() {
  const workspace = await loadWorkspace();
  if (workspace.kind !== "ready") return <BlockedState health={workspace.health} />;
  const ctx = await toolContext();
  if (!ctx) return <BlockedState health={workspace.health} />;
  const now = new Date();
  const m = await ctx.store.metrics(now);
  const open = m.pipeline.awaiting_payment + m.pipeline.awaiting_inventory + m.pipeline.awaiting_stock + m.pipeline.ready_to_dispatch + m.pipeline.out_for_delivery + m.pipeline.on_hold;
  const yesterday = m.daily.length >= 2 ? m.daily[m.daily.length - 2] : null;
  const status = assistantStatus();
  const cards: Array<[string, string, string | null]> = [
    ["Orders today", String(m.today.orders), yesterday ? `${yesterday.orders} yesterday` : null],
    ["Offered today", inr(m.today.offeredMinor), yesterday ? `${inr(yesterday.offeredMinor)} yesterday` : null],
    ["Verified received today", inr(m.today.verifiedMinor), "RevOps + COD on delivery"],
    ["Delivered today", String(m.today.delivered), yesterday ? `${yesterday.delivered} yesterday` : null],
    ["Open orders", String(open), `${inr(m.pipelineValueMinor)} offered`],
    ["COD to collect", inr(m.codOutstandingMinor), null],
    ["Checks over 24h", String(m.overdue.stuckPayment + m.overdue.stuckInventory), `${m.overdue.stuckPayment} payment · ${m.overdue.stuckInventory} inventory`],
    ["Late supply / installs", `${m.overdue.lateProcurement} / ${m.overdue.lateInstallations}`, "procurement past ETA / installs past due"],
  ];
  const writer =
    status.provider === "rules"
      ? "No AI key is configured, so this is a fixed report built from the same lookups the assistant uses."
      : `Written by ${status.model} from live lookups. Numbers can be checked under “How I got this”.`;
  return (
    <section>
      <PageHeader
        title="Daily briefing"
        description={`${todayIst(now)} (IST). Offered is the deal price, not money collected. Verified received counts only RevOps-verified payments and COD recorded on delivery.`}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([label, value, hint]) => (
          <div key={label} className="panel px-4 py-3">
            <p className="text-[12px] text-muted">{label}</p>
            <p className="mt-1 text-[22px] font-semibold tabular-nums">{value}</p>
            {hint ? <p className="mt-0.5 text-[11px] text-faint">{hint}</p> : null}
          </div>
        ))}
      </div>
      <BriefingWriter writer={writer} />
      <p className="mt-4 text-[13px]">
        <Link href={`/assistant?q=${encodeURIComponent("What's stuck right now?")}`} className="text-info">Ask the assistant what is stuck</Link>
      </p>
    </section>
  );
}

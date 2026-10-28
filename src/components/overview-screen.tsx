import Link from "next/link";
import { AlertTriangle, ArrowUp, Hash, IndianRupee, MessageSquare, Sparkles, XCircle } from "lucide-react";
import { ActivityChart, CategoryChart } from "@/components/charts";
import { RefreshOnChange } from "@/components/live-provider";
import { DemoNotice, EmptyState, StatusText } from "@/components/ui";
import { buildCategories, buildDailySeries, chartRange, countStatus, distinctOrderReferences, messagesWithAmount, rankContributors, seriesHasActivity } from "@/lib/analytics";
import { formatInrFromMinor, istDayBounds } from "@/lib/format";
import type { HealthReport } from "@/lib/health";
import { EXCEPTION_LABELS, type ActivityPoint, type OverviewData } from "@/lib/types";

const PROMPTS = [
  ["Today's payment updates", "What payment updates arrived today?"],
  ["Messages needing review", "Show messages that need review."],
  ["Most active contributors", "Which salesperson has the most Slack-attributed messages?"],
  ["Summarise this week's activity", "Summarise this week's activity."],
] as const;

function greeting(iso: string): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hourCycle: "h23" }).format(new Date(iso)));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function shortWhen(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

function initials(label: string): string {
  const parts = label.split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? "?"}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

export function OverviewScreen({
  overview,
  health,
  points,
  truncated,
  nowIso,
}: {
  overview: OverviewData;
  health: HealthReport;
  points: ActivityPoint[];
  truncated: boolean;
  nowIso: string;
}) {
  const now = new Date(nowIso);
  const range = chartRange(now, 7);
  const today = istDayBounds(now);
  const todayPoints = points.filter((point) => {
    const received = new Date(point.eventReceivedAt).getTime();
    return received >= today.start.getTime() && received < today.end.getTime();
  });
  const series = buildDailySeries(points, range.days);
  const slices = buildCategories(points);
  const leaders = rankContributors(points).slice(0, 6);
  const maxMessages = leaders[0]?.messages ?? 1;
  const illustrative = health.modeLabel === "Demo";
  const weekTotal = series.reduce((sum, day) => sum + day.received, 0);
  const slackState = health.modeLabel === "Demo"
    ? "Demo mode"
    : health.facts?.lastEventAt
      ? "Event stored"
      : health.slackSigning === "configured"
        ? "Configured, not verified"
        : "Not configured";
  const databaseState = health.database === "reachable" ? "Reachable" : health.database === "unreachable" ? "Error" : health.database === "disabled" ? "Demo mode" : "Not configured";
  const openaiState = health.openaiConfigured ? "Configured, not verified" : "Not configured";

  return (
    <div className="overview-page">
      <RefreshOnChange />
      <section className="ai-hero">
        <p>{greeting(nowIso)}</p>
        <h1>Ask anything about EPIK</h1>
        <form action="/assistant" className="ai-prompt">
          <Sparkles size={15} className="shrink-0 text-info" />
          <label className="sr-only" htmlFor="overview-ask">Ask anything about EPIK</label>
          <input id="overview-ask" name="q" placeholder="Ask about sales, payment updates, or what needs attention…" />
          <button type="submit" aria-label="Ask"><ArrowUp size={15} /></button>
        </form>
      </section>
      <div className="suggested-questions">
        {PROMPTS.map(([label, question]) => (
          <Link key={label} href={`/assistant?q=${encodeURIComponent(question)}`}>{label}</Link>
        ))}
      </div>
      {health.modeLabel === "Demo" ? <DemoNotice /> : null}

      <dl className="kpi-grid">
        <div className="kpi-card">
          <div className="flex items-center justify-between text-muted"><dt>Total messages</dt><MessageSquare size={14} /></div>
          <dd className="kpi-value">{overview.messagesToday}</dd>
          <p>Today · {weekTotal} in 7 days{illustrative ? " · sample" : ""}</p>
        </div>
        <div className="kpi-card">
          <div className="flex items-center justify-between text-muted"><dt>Orders mentioned</dt><Hash size={14} /></div>
          <dd className="kpi-value">{distinctOrderReferences(points)}</dd>
          <p>Today {distinctOrderReferences(todayPoints)} · extracted refs, not confirmed orders</p>
        </div>
        <div className="kpi-card">
          <div className="flex items-center justify-between text-muted"><dt>Amount reported</dt><IndianRupee size={14} /></div>
          <dd className="kpi-value">Not available</dd>
          <p>{messagesWithAmount(points)} unverified mentions are not summed</p>
        </div>
        <div className="kpi-card">
          <div className="flex items-center justify-between text-muted"><dt>Needs review</dt><AlertTriangle size={14} /></div>
          <dd className="kpi-value">{overview.reviewBacklog}</dd>
          <p>{countStatus(points, "needs_review")} flagged in 7 days</p>
        </div>
        <div className="kpi-card">
          <div className="flex items-center justify-between text-muted"><dt>Processing failures</dt><XCircle size={14} /></div>
          <dd className="kpi-value">{overview.failedOrDelayed}</dd>
          <p>Failed, or still delayed</p>
        </div>
      </dl>

      <div className="analytics-grid">
        <section className="dashboard-panel">
          <div className="dashboard-panel-header">
            <h2 className="dashboard-panel-title">Message activity</h2>
            <p className="text-[11px] text-faint">{illustrative ? "Illustrative sample · 7 days" : "Stored messages · 7 days"}{truncated ? " · capped" : ""}</p>
          </div>
          {seriesHasActivity(series) ? <ActivityChart series={series} /> : <EmptyState title="No activity in this window" detail="The chart stays empty until messages fall inside the last seven days." />}
        </section>
        <section className="dashboard-panel">
          <div className="dashboard-panel-header">
            <h2 className="dashboard-panel-title">Message categories</h2>
            <p className="text-[11px] text-faint">{illustrative ? "Illustrative sample" : "Stored classifications"}</p>
          </div>
          {slices.length > 0 ? <CategoryChart slices={slices} /> : <EmptyState title="No classified messages" detail="Categories are payment mention, order update, and unclassified." />}
        </section>
        <section className="dashboard-panel">
          <div className="dashboard-panel-header">
            <h2 className="dashboard-panel-title">System health</h2>
          </div>
          <ul className="space-y-3 text-[13px]">
            <li>
              <div className="flex justify-between gap-2"><span>Slack</span><span className="text-[12px] text-muted">{slackState}</span></div>
              <p className="dashboard-panel-subtitle">{health.modeLabel === "Demo" ? "Events are not received in demo." : health.facts?.lastEventAt ? "A stored row exists. That is not a live socket." : "A signing secret alone is not a connection."}</p>
            </li>
            <li>
              <div className="flex justify-between gap-2"><span>Supabase</span><span className="text-[12px] text-muted">{databaseState}</span></div>
              <p className="dashboard-panel-subtitle">{health.databaseDetail}</p>
            </li>
            <li>
              <div className="flex justify-between gap-2"><span>OpenAI</span><span className="text-[12px] text-muted">{openaiState}</span></div>
              <p className="dashboard-panel-subtitle">{health.openaiConfigured ? "This page does not call the model." : "The assistant still shows database counts."}</p>
            </li>
          </ul>
        </section>
      </div>

      <div className="operations-grid">
        <section className="dashboard-panel">
          <div className="dashboard-panel-header">
            <h2 className="dashboard-panel-title">Recent Slack messages</h2>
            <Link href="/inbox" className="text-[12px] text-info">Inbox</Link>
          </div>
          {overview.recent.length === 0 ? <p className="text-[13px] text-muted">No messages stored yet.</p> : (
            <div className="overflow-x-auto">
              <div className="grid min-w-[560px] grid-cols-[88px_96px_minmax(0,1fr)_108px_84px] gap-2 px-1 pb-1 text-[11px] text-faint">
                <span>Time</span><span>Sender</span><span>Message</span><span>Extracted</span><span>Status</span>
              </div>
              {overview.recent.slice(0, 6).map((row) => (
                <Link key={row.id} href={`/inbox/${row.id}`} title={row.preview} className="grid min-w-[560px] grid-cols-[88px_96px_minmax(0,1fr)_108px_84px] items-center gap-2 border-t border-white/8 px-1 py-1.5 text-[12px] hover:bg-white/4">
                  <span className="tabular-nums text-muted">{shortWhen(row.eventReceivedAt)}</span>
                  <span className="truncate">{row.senderName ?? row.senderId ?? "Unknown"}</span>
                  <span className="truncate">{row.preview}</span>
                  <span className="truncate tabular-nums">{row.orderReference ?? (row.amountMinor != null ? formatInrFromMinor(row.amountMinor) : "—")}</span>
                  <StatusText status={row.processingStatus} />
                </Link>
              ))}
            </div>
          )}
        </section>
        <section className="dashboard-panel">
          <div className="dashboard-panel-header">
            <div>
              <h2 className="dashboard-panel-title">Most active contributors</h2>
              <p className="dashboard-panel-subtitle">Distinct non-skipped messages, last 7 days. Not sales performance.</p>
            </div>
            <Link href="/contributors" className="text-[12px] text-info">All</Link>
          </div>
          {leaders.length === 0 ? <p className="text-[13px] text-muted">No eligible sender in this window.</p> : (
            <ol className="space-y-2">
              {leaders.map((person, index) => (
                <li key={person.key} className="grid grid-cols-[16px_28px_minmax(0,1fr)_auto] items-center gap-2 text-[12px]">
                  <span className="tabular-nums text-faint">{index + 1}</span>
                  <span className="flex size-7 items-center justify-center rounded-full bg-white/8 text-[10px]">{initials(person.label)}</span>
                  <span className="min-w-0">
                    <span className="block truncate">{person.label}</span>
                    <span className="mt-1 block h-1 overflow-hidden rounded-full bg-white/8">
                      <span className="block h-1 rounded-full bg-accent" style={{ width: `${Math.max(8, (person.messages / maxMessages) * 100)}%` }} />
                    </span>
                  </span>
                  <span className="tabular-nums text-muted">{person.messages}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section className="dashboard-panel">
          <div className="dashboard-panel-header">
            <h2 className="dashboard-panel-title">Exceptions</h2>
            <Link href="/exceptions" className="text-[12px] text-info">Queue</Link>
          </div>
          {overview.attention.length === 0 ? <p className="text-[13px] text-muted">No open exceptions.</p> : (
            <ul className="space-y-1.5">
              {overview.attention.slice(0, 6).map((item) => (
                <li key={item.id}>
                  <Link href={`/inbox/${item.messageId}`} className="block rounded-[8px] px-1 py-1 hover:bg-white/5">
                    <span className={`text-[12px] ${item.severity === "high" ? "text-bad" : item.severity === "medium" ? "text-warn" : "text-muted"}`}>{EXCEPTION_LABELS[item.type]}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-faint">{item.reason}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

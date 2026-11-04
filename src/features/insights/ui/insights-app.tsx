"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Info, Lightbulb, MousePointerClick, ThumbsDown, ThumbsUp } from "lucide-react";
import { EpikLogo } from "@/features/brand/epik-logo";
import type { CallNotes, Consultant, InsightsReport, SegmentId } from "../lib/types";
import {
  CalibrationChart, Confusion, ConsultantScatter, Coverage, DecileBars, Donut, DriverBars, Funnel, GainsChart, Gauge, Heatmap,
  RateBars, RocChart, ScoreBars, SkillBar, TipLayer, Trend, Waterfall, consultantCard, inr, num, pct, tip, w,
} from "./charts";

const PAGES = [
  { id: "summary", label: "Summary" },
  { id: "findings", label: "Findings" },
  { id: "money", label: "Money" },
  { id: "sells", label: "What sells" },
  { id: "when", label: "When & mix" },
  { id: "score", label: "Lead score" },
  { id: "people", label: "CDEs" },
  { id: "calls", label: "The calls" },
  { id: "data", label: "Data health" },
  { id: "tech", label: "Technical" },
] as const;
type PageId = (typeof PAGES)[number]["id"];

const SEGMENT_GROUPS: { title: string; ids: SegmentId[] }[] = [
  { title: "The demo", ids: ["demoType", "demoLength", "callLength", "rating"] },
  { title: "The lead", ids: ["source", "hub", "speed", "weekday", "hour"] },
  { title: "The product", ids: ["category", "brand"] },
  { title: "AI on the call", ids: ["aiHot", "aiResult", "aiIntent", "aiSentiment"] },
  { title: "CDE survey", ids: ["priceResponse", "issue", "decisionMaker", "age"] },
];

const AI_LABELS: Record<string, string> = {
  high: "High intent", medium: "Medium intent", low: "Low intent", just_exploring: "Just exploring", neutral: "Neutral",
  follow_up_needed: "Follow-up needed", undecided: "Undecided", qualified: "Qualified", lost: "Lost",
  positive: "Positive mood", negative: "Negative mood",
};

const toneIcon = { good: CheckCircle2, bad: AlertTriangle, info: Info } as const;
const toneWord = { good: "Working", bad: "Fix", info: "Worth knowing" } as const;

// The open page lives in the URL hash, so a link can point straight at "Technical".
const subscribe = (cb: () => void) => { window.addEventListener("hashchange", cb); return () => window.removeEventListener("hashchange", cb); };
function usePage(): PageId {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash.slice(1), () => "");
  return (PAGES.find((p) => p.id === hash)?.id ?? "summary") as PageId;
}
const go = (id: string) => { window.location.hash = id; };

const month = (d: string) => new Date(`${d.length === 7 ? `${d}-01` : d}T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

export function InsightsApp({ report, notes, problem = null }: { report: InsightsReport | null; notes: CallNotes | null; problem?: string | null }) {
  const page = usePage();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [role='dialog']") || e.metaKey || e.ctrlKey || e.altKey) return;
      const i = PAGES.findIndex((p) => p.id === page);
      if (e.key === "ArrowRight" && i < PAGES.length - 1) go(PAGES[i + 1].id);
      if (e.key === "ArrowLeft" && i > 0) go(PAGES[i - 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page]);

  const source = report
    ? `${num(report.base.mature)} judged demos, ${month(report.dataset.trackedFrom)} to ${month(report.dataset.matureBefore)}, from ${num(report.dataset.rows)} rows in ${report.source.file} (pulled ${report.source.pulledAt}).`
    : "";

  return (
    <div className="ci">
      <TipLayer source={source}>
        <header className="ci-top">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" className="ci-home" aria-label="EPIK home"><ArrowLeft size={16} /><EpikLogo height={20} /></a>
          {report ? (
            <nav className="ci-nav" aria-label="Pages">
              {PAGES.map((p, i) => (
                <a key={p.id} href={`#${p.id}`} aria-current={page === p.id ? "page" : undefined}>
                  <small>{String(i + 1).padStart(2, "0")}</small>{p.label}
                </a>
              ))}
            </nav>
          ) : null}
        </header>
        {report ? <Pages page={page} r={report} notes={notes} /> : <Empty problem={problem} />}
      </TipLayer>
    </div>
  );
}

function Empty({ problem }: { problem: string | null }) {
  return (
    <main className="ci-page ci-empty">
      <p className="ci-kicker">Customer Insights</p>
      <h1>No report yet</h1>
      {problem ? <p>{problem}</p> : null}
      <p>The report is built on the computer that has the demo sheet, then copied to Supabase so this site can show it. The sheet itself, with customer details, never leaves that computer.</p>
      <pre>npx tsx scripts/analyse-demos.ts --demos &quot;completed demos.xlsx&quot; --push</pre>
    </main>
  );
}

function Pages({ page, r, notes }: { page: PageId; r: InsightsReport; notes: CallNotes | null }) {
  const i = PAGES.findIndex((p) => p.id === page);
  const fitRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // Fit the page to the window on desktop: scale down (to 68% at most) so a 13-inch laptop sees it all
  // without scrolling. If even 68% is too tall, let it scroll rather than cut anything off. Phones scroll as normal.
  useLayoutEffect(() => {
    let frame = 0;
    const fit = () => {
      const el = fitRef.current;
      const stage = stageRef.current;
      if (!el || !stage) return;
      el.style.zoom = "1";
      stage.style.overflowY = "";
      if (window.innerWidth < 960 || window.innerHeight < 560) return;
      const need = stage.clientHeight / el.scrollHeight;
      el.style.zoom = Math.max(0.68, Math.min(1, need)).toFixed(3);
      if (need < 0.68) stage.style.overflowY = "auto";
    };
    const later = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(fit); };
    fit();
    const mo = new MutationObserver(later);
    if (fitRef.current) mo.observe(fitRef.current, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", later);
    return () => { mo.disconnect(); window.removeEventListener("resize", later); cancelAnimationFrame(frame); };
  }, [page]);
  const body: Record<PageId, ReactNode> = {
    summary: <SummaryPage r={r} />,
    findings: <FindingsPage r={r} />,
    money: <MoneyPage r={r} />,
    sells: <SellsPage r={r} />,
    when: <WhenPage r={r} />,
    score: <ScorePage r={r} />,
    people: <PeoplePage r={r} />,
    calls: <CallsPage r={r} notes={notes} />,
    data: <DataPage r={r} />,
    tech: <TechPage r={r} />,
  };
  return (
    <main className="ci-page">
      <div className="ci-stage" ref={stageRef}>
        <div className="ci-fit" ref={fitRef} key={page}>{body[page]}</div>
      </div>
      <footer className="ci-pager">
        {i > 0 ? <a href={`#${PAGES[i - 1].id}`}><ArrowLeft size={15} /> {PAGES[i - 1].label}</a> : <span />}
        <span className="ci-pager-n">{i + 1} / {PAGES.length}<small><MousePointerClick size={12} /> Click any point for its data · ← → to move</small></span>
        {i < PAGES.length - 1 ? <a href={`#${PAGES[i + 1].id}`}>{PAGES[i + 1].label} <ArrowRight size={15} /></a> : <span />}
      </footer>
    </main>
  );
}

function Head({ kicker, title, sub, children }: { kicker: string; title: string; sub?: string; children?: ReactNode }) {
  return (
    <header className="ci-head">
      <div>
        <p className="ci-kicker">{kicker}</p>
        <h2>{title}</h2>
        {sub ? <p className="ci-sub">{sub}</p> : null}
      </div>
      {children}
    </header>
  );
}

/** A chart card. `foot` names the data it is built on, so every chart says what it stands on. */
function Card({ title, sub, foot, children, className = "" }: { title?: string; sub?: string; foot?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`ci-card ${className}`}>
      {title ? <header className="ci-card-head"><b>{title}</b>{sub ? <span>{sub}</span> : null}</header> : null}
      <div className="ci-card-body">{children}</div>
      {foot ? <footer className="ci-card-foot">{foot}</footer> : null}
    </section>
  );
}

function SubTabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: [T, string][] }) {
  return (
    <div className="ci-toggle" role="tablist">
      {tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={value === id} onClick={() => onChange(id)}>{label}</button>)}
    </div>
  );
}

// ── 1. Summary ────────────────────────────────────────────────────────────────────────────────

function SummaryPage({ r }: { r: InsightsReport }) {
  const d = r.dataset;
  const [rows, valid, tracked, judged] = d.funnel.map((f) => f.n);
  return (
    <>
      <section className="ci-hero">
        <p className="ci-kicker">Customer Insights · Demos</p>
        <h1>What turns a demo into a sale</h1>
        <p className="ci-lede">
          {num(rows)} demo records from {month(r.base.from)} to {month(r.base.to)}, {num(r.base.transcripts)} call transcripts and {num(r.base.surveyed)} CDE surveys, checked against real EPIK orders and tested with six machine-learning models. Data pulled {r.source.pulledAt}.
        </p>
      </section>
      <div className="ci-kpis">
        <Kpi label="Demos judged" value={num(judged)} sub={`${month(d.trackedFrom)} to ${month(d.matureBefore)}`} card={tip("Demos judged", [["Rows in the sheet", num(rows)], ["Valid date", num(valid)], ["Outcome tracked", num(tracked)], ["Judged (2+ weeks old)", num(judged)]], "Only demos whose outcome was tracked and that have had two weeks to convert.")} />
        <Kpi label="Became a sale" value={num(r.base.won)} sub="CRM status or a real order" card={tip("Became a sale", [["Sales", num(r.base.won)], ["Matched to an EPIK order", num(r.base.matchedOrders)], ["Caught only by the order match", num(r.quality.find((q) => /CRM status missed/.test(q.label))?.count ?? 0)]], r.outcomeRule)} />
        <Kpi label="Demo to sale" value={pct(r.base.rate, 1)} sub={`1 in every ${Math.round(1 / Math.max(r.base.rate, 0.001))} demos`} card={tip("Demo to sale", [["Sales", num(r.base.won)], ["Demos judged", num(judged)], ["Rate", pct(r.base.rate, 2)]], "The baseline every bar and finding on these pages is compared with.")} />
        <Kpi label="Average sale" value={inr(r.base.aovMinor)} sub="From closed deal prices" card={tip("Average sale", [["Average", inr(r.base.aovMinor)], ["Based on", "Deal prices typed on closed deals"]], "Amounts below ₹1,000 (placeholders like INR1) are ignored.")} />
        <Kpi label="Sales from demos" value={inr(r.base.revenueMinor)} sub="Sales × average sale" card={tip("Sales from demos", [["Sales", num(r.base.won)], ["Average sale", inr(r.base.aovMinor)], ["Total", inr(r.base.revenueMinor)]], "An estimate: count of sales times the average closed deal price.")} />
      </div>
      <div className="ci-grid-3">
        <Card title="What the CRM says happened" sub={`All ${num(valid)} demos with a valid date`} foot={`n = ${num(valid)} · raw CRM status, grouped`}>
          <Donut slices={d.status} centre={num(valid)} sub="demos" colours={["#eda100", "#2a78d6", "#1baf7a", "#e87ba4", "#eb6834", "#c3c2b7"].slice(0, d.status.length)} note="CRM status as typed. 'Demo done, no outcome' includes the old imported demos whose outcome was never tracked." />
        </Card>
        <Card title="The three findings that matter most" className="ci-span-2" foot="Each finding is computed from the judged demos; click one for the evidence">
          <ol className="ci-top3">
            {r.headlines.slice(1, 4).map((h, i) => <FindingRow key={i} h={h} n={i + 1} of={r.headlines.length - 1} />)}
          </ol>
          <button type="button" className="ci-link" onClick={() => go("findings")}>All {r.headlines.length - 1} findings <ArrowRight size={14} /></button>
        </Card>
      </div>
    </>
  );
}

function Kpi({ label, value, sub, card }: { label: string; value: string; sub: string; card: string }) {
  return <div className="ci-kpi" tabIndex={0} data-tip={card}><span>{label}</span><b>{value}</b><small>{sub}</small></div>;
}

function FindingRow({ h, n, of }: { h: InsightsReport["headlines"][number]; n: number; of: number }) {
  const Icon = toneIcon[h.tone];
  return (
    <li className={`ci-finding is-${h.tone}`} style={{ ["--i" as string]: n }} tabIndex={0} data-tip={tip(h.title, [["Headline number", h.metric], ["Type", toneWord[h.tone]], ["Finding", `${n} of ${of}`]], h.detail)}>
      <span className="ci-finding-metric">{h.metric}</span>
      <span className="ci-finding-body"><b>{h.title}</b><span>{h.detail}</span></span>
      <span className="ci-finding-tag"><Icon size={13} /> {toneWord[h.tone]}</span>
    </li>
  );
}

// ── 2. Findings ───────────────────────────────────────────────────────────────────────────────

function FindingsPage({ r }: { r: InsightsReport }) {
  const list = r.headlines.slice(1);
  const counts = { bad: list.filter((h) => h.tone === "bad").length, good: list.filter((h) => h.tone === "good").length, info: list.filter((h) => h.tone === "info").length };
  return (
    <>
      <Head kicker="Findings" title={r.headlines[0].title} sub={r.headlines[0].detail}>
        <div className="ci-tally"><span className="is-bad"><AlertTriangle size={14} /> {counts.bad} to fix</span><span className="is-good"><CheckCircle2 size={14} /> {counts.good} working</span><span className="is-info"><Info size={14} /> {counts.info} worth knowing</span></div>
      </Head>
      <ol className="ci-findings">{list.map((h, i) => <FindingRow key={i} h={h} n={i + 1} of={r.headlines.length - 1} />)}</ol>
    </>
  );
}

// ── 3. Money ──────────────────────────────────────────────────────────────────────────────────

function MoneyPage({ r }: { r: InsightsReport }) {
  const total = r.opportunities.reduce((s, o) => s + o.sales, 0);
  const value = r.opportunities.reduce((s, o) => s + (o.valueMinor ?? 0), 0);
  const valueOf = (sales: number) => inr(r.base.aovMinor ? sales * r.base.aovMinor : null);
  return (
    <>
      <Head kicker="Money on the table" title={`About ${num(total)} more sales from the same demos${value ? `, roughly ${inr(value)}` : ""}`} sub={`That is ${pct(total / Math.max(1, r.base.won))} more than today's ${num(r.base.won)} sales, without one extra lead. Each estimate is cautious: where cause and effect could run both ways, only half the gap is counted. Value uses the average closed deal of ${inr(r.base.aovMinor)}.`} />
      <div className="ci-grid-2 ci-fill">
        <Card title="From today's sales to what is possible" sub="Same demos, four changes" foot={`Sales today = ${num(r.base.won)} from ${num(r.base.mature)} judged demos`}>
          <Waterfall start={r.base.won} steps={r.opportunities.map((o, i) => ({ label: `#${i + 1}`, title: o.title, detail: o.detail, n: o.sales, valueMinor: o.valueMinor }))} startLabel="Today" endLabel="Possible" valueOf={valueOf} />
        </Card>
        <div className="ci-opps">
          {r.opportunities.map((o, i) => (
            <article key={o.title} className="ci-opp" tabIndex={0} data-tip={tip(o.title, [["Extra sales", `+${num(o.sales)}`], ["Value", inr(o.valueMinor)], ["Lift on today", `+${pct(o.sales / r.base.won, 1)}`], ["Share of the total upside", pct(o.sales / total)]], o.detail)}>
              <span className="ci-opp-rank">#{i + 1}</span>
              <div><h3>{o.title}</h3><p>{o.detail}</p></div>
              <div className="ci-opp-num"><b>+{num(o.sales)}</b><span>sales</span><em>{inr(o.valueMinor)}</em></div>
              <span className="ci-opp-bar" style={{ width: w(o.sales / Math.max(...r.opportunities.map((x) => x.sales))) }} />
            </article>
          ))}
        </div>
      </div>
    </>
  );
}

// ── 4. What sells ─────────────────────────────────────────────────────────────────────────────

function SellsPage({ r }: { r: InsightsReport }) {
  const [seg, setSeg] = useState<SegmentId>("source");
  const segment = r.segments[seg];
  const isSurvey = ["priceResponse", "issue", "decisionMaker", "age"].includes(seg);
  const n = segment.rows.reduce((s, x) => s + x.n, 0);
  const segBase = isSurvey && segment.rows.length ? segment.rows.reduce((s, x) => s + x.won, 0) / n : r.base.rate;
  return (
    <>
      <Head kicker="What sells" title={segment.question} sub="Pick a cut on the left. Each bar is the share of demos that became a sale; the thin whisker is the 95% likely range, so overlapping whiskers are not a real difference. Click any bar for its numbers." />
      <div className="ci-seg">
        <div className="ci-seg-pick" role="tablist" aria-label="Cut the demos by">
          {SEGMENT_GROUPS.map((g) => (
            <div key={g.title} className="ci-seg-group">
              <span>{g.title}</span>
              <div>{g.ids.map((id) => <button key={id} type="button" role="tab" aria-selected={seg === id} onClick={() => setSeg(id)}>{r.segments[id].title}</button>)}</div>
            </div>
          ))}
        </div>
        <Card title={segment.title} sub={`${segment.rows.length} groups · ${num(n)} demos · average ${pct(segBase, 1)}`} className="ci-seg-chart" foot={isSurvey ? `n = ${num(n)} surveyed demos (groups under 20 hidden)` : `n = ${num(n)} judged demos (groups under 30 hidden)`}>
          {segment.note ? <p className="ci-warn"><AlertTriangle size={14} /> {segment.note}</p> : null}
          <RateBars rows={segment.rows} base={segBase} label={(k) => AI_LABELS[k] ?? k.replace(/\s*–\s*/g, " to ")} />
        </Card>
      </div>
    </>
  );
}

// ── 5. When & mix ─────────────────────────────────────────────────────────────────────────────

function WhenPage({ r }: { r: InsightsReport }) {
  return (
    <>
      <Head kicker="When & mix" title="Month by month, hour by hour, and what we demo" sub="Hollow points are recent months still deciding. Grey months are old imported demos whose outcome was never tracked, so they are left out of every rate." />
      <Trend months={r.trend} />
      <div className="ci-grid-3 ci-mt">
        <Card title="Which day and hour sell" sub="Darker blue sells more" className="ci-span-2" foot={`n = ${num(r.heatmap.reduce((s, c) => s + c.n, 0))} judged demos with a start time`}><Heatmap cells={r.heatmap} base={r.base.rate} /></Card>
        <Card title="What we demo" sub={`${num(r.base.mature)} judged demos`} foot="Product category from the booked product title"><Donut slices={r.dataset.category} centre={num(r.base.mature)} sub="demos" note="Grouped from the product title on the booking." /></Card>
      </div>
    </>
  );
}

// ── 6. Lead score ─────────────────────────────────────────────────────────────────────────────

function ScorePage({ r }: { r: InsightsReport }) {
  const best = r.lab.results.find((m) => m.id === r.lab.best)!;
  const test = `n = ${num(r.lab.test)} test demos the model never saw`;
  return (
    <>
      <Head kicker="Lead score" title="Rank every demo by its chance to buy, then call the top first" sub={`${best.name} won a test of six models (see Technical). It ranks a random buyer above a random non-buyer ${pct(best.holdout.auc)} of the time (AUC ${best.holdout.auc.toFixed(2)}), on ${num(r.lab.test)} demos it never saw.`} />
      <div className="ci-grid-3 ci-fill">
        <Card title="Demos ranked by score, in tenths" sub="Share that bought in each tenth" foot={test}><DecileBars deciles={r.model.deciles} base={r.lab.positiveRate} /></Card>
        <Card title="How fast you find the buyers" sub="Dashed line = calling in random order" foot={test}><GainsChart gains={r.lab.gains} /></Card>
        <Card title="What moves the odds" sub="All else held equal" className="ci-tall" foot={`Logistic regression on ${num(r.base.mature)} judged demos`}><DriverBars drivers={r.model.drivers.slice(0, 11)} /></Card>
      </div>
    </>
  );
}

// ── 7. CDEs (Customer Delight Executives) ────────────────────────────────────────────────────────────────────────────

function PeoplePage({ r }: { r: InsightsReport }) {
  const above = r.consultants.filter((c) => c.won >= c.expected).length;
  const demos = r.consultants.reduce((s, c) => s + c.demos, 0);
  return (
    <>
      <Head kicker="Customer Delight Executives (CDEs)" title="Which CDEs close, once the luck of the draw is taken out" sub={`'Expected' is what an average CDE would close with the same products, hubs, sources and time slots. ${above} of ${r.consultants.length} CDEs with 30+ demos beat their mix. Click a dot or a row for the full card.`} />
      <div className="ci-grid-people ci-fill">
        <Card title="Actual vs expected close rate" sub="Above the dashed line = better than their mix" foot={`n = ${r.consultants.length} CDEs · ${num(demos)} demos`}><ConsultantScatter people={r.consultants} /></Card>
        <ConsultantTable rows={r.consultants} base={r.base.rate} />
      </div>
    </>
  );
}

type SortKey = "skill" | "rate" | "demos" | "rating" | "avgDemoMin";

function Th({ k, sort, onSort, children }: { k: SortKey; sort: SortKey; onSort: (k: SortKey) => void; children: string }) {
  return <th aria-sort={sort === k ? "descending" : "none"}><button type="button" onClick={() => onSort(k)} className={sort === k ? "is-on" : ""}>{children}</button></th>;
}

function ConsultantTable({ rows, base }: { rows: Consultant[]; base: number }) {
  const [sort, setSort] = useState<SortKey>("skill");
  const sorted = useMemo(() => [...rows].sort((a, b) => (b[sort] ?? -1) - (a[sort] ?? -1)), [rows, sort]);
  const maxSkill = Math.max(...rows.map((c) => Math.abs(c.skill)));
  return (
    <div className="ci-table-wrap ci-people-table">
      <table className="ci-table">
        <thead>
          <tr>
            <th>CDE</th>
            <Th k="demos" sort={sort} onSort={setSort}>Demos</Th>
            <Th k="rate" sort={sort} onSort={setSort}>Close</Th>
            <th>Expected</th>
            <Th k="skill" sort={sort} onSort={setSort}>Skill</Th>
            <Th k="rating" sort={sort} onSort={setSort}>Rating</Th>
            <Th k="avgDemoMin" sort={sort} onSort={setSort}>Avg demo</Th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => (
            <tr key={c.name} tabIndex={0} data-tip={consultantCard(c)}>
              <td><b>{c.name}</b><small>{c.topCategory}</small></td>
              <td>{num(c.demos)}</td>
              <td className={c.rate >= base ? "is-up" : "is-down"}>{pct(c.rate, 1)}</td>
              <td className="ci-muted">{pct(c.expected / c.demos, 1)}</td>
              <td><span className="ci-skill-cell"><SkillBar value={c.skill} max={maxSkill} /><small>{c.skill >= 0 ? "+" : "−"}{Math.abs(c.skill * 100).toFixed(1)}</small></span></td>
              <td>{c.rating ? c.rating.toFixed(1) : "n/a"}</td>
              <td>{c.avgDemoMin ? `${Math.round(c.avgDemoMin)}m` : "n/a"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── 8. The calls ──────────────────────────────────────────────────────────────────────────────

function CallsPage({ r, notes }: { r: InsightsReport; notes: CallNotes | null }) {
  const [view, setView] = useState<"read" | "topics">(notes ? "read" : "topics");
  const tabs: ["read" | "topics", string][] = notes ? [["read", "Read by Claude"], ["topics", `Topics in ${num(r.base.transcripts)} calls`]] : [["topics", `Topics in ${num(r.base.transcripts)} calls`]];
  return (
    <>
      <Head kicker="The calls" title={view === "read" ? "Why customers bought, and why they walked away" : "What customers talk about, and what it means"} sub={view === "read" && notes ? notes.method : `Searched ${num(r.base.transcripts)} call transcripts for each topic. Mentioning a topic does not cause a sale, but it shows what buyers care about.`}>
        <SubTabs value={view} onChange={setView} tabs={tabs} />
      </Head>
      {view === "read" && notes ? (
        <>
          <div className="ci-surprises">{[...notes.lost.surprises.slice(0, 2), notes.won.surprises[0]].map((s) => <p key={s} tabIndex={0} data-tip={tip("Something we did not expect", [["Calls read", `${notes.won.readable + notes.lost.readable} readable of ${notes.won.sample + notes.lost.sample}`]], s)}><Lightbulb size={14} /> {s}</p>)}</div>
          <div className="ci-grid-2"><ReadSide side={notes.won} tone="won" /><ReadSide side={notes.lost} tone="lost" /></div>
        </>
      ) : (
        <div className="ci-grid-2">
          <ThemeTable themes={r.themes} title="Topics in the call" transcripts={r.base.transcripts} />
          <ThemeTable themes={r.competitors} title="Competitors and marketplaces mentioned" transcripts={r.base.transcripts} />
        </div>
      )}
    </>
  );
}

function ThemeTable({ themes, title, transcripts }: { themes: InsightsReport["themes"]; title: string; transcripts: number }) {
  const maxShare = Math.max(...themes.map((t) => t.share));
  return (
    <Card title={title} className="ci-themes" foot={`n = ${num(transcripts)} transcripts, keyword search in English, Hindi and Kannada (Latin script)`}>
      <div className="ci-theme-head"><span>Topic</span><span>Calls that mention it</span><span>Bought</span></div>
      {[...themes].sort((a, b) => b.lift - a.lift).map((t) => (
        <div key={t.id} className="ci-theme" tabIndex={0} data-tip={tip(t.label, [["Calls mentioning it", `${num(t.n)} (${pct(t.share)})`], ["Bought", `${num(t.won)} (${pct(t.rate, 1)})`], ["Likely range (95%)", `${pct(t.lo, 1)} to ${pct(t.hi, 1)}`], ["Vs all transcribed calls", `${t.lift >= 1 ? "+" : "−"}${pct(Math.abs(t.lift - 1))}`]], "A call counts once if the topic's words appear anywhere in it. Correlation, not cause.")}>
          <span className="ci-theme-label">{t.label}</span>
          <span className="ci-theme-share"><span style={{ width: w(t.share / maxShare) }} /><small>{pct(t.share)}</small></span>
          <span className={`ci-theme-lift ${t.lift >= 1.15 ? "is-up" : t.lift <= 0.87 ? "is-down" : ""}`}>{pct(t.rate)}<small>{t.lift >= 1 ? "+" : "−"}{pct(Math.abs(t.lift - 1))}</small></span>
        </div>
      ))}
    </Card>
  );
}

function ReadSide({ side, tone }: { side: CallNotes["won"]; tone: "won" | "lost" }) {
  return (
    <div className={`ci-read is-${tone}`}>
      <h3>{tone === "won" ? <ThumbsUp size={16} /> : <ThumbsDown size={16} />} {tone === "won" ? "Calls that sold" : "Calls that didn't"} <small>{side.readable} of {side.sample} readable</small></h3>
      {side.groups.slice(0, 2).map((g) => (
        <div key={g.id} className="ci-read-group">
          <h4>{g.title}</h4>
          <ul>
            {[...g.items].sort((a, b) => b.count - a.count).map((it) => (
              <li key={it.label} tabIndex={0} data-tip={tip(it.label, [["Calls showing it", `${it.count} of ${side.readable}`], ["Share of readable calls", pct(it.count / side.readable)], ["Group", g.title]], it.detail)}>
                <span className="ci-read-label">{it.label}</span>
                <span className="ci-read-track"><span style={{ width: w(it.count / side.readable) }} /></span>
                <b>{it.count}</b>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ── 9. Data health ────────────────────────────────────────────────────────────────────────────

function DataPage({ r }: { r: InsightsReport }) {
  const [view, setView] = useState<"overview" | "fields">("overview");
  const d = r.dataset;
  const [rows, valid, tracked, judged, sold] = d.funnel.map((f) => f.n);
  const tx = (label: string) => d.transcriptSource.find((s) => s.label === label)?.n ?? 0;
  const txAll = tx("Transcript from Metabase") + tx("Transcript from Partner dashboard");
  const overwritten = r.quality.find((q) => /overwritten/.test(q.label));
  const grade = d.healthScore >= 80 ? "Good" : d.healthScore >= 60 ? "Fair" : "Weak";
  const core = d.coverage.filter((c) => !/Phone matches/.test(c.label));
  return (
    <>
      <Head kicker="Data health" title={`The data is ${grade.toLowerCase()}: ${d.healthScore} out of 100`} sub={r.outcomeRule}>
        <SubTabs value={view} onChange={setView} tabs={[["overview", "Overview"], ["fields", "Fields & fixes"]]} />
      </Head>
      {view === "overview" ? (
        <>
          <div className="ci-grid-3">
            <Card title="Health score" sub={`Average completeness of ${core.length} core fields`} foot={`n = ${num(valid)} demos with a valid date`}>
              <Gauge value={d.healthScore} label={grade} card={tip("Data health score", core.map((c) => [c.label, pct(c.n / c.of)] as [string, string]), "The plain average of how complete each core field is. 80+ is good, 60 to 79 is fair.")} />
            </Card>
            <Card title="How clean is this data" className="ci-note">
              <p>
                We processed <b>{num(rows)}</b> rows from {r.source.file}. <b>{num(rows - valid)}</b> had a broken or future date and were dropped.
                Outcomes were only tracked from <b>{month(d.trackedFrom)}</b>, so <b>{num(valid - tracked)}</b> older imported demos were set aside, and <b>{num(tracked - judged)}</b> are too recent to judge.
                That leaves <b>{num(judged)}</b> demos ({pct(judged / rows)} of the sheet) to measure, with <b>{num(sold)}</b> sales.
              </p>
              <p>
                <b>{num(txAll)}</b> demos ({pct(txAll / valid)}) have a readable call transcript: {num(tx("Transcript from Metabase"))} from Metabase and {num(tx("Transcript from Partner dashboard"))} from the partner dashboard.
                {" "}<b>{num(tx("Recorded, no transcript"))}</b> were recorded but never transcribed, and <b>{num(tx("Not recorded"))}</b> were never recorded.
                {overwritten ? <> The CDE survey survives on {num(r.base.surveyed)} demos, but closing a deal wipes it on <b>{num(overwritten.count)} of {num(overwritten.of)}</b> sales.</> : null}
              </p>
            </Card>
            <Card title="Call recordings" sub={`${num(valid)} demos with a valid date`} foot="Transcript Source and Audio Recorded columns">
              <Donut slices={d.transcriptSource} centre={pct(txAll / valid)} sub="transcribed" colours={["#2a78d6", "#c3c2b7", "#eda100", "#1baf7a"]} note="A transcript counts when it is longer than 400 characters." />
            </Card>
          </div>
          <Card title="From sheet to answer" sub="Rows kept at each step; click a step for what was dropped" className="ci-mt" foot={`Started from ${num(rows)} rows`}><Funnel steps={d.funnel} /></Card>
        </>
      ) : (
        <div className="ci-grid-2">
          <Card title="How complete each field is" sub="Out of every demo with a valid date" foot={`n = ${num(valid)} demos`}><Coverage rows={d.coverage} /></Card>
          <Card title="What to fix" sub="Each count out of the rows it applies to">
            <ul className="ci-quality">
              {r.quality.map((q) => (
                <li key={q.label} tabIndex={0} data-tip={tip(q.label, [["Affected", num(q.count)], ["Out of", num(q.of)], ["Share", pct(q.count / q.of, 1)]], q.note)}>
                  <span className="ci-q-n"><b>{num(q.count)}</b><small>of {num(q.of)}</small></span>
                  <span className="ci-q-text"><strong>{q.label}</strong><span className="ci-q-bar"><span style={{ width: w(q.count / q.of) }} /></span></span>
                  <span className="ci-q-pct">{pct(q.count / q.of)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}

// ── 10. Technical ─────────────────────────────────────────────────────────────────────────────

function TechPage({ r }: { r: InsightsReport }) {
  const L = r.lab;
  const [view, setView] = useState<"board" | "diag" | "method">("board");
  const [active, setActive] = useState(L.best);
  const names = Object.fromEntries(L.results.map((m) => [m.id, m.name]));
  const aucs = Object.fromEntries(L.results.map((m) => [m.id, m.holdout.auc]));
  const best = L.results.find((m) => m.id === L.best)!;
  const ai = L.results.find((m) => m.id === "aiflag");
  const base = L.results.find((m) => m.id === "base")!;
  const maxDrop = Math.max(...L.importance.map((i) => i.drop), 0.001);
  const modelCard = (m: (typeof L.results)[number]) => tip(m.name, [
    ["F1 (test demos)", m.holdout.f1.toFixed(3)],
    ["F1 across 5 folds", `${m.cv.f1.toFixed(3)} ± ${m.cv.f1Sd.toFixed(3)}`],
    ["Precision", m.holdout.precision.toFixed(3)],
    ["Recall", m.holdout.recall.toFixed(3)],
    ["AUC", `${m.holdout.auc.toFixed(3)} (folds ${m.cv.auc.toFixed(3)} ± ${m.cv.aucSd.toFixed(3)})`],
    ["Accuracy", m.holdout.accuracy.toFixed(3)],
    ["Brier", m.holdout.brier.toFixed(3)],
    ["Cut-off for 'will buy'", pct(m.holdout.threshold, 1)],
    ["Test demos", num(m.n)],
  ], `${m.kind}. ${m.about}`);
  const test = `n = ${num(L.test)} test demos · ${L.folds}-fold cross-validation over ${num(L.train + L.test)}`;
  return (
    <>
      <Head kicker="Technical" title="Six models, one honest test" sub={`Each model learns from the same ${L.importance.length} facts about ${num(L.train + L.test)} demos (${pct(L.positiveRate, 1)} bought). ${L.folds}-fold cross-validation: every demo is tested once by a model that never saw it. The cut-off for "will buy" is picked on held-back training data, never on the test.`}>
        <SubTabs value={view} onChange={setView} tabs={[["board", "Scoreboard"], ["diag", "Diagnostics"], ["method", "Method & terms"]]} />
      </Head>
      {view === "board" ? (
        <>
          <div className="ci-table-wrap ci-models">
            <table className="ci-table">
              <thead>
                <tr><th>Model</th><th>How it works</th><th>F1</th><th>Precision</th><th>Recall</th><th>AUC</th><th>Brier</th><th>F1 across {L.folds} folds</th></tr>
              </thead>
              <tbody>
                {L.results.map((m) => (
                  <tr key={m.id} className={m.id === L.best ? "is-best" : m.id === "base" || m.id === "aiflag" ? "is-ref" : ""} tabIndex={0} data-tip={modelCard(m)}>
                    <td><b>{m.name}</b>{m.id === L.best ? <em className="ci-badge">Best</em> : null}</td>
                    <td className="ci-muted ci-wrap">{m.kind}</td>
                    <td><Metric v={m.holdout.f1} max={0.6} strong /></td>
                    <td><Metric v={m.holdout.precision} max={1} /></td>
                    <td><Metric v={m.holdout.recall} max={1} /></td>
                    <td><Metric v={m.holdout.auc} max={1} /></td>
                    <td className="ci-muted">{m.holdout.brier.toFixed(3)}</td>
                    <td>{m.cv.f1.toFixed(3)} <small className="ci-muted">± {m.cv.f1Sd.toFixed(3)}</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ci-grid-2 ci-mt">
            <Card title="F1 score, averaged over 5 folds" sub="Whisker = spread between folds" foot={test}><ScoreBars rows={L.results.map((m) => ({ id: m.id, name: m.name, value: m.cv.f1, sd: m.cv.f1Sd, card: modelCard(m) }))} best={L.best} /></Card>
            <Card title="What this means" className="ci-note">
              <ul className="ci-bullets">
                <li><b>{best.name}</b> scores F1 {best.cv.f1.toFixed(2)}, against {base.cv.f1.toFixed(2)} for guessing everyone buys{ai ? ` and ${ai.cv.f1.toFixed(2)} for today's AI hot-lead flag` : ""}.</li>
                <li>AUC {best.holdout.auc.toFixed(2)} means it ranks well enough to decide <b>who to call first</b>, not to write anyone off.</li>
                <li>Simple models do as well as complex ones here: the limit is the data ({L.importance.length} facts per demo), not the maths. Richer data (website visits from PostHog, past purchases) is the next lever.</li>
                <li>Left out on purpose: the CDE survey (wiped when a deal closes, so it leaks the answer) and the CDE&apos;s own name.</li>
              </ul>
            </Card>
          </div>
        </>
      ) : view === "diag" ? (
        <div className="ci-grid-4">
          <Card title="ROC curves" sub="Pick a model to colour it" foot={test}>
            <div className="ci-chips">{L.roc.map((c) => <button key={c.id} type="button" aria-pressed={active === c.id} onClick={() => setActive(c.id)}>{names[c.id]} <small>{aucs[c.id]?.toFixed(2)}</small></button>)}</div>
            <RocChart curves={L.roc} names={names} aucs={aucs} active={active} />
          </Card>
          <Card title={`${best.name}: right and wrong`} sub={`Cut-off ${pct(L.confusion.threshold, 1)}`} foot={test}><Confusion c={L.confusion} /></Card>
          <Card title="Are the chances honest?" sub="Predicted vs actual, in tenths" foot={test}><CalibrationChart bins={L.calibration} /></Card>
          <Card title="Which facts the model leans on" sub="Drop in AUC when a fact is shuffled" foot="Permutation importance, 2 shuffles each">
            <div className="ci-imp">
              {L.importance.map((i, k) => (
                <div key={i.group} className="ci-imp-row" tabIndex={0} data-tip={tip(i.group, [["AUC drop when shuffled", i.drop.toFixed(4)], ["Rank", `${k + 1} of ${L.importance.length}`], ["Model", best.name]], "Shuffle one fact across the test demos and re-score. The bigger the drop, the more the model relies on that fact.")}>
                  <span>{i.group}</span>
                  <span className="ci-imp-track"><span style={{ width: w(Math.max(0, i.drop) / maxDrop) }} /></span>
                  <b>{i.drop.toFixed(3)}</b>
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : (
        <div className="ci-grid-2">
          <Card title="How the test was run" className="ci-note">
            <ul className="ci-bullets">
              <li><b>Target:</b> {r.outcomeRule}</li>
              <li><b>Population:</b> {num(L.train + L.test)} demos from {month(r.dataset.trackedFrom)} to {month(r.dataset.matureBefore)}, outcome tracked and 2+ weeks old. {pct(L.positiveRate, 1)} bought.</li>
              <li><b>Facts per demo ({L.importance.length}):</b> {L.importance.map((i) => i.group).join(", ")}. Each is one-hot encoded.</li>
              <li><b>Split:</b> {L.folds} folds by a hash of the booking ID, so every run is repeatable. In each fold, 20% of the training demos pick the F1-best cut-off; the test fold is never touched until scoring.</li>
              <li><b>Models:</b> gradient boosting (160 depth-3 trees, learning rate 0.08), random forest (60 trees, depth 10), L2 logistic regression, one decision tree (depth 6), Bernoulli naive Bayes, and a no-model floor. All written from scratch, no customer data leaves this laptop.</li>
              <li><b>Leakage guards:</b> the CDE survey is excluded (closing a deal overwrites it), and months whose outcomes were never tracked are dropped.</li>
            </ul>
          </Card>
          <Card title="Words used on these pages">
            <dl className="ci-gloss">
              <div><dt>CDE</dt><dd>Customer Delight Executive: the person who runs the demo at the customer&apos;s home or on video.</dd></div>
              <div><dt>Precision</dt><dd>Of the demos the model says will buy, how many did.</dd></div>
              <div><dt>Recall</dt><dd>Of everyone who bought, how many the model caught.</dd></div>
              <div><dt>F1</dt><dd>One number balancing precision and recall (their harmonic mean). 1 is perfect.</dd></div>
              <div><dt>AUC</dt><dd>Chance the model ranks a random buyer above a random non-buyer. 0.5 is a coin toss.</dd></div>
              <div><dt>Brier</dt><dd>Average squared gap between predicted chance and what happened. Lower is better.</dd></div>
              <div><dt>Cross-validation</dt><dd>Split the demos into {L.folds} parts; train on {L.folds - 1}, test on the one left out; repeat for each part.</dd></div>
              <div><dt>95% likely range</dt><dd>Wilson interval around a rate. Overlapping ranges may differ by chance.</dd></div>
              <div><dt>Odds ratio</dt><dd>How much a fact multiplies the odds of a sale with everything else held equal.</dd></div>
            </dl>
          </Card>
        </div>
      )}
    </>
  );
}

function Metric({ v, max, strong }: { v: number; max: number; strong?: boolean }) {
  return (
    <span className={`ci-metric ${strong ? "is-strong" : ""}`}>
      <b>{v.toFixed(3)}</b>
      <span><span style={{ width: w(Math.min(1, v / max)) }} /></span>
    </span>
  );
}

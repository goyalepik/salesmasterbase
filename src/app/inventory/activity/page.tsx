import { Suspense } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { BlockedState } from "@/components/blocked-state";
import { InventoryTabs } from "@/components/ops/inventory-tabs";
import { SectionSkeleton } from "@/components/ops/overview";
import type { OpsStore } from "@/lib/ops/store";
import type { StockMovement } from "@/lib/ops/types";
import { inwardSource, KIND_WORDS, rangeBounds, summariseActivity, type ActivityRange, type Bucket } from "@/lib/ops-ui/activity";
import { requestNow } from "@/lib/ops-ui/format";
import { loadOps } from "@/lib/ops-ui/load";
import { firstParam } from "@/lib/query";

const RANGES: Array<{ id: ActivityRange; label: string }> = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "week", label: "Last 7 days" },
];

// Validated pair (colour-blind safe, 3:1 on white): blue for in, orange for out.
const IN = "#2a78d6";
const OUT = "#d9622b";

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [ops, params] = await Promise.all([loadOps(), searchParams]);
  if (ops.kind !== "ready") return <BlockedState health={ops.workspace.health} />;
  const raw = firstParam(params.range);
  const range: ActivityRange = raw === "yesterday" || raw === "week" ? raw : "today";
  return (
    <section className="ta">
      <InventoryTabs store={ops.store} current="activity" />
      <div className="ta-head">
        <div>
          <h1>Today&apos;s activity</h1>
          <p>Every unit that came in or went out. Nothing is typed over; each line shows who did it.</p>
        </div>
        <nav className="iv-seg" aria-label="Period">
          {RANGES.map((r) => (
            <Link key={r.id} href={r.id === "today" ? "/inventory/activity" : `/inventory/activity?range=${r.id}`} aria-current={range === r.id ? "page" : undefined} scroll={false}>{r.label}</Link>
          ))}
        </nav>
      </div>
      <Suspense key={range} fallback={<SectionSkeleton height={640} />}>
        <Activity store={ops.store} range={range} />
      </Suspense>
    </section>
  );
}

async function Activity({ store, range }: { store: OpsStore; range: ActivityRange }) {
  const now = new Date(requestNow());
  const { from } = rangeBounds(range, now);
  const [moves, levels] = await Promise.all([
    store.movementsSince(from.toISOString(), ["inward", "dispatch", "return", "rtv", "adjust"], 5000),
    store.stockLevels({ only: "all", limit: 10_000 }),
  ]);
  const names = new Map(levels.map((l) => [l.sku, l.name]));
  const s = summariseActivity(moves, range, now);
  const net = s.unitsIn - s.unitsOut;
  const busiest = [...s.buckets].sort((a, b) => b.in + b.out - (a.in + a.out))[0];
  const period = range === "week" ? "in 7 days" : range === "yesterday" ? "yesterday" : "today";
  return (
    <div className="grid gap-3">
      <dl className="ta-stats">
        <div className="is-in">
          <dt><ArrowDownLeft size={15} /> Came in</dt>
          <dd>{s.unitsIn.toLocaleString("en-IN")}</dd>
          <p>{s.productsIn} product{s.productsIn === 1 ? "" : "s"}</p>
        </div>
        <div className="is-out">
          <dt><ArrowUpRight size={15} /> Went out</dt>
          <dd>{s.unitsOut.toLocaleString("en-IN")}</dd>
          <p>{s.ordersOut} order{s.ordersOut === 1 ? "" : "s"} shipped</p>
        </div>
        <div>
          <dt>Net change</dt>
          <dd>{net > 0 ? `+${net}` : net}</dd>
          <p>units {period}</p>
        </div>
        <div>
          <dt>Busiest {range === "week" ? "day" : "hour"}</dt>
          <dd className="!text-[22px]">{busiest && busiest.in + busiest.out ? busiest.label : "—"}</dd>
          <p>{busiest && busiest.in + busiest.out ? `${busiest.in} in · ${busiest.out} out` : "Nothing moved"}</p>
        </div>
      </dl>

      <section className="ta-card">
        <header className="ta-card-head">
          <h2>In and out {range === "week" ? "by day" : "by hour"}</h2>
          <div className="ta-legend">
            <span><i style={{ background: IN }} /> In</span>
            <span><i style={{ background: OUT }} /> Out</span>
          </div>
        </header>
        <MirrorChart buckets={s.buckets} range={range} />
      </section>

      <div className="ta-lists">
        <MoveList title="Incoming" tone="in" moves={s.incoming} breakdown={s.byKindIn} names={names} source={inwardSource} empty={`Nothing came in ${period}.`} />
        <MoveList title="Outgoing" tone="out" moves={s.outgoing} breakdown={s.byKindOut} names={names} source={(m) => KIND_WORDS[m.kind]} empty={`Nothing went out ${period}.`} />
      </div>
    </div>
  );
}

/** Mirrored bars: units in grow up from the middle line, units out grow down. Hover a column for its numbers. */
function MirrorChart({ buckets, range }: { buckets: Bucket[]; range: ActivityRange }) {
  const W = 1000, H = 250, left = 40, right = 8, top = 18, mid = 120, half = 96;
  const max = Math.max(1, ...buckets.map((b) => Math.max(b.in, b.out)));
  const slot = (W - left - right) / buckets.length;
  const bar = Math.min(24, slot * 0.62);
  const y = (n: number) => (n / max) * half;
  const peakIn = buckets.reduce((p, b, i) => (b.in > (buckets[p]?.in ?? 0) ? i : p), 0);
  const peakOut = buckets.reduce((p, b, i) => (b.out > (buckets[p]?.out ?? 0) ? i : p), 0);
  const up = (x: number, h: number) => {
    const r = Math.min(4, h, bar / 2);
    return `M${x},${mid} V${mid - h + r} Q${x},${mid - h} ${x + r},${mid - h} H${x + bar - r} Q${x + bar},${mid - h} ${x + bar},${mid - h + r} V${mid} Z`;
  };
  const down = (x: number, h: number) => {
    const r = Math.min(4, h, bar / 2);
    return `M${x},${mid + 1} V${mid + 1 + h - r} Q${x},${mid + 1 + h} ${x + r},${mid + 1 + h} H${x + bar - r} Q${x + bar},${mid + 1 + h} ${x + bar},${mid + 1 + h - r} V${mid + 1} Z`;
  };
  const showLabel = (i: number) => range === "week" || i % 3 === 0;
  return (
    <svg className="ta-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Units in and out ${range === "week" ? "per day" : "per hour"}. Most in one ${range === "week" ? "day" : "hour"}: ${buckets[peakIn]?.in ?? 0}. Most out: ${buckets[peakOut]?.out ?? 0}.`}>
      <line x1={left} x2={W - right} y1={mid - half} y2={mid - half} className="ta-grid" />
      <line x1={left} x2={W - right} y1={mid + 1 + half} y2={mid + 1 + half} className="ta-grid" />
      <text x={left - 8} y={mid - half + 4} className="ta-axis" textAnchor="end">{max}</text>
      <text x={left - 8} y={mid + 4} className="ta-axis" textAnchor="end">0</text>
      <text x={left - 8} y={mid + 1 + half + 4} className="ta-axis" textAnchor="end">{max}</text>
      {buckets.map((b, i) => {
        const x = left + i * slot + (slot - bar) / 2;
        return (
          <g key={b.key} className="ta-col">
            <title>{`${b.label}: ${b.in} in, ${b.out} out`}</title>
            <rect x={left + i * slot} y={top - 10} width={slot} height={H - top} className="ta-hit" />
            {b.in ? <path d={up(x, Math.max(2, y(b.in)))} fill={IN} /> : null}
            {b.out ? <path d={down(x, Math.max(2, y(b.out)))} fill={OUT} /> : null}
            {b.in && i === peakIn ? <text x={x + bar / 2} y={mid - y(b.in) - 6} className="ta-val" textAnchor="middle">{b.in}</text> : null}
            {b.out && i === peakOut ? <text x={x + bar / 2} y={mid + 1 + y(b.out) + 14} className="ta-val" textAnchor="middle">{b.out}</text> : null}
            {showLabel(i) ? <text x={left + i * slot + slot / 2} y={H - 4} className="ta-axis" textAnchor="middle">{b.label}</text> : null}
          </g>
        );
      })}
      <line x1={left} x2={W - right} y1={mid + 0.5} y2={mid + 0.5} className="ta-base" />
    </svg>
  );
}

function MoveList({
  title,
  tone,
  moves,
  breakdown,
  names,
  source,
  empty,
}: {
  title: string;
  tone: "in" | "out";
  moves: StockMovement[];
  breakdown: Array<[string, number]>;
  names: Map<string, string>;
  source: (m: StockMovement) => string;
  empty: string;
}) {
  const time = (iso: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  return (
    <section className={`ta-card ta-list is-${tone}`}>
      <header className="ta-card-head">
        <h2>{title}</h2>
        <span className="ta-count">{moves.reduce((s, m) => s + Math.abs(m.qty), 0)} units</span>
      </header>
      {breakdown.length ? (
        <p className="ta-break">{breakdown.map(([word, n]) => <span key={word}>{word} <b>{n}</b></span>)}</p>
      ) : null}
      {!moves.length ? (
        <p className="ta-empty">{empty}</p>
      ) : (
        <ul>
          {moves.slice(0, 40).map((m) => (
            <li key={m.id}>
              <span className="ta-qty">{tone === "in" ? "+" : "−"}{Math.abs(m.qty)}</span>
              <span className="ta-what">
                <span className="ta-name" title={names.get(m.sku) ?? m.sku}>{names.get(m.sku) ?? m.sku}</span>
                <span className="ta-sub">
                  {m.refType === "order" && m.refId ? <Link href={`/orders/${encodeURIComponent(m.refId)}`} className="text-info">{m.refId}</Link> : source(m)}
                  {m.serialNo ? ` · ${m.serialNo}` : ""}
                </span>
              </span>
              <span className="ta-when">{time(m.createdAt)}<br /><span>{m.actor}</span></span>
            </li>
          ))}
          {moves.length > 40 ? <li className="ta-more">+{moves.length - 40} more</li> : null}
        </ul>
      )}
    </section>
  );
}

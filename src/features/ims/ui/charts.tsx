import Link from "next/link";
import { units } from "./format";

// Small server-drawn charts: nothing to load on the phone. One axis each, thin rounded bars, a legend when there are
// two series, and the number written on every bar a reader needs.

const IN = "#0e7490";
const OUT = "#f59e0b";

/** Units in and out per week, last 8 weeks. */
export function WeeklyInOut({ weeks }: { weeks: Array<{ label: string; in: number; out: number }> }) {
  const W = 560, H = 190, top = 18, bottom = 24, left = 4;
  const max = Math.max(1, ...weeks.flatMap((w) => [w.in, w.out]));
  const slot = (W - left) / weeks.length;
  const bar = Math.min(16, slot / 3.2);
  const y = (v: number) => top + (H - top - bottom) * (1 - v / max);
  return (
    <>
      <svg className="ims-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Units received and dispatched per week, last 8 weeks">
        {[0.5, 1].map((f) => (
          <line key={f} x1={0} x2={W} y1={y(max * f)} y2={y(max * f)} stroke="#eef0f3" />
        ))}
        <line x1={0} x2={W} y1={H - bottom} y2={H - bottom} stroke="#d5d9e0" />
        {weeks.map((w, i) => {
          const cx = left + slot * i + slot / 2;
          return (
            <g key={w.label}>
              {[{ v: w.in, c: IN, dx: -bar - 1 }, { v: w.out, c: OUT, dx: 1 }].map((b, j) => (
                <g key={j}>
                  <rect x={cx + b.dx} y={y(b.v)} width={bar} height={Math.max(0, H - bottom - y(b.v))} rx={3} fill={b.c}>
                    <title>{`Week of ${w.label}: ${b.v} ${j ? "out" : "in"}`}</title>
                  </rect>
                  {b.v ? <text x={cx + b.dx + bar / 2} y={y(b.v) - 4} textAnchor="middle" className="v">{b.v}</text> : null}
                </g>
              ))}
              <text x={cx} y={H - 7} textAnchor="middle">{w.label}</text>
            </g>
          );
        })}
      </svg>
      <div className="ims-legend">
        <span><i style={{ background: IN }} />Received</span>
        <span><i style={{ background: OUT }} />Dispatched</span>
      </div>
    </>
  );
}

/** Horizontal bars with the value at the end; each row can open a list. */
export function HBars({ rows, colour = IN }: { rows: Array<{ label: string; value: number; text: string; href?: string }>; colour?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="ims-hbars">
      {rows.map((r) => {
        const inner = (
          <>
            <span title={r.label}>{r.label}</span>
            <span className="ims-hbar-track"><i style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: colour }} /></span>
            <b>{r.text}</b>
          </>
        );
        return r.href ? <Link key={r.label} href={r.href} className="ims-hbar">{inner}</Link> : <div key={r.label} className="ims-hbar">{inner}</div>;
      })}
    </div>
  );
}

export const unitsText = (n: number) => `${units(n)} units`;

import Link from "next/link";
import { CATEGORY_COLOURS, type Category } from "../domain/categories";
import { day, money, units } from "./format";

// Server-drawn charts (nothing to load on the phone): one axis each, a legend whenever there are two series, a
// <title> on every mark for hover, and the number written where a reader needs it.

/** Stock value over time (area). */
export function TrendArea({ points, height = 220 }: { points: Array<{ day: string; value: number; units: number }>; height?: number }) {
  const W = 760, H = height, top = 16, bottom = 26, left = 52;
  const max = Math.max(1, ...points.map((p) => p.value)) * 1.08;
  const x = (i: number) => left + ((W - left - 8) * i) / Math.max(1, points.length - 1);
  const y = (v: number) => top + (H - top - bottom) * (1 - v / max);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1)},${H - bottom} L${x(0)},${H - bottom} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => max * f);
  const last = points[points.length - 1];
  const labels = points.filter((_, i) => i % 15 === 0 || i === points.length - 1);
  return (
    <svg className="ims-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Stock value over the last ${points.length} days, now ${money(last?.value ?? 0)}`}>
      <defs>
        <linearGradient id="ims-area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#8b7bff" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#8b7bff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={left} x2={W} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.05)" />
          <text x={left - 8} y={y(t) + 4} textAnchor="end">{t ? money(t).replace("₹", "") : "0"}</text>
        </g>
      ))}
      <path d={area} fill="url(#ims-area)" />
      <path d={line} fill="none" stroke="#a99cff" strokeWidth={2.2} strokeLinejoin="round" />
      {points.map((p, i) => (
        <rect key={p.day} x={x(i) - (W - left) / points.length / 2} y={top} width={(W - left) / points.length} height={H - top - bottom} fill="transparent">
          <title>{`${day(p.day)}: ${money(p.value)}, ${units(p.units)} units`}</title>
        </rect>
      ))}
      {last ? (
        <g>
          <circle cx={x(points.length - 1)} cy={y(last.value)} r={5} fill="#fff" stroke="#8b7bff" strokeWidth={3} />
        </g>
      ) : null}
      {labels.map((p) => (
        <text key={p.day} x={x(points.indexOf(p))} y={H - 7} textAnchor="middle">{day(p.day)}</text>
      ))}
    </svg>
  );
}

/** Value by category (donut + list). */
export function CategoryDonut({ rows, total, href = (c: string) => `/ims/stock?cat=${encodeURIComponent(c)}` }: { rows: Array<{ category: Category; value: number; units: number }>; total: number; href?: (c: string) => string }) {
  const r = 42, c = 2 * Math.PI * r;
  const shown = rows.filter((x) => x.value > 0);
  const top = shown.slice(0, 6);
  const rest = shown.slice(6);
  const legend = [...top.map((x) => ({ label: x.category, value: x.value, colour: CATEGORY_COLOURS[x.category] })), ...(rest.length ? [{ label: `${rest.length} more`, value: rest.reduce((s, x) => s + x.value, 0), colour: "#3b4152" }] : [])];
  const arcs = shown.map((x, i) => {
    const offset = shown.slice(0, i).reduce((s, p) => s + (p.value / total) * c, 0);
    const len = (x.value / total) * c;
    return { key: x.category, colour: CATEGORY_COLOURS[x.category], dash: Math.max(0.4, len - 1.5), offset, title: `${x.category}: ${money(x.value)} (${Math.round((x.value / total) * 100)}%)` };
  });
  return (
    <div className="ims-donut-wrap">
      <svg width={150} height={150} viewBox="0 0 100 100" role="img" aria-label="Stock value by category">
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={12} />
        {arcs.map((a) => (
          <circle key={a.key} cx="50" cy="50" r={r} fill="none" stroke={a.colour} strokeWidth={12} strokeDasharray={`${a.dash} ${c - a.dash}`} strokeDashoffset={-a.offset} transform="rotate(-90 50 50)"><title>{a.title}</title></circle>
        ))}
        <text x="50" y="49" textAnchor="middle" style={{ fontSize: 13, fontWeight: 650, fill: "#eef0f6" }}>{money(total).replace(" Cr", "Cr").replace(" L", "L")}</text>
        <text x="50" y="61" textAnchor="middle" style={{ fontSize: 7.5, fill: "#8a92a6" }}>at cost</text>
      </svg>
      <div className="ims-donut-list">
        {legend.map((l) => (
          <Link key={l.label} href={l.label.endsWith("more") ? "/ims/finance#categories" : href(l.label)}>
            <i style={{ background: l.colour }} />
            <span>{l.label}</span>
            <b>{money(l.value)}</b>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Units in + out per day, 12 weeks × 7 days. */
export function ActivityHeat({ days }: { days: Array<{ day: string; in: number; out: number }> }) {
  const max = Math.max(1, ...days.map((d) => d.in + d.out));
  const weeks: Array<typeof days> = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  // Rows are weekdays; the first day's weekday decides the row offset.
  const first = new Date(`${days[0].day}T00:00:00Z`).getUTCDay();
  const rowOf = (i: number) => (first + 6 + i) % 7;
  const grid: Array<Array<{ day: string; in: number; out: number } | null>> = Array.from({ length: 7 }, () => Array(weeks.length).fill(null));
  days.forEach((d, i) => { grid[rowOf(i)][Math.floor(i / 7)] = d; });
  const shade = (n: number) => (n === 0 ? "rgba(255,255,255,0.04)" : `rgba(139,123,255,${0.18 + 0.82 * Math.min(1, n / max)})`);
  return (
    <>
      <div className="ims-heat" style={{ gridTemplateColumns: `30px repeat(${weeks.length}, minmax(0,1fr))` }}>
        {grid.map((row, r) => (
          <div key={r} style={{ display: "contents" }}>
            <span>{r % 2 === 0 ? names[r] : ""}</span>
            {row.map((d, c) => <i key={c} style={{ background: d ? shade(d.in + d.out) : "transparent" }} title={d ? `${day(d.day)}: ${d.in} in, ${d.out} out` : undefined} />)}
          </div>
        ))}
      </div>
      <div className="ims-legend" style={{ marginTop: 10 }}>
        <span>Less</span>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => <i key={f} style={{ background: shade(f * max), width: 14, height: 9, marginRight: 0 }} />)}
        <span>More units moved</span>
      </div>
    </>
  );
}

/** A half-ring score made of segments (stock health). */
export function Gauge({ value, label }: { value: number; label: string }) {
  const n = 24;
  const on = Math.round((value / 100) * n);
  return (
    <svg className="ims-chart" viewBox="0 0 220 128" role="img" aria-label={`${label}: ${value}%`}>
      {Array.from({ length: n }, (_, i) => {
        const a = Math.PI - (Math.PI * (i + 0.5)) / n;
        const x1 = 110 + Math.cos(a) * 70, y1 = 112 - Math.sin(a) * 70, x2 = 110 + Math.cos(a) * 96, y2 = 112 - Math.sin(a) * 96;
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={i < on ? `hsl(${250 - i * 1.5} 90% ${70 - i * 0.6}%)` : "rgba(255,255,255,0.08)"} strokeWidth={9} strokeLinecap="round" />;
      })}
      <text x="110" y="100" textAnchor="middle" style={{ fontSize: 34, fontWeight: 650, fill: "#eef0f6" }}>{value}%</text>
      <text x="110" y="122" textAnchor="middle" style={{ fontSize: 11, fill: "#8a92a6" }}>{label}</text>
    </svg>
  );
}

/** Horizontal bars with the value at the end. */
export function Bars({ rows, colour = "#8b7bff" }: { rows: Array<{ label: string; value: number; text: string; href?: string; colour?: string }>; colour?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="ims-bars">
      {rows.map((r) => {
        const inner = (
          <>
            <span title={r.label}>{r.label}</span>
            <span className="ims-bar-track"><i style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: r.colour ?? colour }} /></span>
            <b>{r.text}</b>
          </>
        );
        return r.href ? <Link key={r.label} href={r.href} className="ims-bar">{inner}</Link> : <div key={r.label} className="ims-bar">{inner}</div>;
      })}
    </div>
  );
}

/** Two series per month (received vs dispatched at cost), grouped bars with a legend. */
export function MonthBars({ months }: { months: Array<{ label: string; receivedCost: number; dispatchedCost: number }> }) {
  const W = 620, H = 220, top = 20, bottom = 26;
  const max = Math.max(1, ...months.flatMap((m) => [m.receivedCost, m.dispatchedCost])) * 1.1;
  const slot = W / months.length;
  const bw = Math.min(26, slot / 3.4);
  const y = (v: number) => top + (H - top - bottom) * (1 - v / max);
  return (
    <>
      <svg className="ims-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Received vs dispatched at cost per month">
        {[0.5, 1].map((f) => <line key={f} x1={0} x2={W} y1={y((max / 1.1) * f)} y2={y((max / 1.1) * f)} stroke="rgba(255,255,255,0.05)" />)}
        {months.map((m, i) => {
          const cx = slot * i + slot / 2;
          return (
            <g key={m.label}>
              {[{ v: m.receivedCost, c: "#8b7bff", dx: -bw - 2, t: "received" }, { v: m.dispatchedCost, c: "#22d3ee", dx: 2, t: "dispatched" }].map((b) => (
                <g key={b.t}>
                  <rect x={cx + b.dx} y={y(b.v)} width={bw} height={Math.max(0, H - bottom - y(b.v))} rx={4} fill={b.c}><title>{`${m.label}: ${money(b.v)} ${b.t}`}</title></rect>
                  {b.v ? <text x={cx + b.dx + bw / 2} y={y(b.v) - 5} textAnchor="middle" style={{ fill: "#c3c8d6", fontSize: 10 }}>{money(b.v).replace("₹", "")}</text> : null}
                </g>
              ))}
              <text x={cx} y={H - 7} textAnchor="middle">{m.label}</text>
            </g>
          );
        })}
      </svg>
      <div className="ims-legend" style={{ marginTop: 6 }}>
        <span><i style={{ background: "#8b7bff" }} />Received (cost)</span>
        <span><i style={{ background: "#22d3ee" }} />Dispatched (cost)</span>
      </div>
    </>
  );
}

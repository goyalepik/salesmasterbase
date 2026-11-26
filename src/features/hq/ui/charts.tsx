import { day, inr } from "./fmt";

/** Bars per day (one series), value on hover; optional second thin series below as a separate strip. */
export function DayBars({ points, colour = "#f2643a", height = 200, money = true }: { points: Array<{ day: string; v: number }>; colour?: string; height?: number; money?: boolean }) {
  const W = 760, H = height, top = 14, bottom = 24, left = 48;
  const max = Math.max(1, ...points.map((p) => p.v)) * 1.1;
  const slot = (W - left) / Math.max(1, points.length);
  const bw = Math.max(3, Math.min(22, slot * 0.62));
  const y = (v: number) => top + (H - top - bottom) * (1 - v / max);
  const ticks = [0, 0.5, 1].map((f) => (max / 1.1) * f);
  const every = Math.ceil(points.length / 8);
  return (
    <svg className="hq-chart" viewBox={`0 0 ${W} ${H}`} role="img">
      {ticks.map((t, i) => <g key={i}><line x1={left} x2={W} y1={y(t)} y2={y(t)} stroke="#efede8" /><text x={left - 8} y={y(t) + 4} textAnchor="end">{money ? inr(t).replace("₹", "") : Math.round(t)}</text></g>)}
      {points.map((p, i) => (
        <g key={p.day}>
          <rect x={left + slot * i + (slot - bw) / 2} y={y(p.v)} width={bw} height={Math.max(0, H - bottom - y(p.v))} rx={Math.min(6, bw / 2)} fill={colour} opacity={p.v ? 1 : 0.25}>
            <title>{`${day(p.day)}: ${money ? inr(p.v) : Math.round(p.v)}`}</title>
          </rect>
          {i % every === 0 ? <text x={left + slot * i + slot / 2} y={H - 6} textAnchor="middle">{day(p.day)}</text> : null}
        </g>
      ))}
    </svg>
  );
}

/** A ring for one percentage (NM%, delivered %). */
export function Ring({ value, label, colour = "#f2643a", dark = false }: { value: number | null; label: string; colour?: string; dark?: boolean }) {
  const r = 40, c = 2 * Math.PI * r, v = Math.max(0, Math.min(1, value ?? 0));
  return (
    <svg width={132} height={132} viewBox="0 0 100 100" role="img" aria-label={`${label}: ${value == null ? "—" : Math.round(v * 100) + "%"}`}>
      <circle cx="50" cy="50" r={r} fill="none" stroke={dark ? "rgba(255,255,255,0.12)" : "#f1efea"} strokeWidth={10} />
      <circle cx="50" cy="50" r={r} fill="none" stroke={colour} strokeWidth={10} strokeLinecap="round" strokeDasharray={`${v * c} ${c}`} transform="rotate(-90 50 50)" />
      <text x="50" y="51" textAnchor="middle" style={{ fontSize: 19, fontWeight: 650, fill: dark ? "#fff" : "#16140f" }}>{value == null ? "—" : `${(v * 100).toFixed(1)}%`}</text>
      <text x="50" y="65" textAnchor="middle" style={{ fontSize: 8, fill: dark ? "rgba(255,255,255,0.7)" : "#8b877d" }}>{label}</text>
    </svg>
  );
}

/** Ranked bars: share of the total per row (category, brand…), value and NM % on the right. */
export function ShareBars({ rows, max = 6 }: { rows: Array<{ label: string; value: number; share: number; note?: string }>; max?: number }) {
  const top = rows.slice(0, max);
  const big = Math.max(0.0001, ...top.map((r) => r.share));
  return (
    <div className="hq-steps">
      {top.map((r, i) => (
        <div key={r.label} className="hq-step" title={`${r.label}: ${inr(r.value)} (${Math.round(r.share * 100)}%)`}>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
          <span className="track"><i style={{ left: 0, width: `${(r.share / big) * 100}%`, background: i === 0 ? "#f2643a" : "#f6a385" }} /></span>
          <b>{inr(r.value)}{r.note ? <small style={{ display: "block", fontWeight: 400, fontSize: 11.5, color: "var(--muted)" }}>{r.note}</small> : null}</b>
        </div>
      ))}
    </div>
  );
}

/** A thin stacked bar for parts of a whole. */
export function Segments({ parts }: { parts: Array<{ label: string; value: number; colour: string }> }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <>
      <div className="hq-seg">{parts.filter((p) => p.value).map((p) => <i key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.colour }} title={`${p.label}: ${p.value}`} />)}</div>
      <div className="hq-legend" style={{ marginTop: 10 }}>{parts.filter((p) => p.value).map((p) => <span key={p.label}><i style={{ background: p.colour }} />{p.label} · {Math.round((p.value / total) * 100)}%</span>)}</div>
    </>
  );
}

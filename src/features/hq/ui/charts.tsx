import { day, inr } from "./fmt";

/** A round top for the axis (18.4 L → 20 L). */
const niceTop = (v: number) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v)), f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
};

/** Bars per day, in HTML so it fills its card's height. Hover a bar for the day's numbers. */
export function DayBars({ points, colour = "#f2643a", money = true, tip }: { points: Array<{ day: string; v: number }>; colour?: string; money?: boolean; tip?: (i: number) => string }) {
  const top = niceTop(Math.max(0, ...points.map((p) => p.v)));
  const fmt = (v: number) => (money ? inr(v).replace("₹", "") : String(Math.round(v)));
  const every = Math.max(1, Math.ceil(points.length / 8));
  return (
    <div className="hq-bars">
      <div className="hq-bars-y">{[0, 0.5, 1].map((f) => <span key={f} style={{ bottom: `${f * 100}%` }}>{fmt(top * f)}</span>)}</div>
      <div className="hq-bars-plot" role="img" aria-label={`${points.length} days`}>
        <u style={{ bottom: "50%" }} /><u style={{ bottom: "100%" }} />
        {points.map((p, i) => (
          <b key={p.day} data-tip={tip ? tip(i) : `${day(p.day)}\n${money ? inr(p.v) : Math.round(p.v)}`}>
            <i style={{ height: `${(Math.max(0, p.v) / top) * 100}%`, background: colour, opacity: p.v ? 1 : 0.25 }} />
          </b>
        ))}
      </div>
      <div className="hq-bars-x">{points.map((p, i) => (i % every === 0 ? <span key={p.day} style={{ left: `${((i + 0.5) / points.length) * 100}%` }}>{day(p.day)}</span> : null))}</div>
    </div>
  );
}

/** A tiny trend line for a number tile (no axes). */
export function Spark({ values, colour = "#fff" }: { values: number[]; colour?: string }) {
  if (values.length < 2) return null;
  const W = 120, H = 28, max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * W).toFixed(1)},${(H - 2 - (v / max) * (H - 4)).toFixed(1)}`).join(" ");
  return <svg className="hq-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden><polyline points={pts} fill="none" stroke={colour} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /></svg>;
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

/** Ranked rows: name and value, then a bar for its share of the total and a note (share, NM %). */
export function ShareBars({ rows, max = 6 }: { rows: Array<{ label: string; value: number; share: number; note?: string }>; max?: number }) {
  const top = rows.slice(0, max);
  const big = Math.max(0.0001, ...top.map((r) => r.share));
  return (
    <div className="hq-share">
      {top.map((r, i) => (
        <div key={r.label} title={`${r.label}: ${inr(r.value)} (${Math.round(r.share * 100)}%)`}>
          <span className="hq-share-top"><span>{r.label}</span><b>{inr(r.value)}</b></span>
          <span className="hq-share-bot"><span className="hq-bar"><i style={{ width: `${(r.share / big) * 100}%`, background: i === 0 ? "#f2643a" : "#f6a385" }} /></span>{r.note ? <small>{r.note}</small> : null}</span>
        </div>
      ))}
    </div>
  );
}

/** A thin stacked bar for parts of a whole. */
export function Segments({ parts, legend }: { parts: Array<{ label: string; value: number; colour: string }>; legend?: number }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const shown = [...parts].filter((p) => p.value).sort((a, b) => b.value - a.value).slice(0, legend ?? parts.length);
  return (
    <>
      <div className="hq-seg">{parts.filter((p) => p.value).map((p) => <i key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.colour }} title={`${p.label}: ${p.value} (${Math.round((p.value / total) * 100)}%)`} />)}</div>
      {shown.length ? <div className="hq-legend" style={{ marginTop: 10 }}>{shown.map((p) => <span key={p.label}><i style={{ background: p.colour }} />{p.label} · {Math.round((p.value / total) * 100)}%</span>)}</div> : null}
    </>
  );
}

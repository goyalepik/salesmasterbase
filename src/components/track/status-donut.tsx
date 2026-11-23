import { STAGES, type StageId } from "@/lib/sheets/smb-orders";

/**
 * Orders by stage as a donut, with the not-delivered count in the middle and a legend with numbers (so the colours
 * are never the only label). Server-drawn SVG: nothing to load on the phone.
 */
export function StatusDonut({ counts, centre, centreLabel, size = 132 }: { counts: Record<StageId, number>; centre: number; centreLabel: string; size?: number }) {
  const total = STAGES.reduce((s, g) => s + counts[g.id], 0);
  const r = 42;
  const c = 2 * Math.PI * r;
  const gap = total > 1 ? 1.6 : 0;
  const shown = STAGES.filter((g) => counts[g.id] > 0);
  const arcs = shown.map((g, i) => {
    const len = (counts[g.id] / total) * c;
    const offset = shown.slice(0, i).reduce((s, p) => s + (counts[p.id] / total) * c, 0);
    return { id: g.id, label: g.label, colour: g.colour, value: counts[g.id], dash: Math.max(0.5, len - gap), offset };
  });
  return (
    <div className="track-donut">
      <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`${centre} ${centreLabel} of ${total}`}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--border)" strokeWidth="11" />
        {arcs.map((a) => (
          <circle
            key={a.id}
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={a.colour}
            strokeWidth="11"
            strokeDasharray={`${a.dash} ${c - a.dash}`}
            strokeDashoffset={-a.offset}
            transform="rotate(-90 50 50)"
          >
            <title>{`${a.label}: ${a.value}`}</title>
          </circle>
        ))}
        <text x="50" y="49" textAnchor="middle" className="track-donut-num">{centre}</text>
        <text x="50" y="62" textAnchor="middle" className="track-donut-label">{centreLabel}</text>
      </svg>
      <ul className="track-legend">
        {STAGES.map((g) => (
          <li key={g.id}>
            <i style={{ background: g.colour }} aria-hidden="true" />
            <span>{g.label}</span>
            <b>{counts[g.id]}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

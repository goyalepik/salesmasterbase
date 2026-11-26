import type { Row } from "../domain/metrics";
import { inr, int, pct } from "./fmt";

/** The standard breakdown table: orders, NMV, share, NM, NM%, discount%. */
export function RowTable({ rows, first }: { rows: Row[]; first: string }) {
  if (!rows.length) return <p className="hq-note">Nothing in this period.</p>;
  const max = Math.max(1, ...rows.map((r) => r.nmv));
  return (
    <div className="hq-table-wrap">
      <table className="hq-table">
        <thead><tr><th>{first}</th><th className="n">Orders</th><th className="n">NMV</th><th style={{ minWidth: 90 }}>Share</th><th className="n">NM</th><th className="n">NM %</th><th className="n">Discount</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td style={{ fontWeight: 600 }}>{r.key}</td>
              <td className="n">{int(r.orders)}</td>
              <td className="n">{inr(r.nmv)}</td>
              <td><div className="hq-bar"><i style={{ width: `${(r.nmv / max) * 100}%` }} /></div><span className="hq-note">{pct(r.share)}</span></td>
              <td className="n">{inr(r.nm)}</td>
              <td className="n"><span className={`hq-tag ${r.nmPct == null ? "quiet" : r.nmPct < 0 ? "bad" : r.nmPct < 0.05 ? "wait" : "good"}`}>{pct(r.nmPct, 1)}</span></td>
              <td className="n">{pct(r.discountPct, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

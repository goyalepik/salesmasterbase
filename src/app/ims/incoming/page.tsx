import type { Metadata } from "next";
import Link from "next/link";
import { INCOMING_LABELS, type Incoming, type IncomingState } from "@/features/ims/domain/model";
import { imsRole } from "@/features/ims/role";
import { loadIms } from "@/features/ims/sources";
import { day, money, units } from "@/features/ims/ui/format";
import { ImsShell } from "@/features/ims/ui/shell";
import { ImsUnavailable } from "@/features/ims/ui/unavailable";
import { firstParam } from "@/lib/query";
import "@/features/ims/ims.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Incoming · Inventory · EPIK" };

const STATES: Array<IncomingState | "open"> = ["open", "overdue", "this_week", "later", "no_date", "stale"];
const LABEL = (s: IncomingState | "open") => (s === "open" ? "All coming" : INCOMING_LABELS[s]);
const TONE: Record<IncomingState, string> = { overdue: "is-bad", this_week: "is-accent", later: "is-good", no_date: "is-warn", stale: "is-quiet" };

export default async function ImsIncoming({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [data, role, query] = await Promise.all([loadIms(), imsRole(), searchParams]);
  if (!data) return <ImsUnavailable role={role} current="incoming" />;
  const s = data.snapshot;
  const admin = role === "admin";
  const raw = firstParam(query.state);
  const state = (STATES.includes(raw as IncomingState) ? raw : "open") as IncomingState | "open";
  const lines = s.incoming.filter((l) => (state === "open" ? l.state !== "stale" : l.state === state));
  const count = (st: IncomingState | "open") => s.incoming.filter((l) => (st === "open" ? l.state !== "stale" : l.state === st)).length;

  // One card per PO (lines without a PO number by vendor).
  const groups = new Map<string, Incoming[]>();
  for (const l of lines) {
    const k = l.po ?? `no-po:${l.vendor ?? "?"}`;
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }

  // What arrived in the last 14 days, from the Masterbase serials, by day and vendor.
  const from = new Date(Date.parse(`${s.today}T00:00:00Z`) - 13 * 86_400_000).toISOString().slice(0, 10);
  const arrived = new Map<string, { day: string; vendor: string; units: number; items: Map<string, number> }>();
  for (const u of s.units) {
    if (!u.inwardOn || u.inwardOn < from || u.inwardOn > s.today) continue;
    const k = `${u.inwardOn}|${u.vendor ?? "?"}`;
    const e = arrived.get(k) ?? { day: u.inwardOn, vendor: u.vendor ?? "Vendor not filled", units: 0, items: new Map() };
    e.units += Math.max(1, u.qty);
    e.items.set(u.name, (e.items.get(u.name) ?? 0) + Math.max(1, u.qty));
    arrived.set(k, e);
  }
  const arrivals = [...arrived.values()].sort((a, b) => b.day.localeCompare(a.day));

  return (
    <ImsShell current="incoming" role={role} readAt={data.readAt} stale={data.stale}>
      <div className="ims-head">
        <div>
          <h1>Incoming</h1>
          <p>Open PO lines from the Procurement list, less what already arrived against the same PO and SKU.</p>
        </div>
      </div>
      <nav className="ims-pills" aria-label="States">
        {STATES.map((st) => (
          <Link key={st} href={`/ims/incoming?state=${st}`} aria-current={state === st ? "page" : undefined}>{LABEL(st)} <span>{count(st)}</span></Link>
        ))}
      </nav>
      {state === "stale" ? <p className="ims-note" style={{ marginBottom: 10 }}>Raised more than 60 days ago with no ETA ahead: most likely received without the GRN being marked, or dropped. Worth closing in the sheet.</p> : null}

      {groups.size ? (
        <div style={{ display: "grid", gap: 12 }}>
          {[...groups.entries()].map(([k, list]) => {
            const first = list[0];
            const pending = list.reduce((sum, l) => sum + l.pending, 0);
            const value = list.reduce((sum, l) => sum + l.value, 0);
            return (
              <section key={k} className="ims-card ims-po">
                <div className="ims-po-head">
                  <strong>{first.po ?? "No PO number"}</strong>
                  <small>{first.vendor ?? "Vendor not filled"}</small>
                  <small>raised {day(first.raisedOn)}{first.owner ? ` by ${first.owner}` : ""}</small>
                  <span style={{ marginLeft: "auto" }} className="ims-note">{units(pending)} units{admin && value ? ` · ${money(value)}` : ""}</span>
                </div>
                <div className="ims-table-wrap">
                  <table className="ims-table">
                    <tbody>
                      {list.map((l) => (
                        <tr key={l.row}>
                          <td className="name">{l.sku ? <Link href={`/ims/stock/${encodeURIComponent(l.sku)}`}>{l.name}</Link> : <strong>{l.name}</strong>}<small>{l.sku ?? "No SKU"}{l.terms ? ` · ${l.terms}` : ""}</small></td>
                          <td className="n">{l.pending} of {l.qty}{l.received ? <small className="block text-[11.5px] text-[var(--ims-faint)]">{l.received} arrived</small> : null}</td>
                          <td>{l.eta ? `ETA ${day(l.eta)}` : "No ETA"}{l.delayReason ? <small className="block text-[12px] text-[var(--ims-faint)]">{l.delayReason}</small> : null}</td>
                          <td><span className={`ims-tag ${TONE[l.state]}`}>{INCOMING_LABELS[l.state]}</span>{l.priority === "High" ? <span className="ims-tag is-bad" style={{ marginLeft: 6 }}>High</span> : null}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <p className="ims-card ims-empty">Nothing here.</p>
      )}

      <div className="ims-section-title" id="arrived"><h2>Arrived, last 14 days</h2><span>From the Masterbase serials</span></div>
      <section className="ims-card">
        {arrivals.length ? (
          <div className="ims-table-wrap">
            <table className="ims-table">
              <thead><tr><th>Day</th><th>Vendor</th><th className="n">Units</th><th>What</th></tr></thead>
              <tbody>
                {arrivals.map((a) => (
                  <tr key={`${a.day}-${a.vendor}`}>
                    <td>{day(a.day)}</td>
                    <td>{a.vendor}</td>
                    <td className="n"><strong>{a.units}</strong></td>
                    <td className="text-[13px] text-[var(--ims-ink-2)]">{[...a.items.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([n, c]) => `${n.slice(0, 40)} ×${c}`).join(", ")}{a.items.size > 3 ? ` +${a.items.size - 3} more` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ims-empty">Nothing arrived in the last 14 days.</p>
        )}
      </section>
    </ImsShell>
  );
}

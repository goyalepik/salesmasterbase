import type { Metadata } from "next";
import Link from "next/link";
import { poRef, PO_STATUSES } from "@/features/ims/domain/app";
import { INCOMING_LABELS, type Incoming, type IncomingState } from "@/features/ims/domain/model";
import { canEdit } from "@/features/ims/role";
import { day, money, units } from "@/features/ims/ui/format";
import { Kpi } from "@/features/ims/ui/kit";
import { loadPage, type SearchParams } from "@/features/ims/ui/load";
import { ImsShell } from "@/features/ims/ui/shell";
import { StatusForm } from "@/features/ims/ui/status-form";
import { ImsUnavailable } from "@/features/ims/ui/unavailable";
import { firstParam } from "@/lib/query";
import "@/features/ims/ims.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Incoming · Inventory · EPIK" };

const STATES: Array<IncomingState | "open"> = ["open", "overdue", "this_week", "later", "no_date", "stale"];
const TONE: Record<IncomingState, string> = { overdue: "is-bad", this_week: "is-accent", later: "is-good", no_date: "is-warn", stale: "is-quiet" };

export default async function ImsIncoming({ searchParams }: { searchParams: SearchParams }) {
  const { data, role, q: query } = await loadPage(searchParams);
  if (!data) return <ImsUnavailable role={role} current="incoming" />;
  const s = data.snapshot;
  const raw = firstParam(query.state);
  const state = (STATES.includes(raw as IncomingState) ? raw : "open") as IncomingState | "open";
  const lines = s.incoming.filter((l) => (state === "open" ? l.state !== "stale" : l.state === state));
  const count = (st: IncomingState | "open") => s.incoming.filter((l) => (st === "open" ? l.state !== "stale" : l.state === st)).length;
  const groups = new Map<string, Incoming[]>();
  for (const l of lines) groups.set(l.po ?? `no-po:${l.vendor ?? "?"}`, [...(groups.get(l.po ?? `no-po:${l.vendor ?? "?"}`) ?? []), l]);
  const lastRaised = s.incoming.map((l) => l.raisedOn).filter(Boolean).sort().pop() ?? null;
  const editor = canEdit(role);

  return (
    <ImsShell current="incoming" role={role} readAt={data.readAt} stale={data.stale}>
      <div className="ims-head">
        <div>
          <h1>Incoming</h1>
          <p>Open PO lines from the Procurement list, less units already received on the same PO and SKU.</p>
        </div>
      </div>
      {lastRaised && lastRaised < s.today.slice(0, 8) + "01" ? <p className="ims-card ims-note" style={{ marginBottom: 14, borderColor: "rgba(251,191,36,0.4)" }}>The newest PO line in the Procurement list is from {day(lastRaised)}. POs raised after that aren&apos;t in the sheet, so they can&apos;t show here.</p> : null}
      <div className="ims-grid" style={{ marginBottom: 14 }}>
        <div className="span-4"><Kpi label="Units coming" value={units(s.kpis.incomingUnits)} sub={`${s.kpis.incomingLines} PO lines`} /></div>
        <div className="span-4"><Kpi label="Value coming" value={money(s.kpis.incomingValue)} sub="At PO price incl. GST, where the PO has one" /></div>
        <div className="span-4"><Kpi label="Late" value={units(s.kpis.lateLines)} sub="PO lines past their ETA" /></div>
      </div>
      <nav className="ims-pills" style={{ marginBottom: 14 }}>
        {STATES.map((st) => <Link key={st} href={`/ims/incoming?state=${st}`} aria-current={state === st ? "page" : undefined}>{st === "open" ? "All coming" : INCOMING_LABELS[st]} <span>{count(st)}</span></Link>)}
      </nav>
      {state === "stale" ? <p className="ims-note" style={{ marginBottom: 12 }}>Raised 60+ days ago with no ETA ahead: most likely received without the GRN being marked, or dropped. Editors can close them here.</p> : null}

      {groups.size ? (
        <div style={{ display: "grid", gap: 14 }}>
          {[...groups.entries()].map(([k, list]) => {
            const first = list[0];
            return (
              <section key={k} className="ims-card">
                <div className="ims-card-head">
                  <div>
                    <h2>{first.po ?? "No PO number"} · {first.vendor ?? "Vendor not filled"}</h2>
                    <p>Raised {day(first.raisedOn)}{first.owner ? ` by ${first.owner}` : ""}{first.terms ? ` · ${first.terms}` : ""}</p>
                  </div>
                  <span className="ims-note">{units(list.reduce((a, l) => a + l.pending, 0))} units{list.some((l) => l.value) ? ` · ${money(list.reduce((a, l) => a + l.value, 0))}` : ""}</span>
                </div>
                <div className="ims-table-wrap">
                  <table className="ims-table">
                    <tbody>
                      {list.map((l) => (
                        <tr key={l.row}>
                          <td className="name">{l.sku ? <Link href={`/ims/stock/${encodeURIComponent(l.sku)}`}>{l.name}</Link> : <strong>{l.name}</strong>}<small>{l.sku ?? "No SKU"}</small></td>
                          <td className="n">{l.pending} of {l.qty}<span className="ims-sub">{l.received ? `${l.received} arrived` : ""}</span></td>
                          <td>{l.eta ? `ETA ${day(l.eta)}` : "No ETA"}<span className="ims-sub">{l.appStatus ? `${l.appStatus} (updated here)` : l.delayReason ?? ""}</span></td>
                          <td><span className={`ims-tag ${TONE[l.state]}`}>{INCOMING_LABELS[l.state]}</span></td>
                          {editor ? <td><StatusForm kind="po" refKey={poRef(l.po, l.sku)} options={PO_STATUSES} current={l.appStatus} withEta /></td> : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      ) : <p className="ims-card ims-empty">Nothing here.</p>}
    </ImsShell>
  );
}

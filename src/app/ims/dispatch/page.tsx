import type { Metadata } from "next";
import Link from "next/link";
import { DISPATCH_STATUSES } from "@/features/ims/domain/app";
import type { DispatchRow } from "@/features/ims/domain/model";
import { canEdit } from "@/features/ims/role";
import { day, units } from "@/features/ims/ui/format";
import { CardHead, Kpi } from "@/features/ims/ui/kit";
import { loadPage, type SearchParams } from "@/features/ims/ui/load";
import { ImsShell } from "@/features/ims/ui/shell";
import { StatusForm } from "@/features/ims/ui/status-form";
import { ImsUnavailable } from "@/features/ims/ui/unavailable";
import { firstParam } from "@/lib/query";
import "@/features/ims/ims.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dispatch · Inventory · EPIK" };

type Bucket = "delivered" | "moving" | "pending" | "brand" | "cancelled" | "none";
const BUCKET: Record<Bucket, { label: string; tone: string }> = {
  delivered: { label: "Delivered", tone: "is-good" },
  moving: { label: "On the way", tone: "is-accent" },
  pending: { label: "Not sent yet", tone: "is-warn" },
  brand: { label: "Brand delivers", tone: "is-accent" },
  cancelled: { label: "Cancelled / returned", tone: "is-quiet" },
  none: { label: "Nothing to deliver", tone: "is-quiet" },
};
function bucketOf(d: DispatchRow): Bucket {
  const s = `${d.appStatus ?? d.status ?? ""}`.toLowerCase();
  if (/deliver(ed)?|installed/.test(s) && !/nothing|ofd|out for/.test(s)) return "delivered";
  if (/cancel|return|rto|refund/.test(s)) return "cancelled";
  if (/nothing to be/.test(s)) return "none";
  if (/brand/.test(s)) return "brand";
  if (/ofd|out for|transit|dispatch|hub|damaged in transit/.test(s)) return "moving";
  return "pending";
}

export default async function ImsDispatch({ searchParams }: { searchParams: SearchParams }) {
  const { data, role, r, q: query } = await loadPage(searchParams);
  if (!data) return <ImsUnavailable role={role} current="out" />;
  const s = data.snapshot;
  const want = firstParam(query.status) as Bucket | undefined;
  const q = (firstParam(query.q) ?? "").toLowerCase().trim();
  const inRange = s.dispatches.filter((d) => d.on && d.on >= s.range.from && d.on <= s.range.to);
  const counts = Object.fromEntries((Object.keys(BUCKET) as Bucket[]).map((b) => [b, inRange.filter((d) => bucketOf(d) === b).length])) as Record<Bucket, number>;
  const list = inRange.filter((d) => (!want || bucketOf(d) === want) && (!q || `${d.order} ${d.name} ${d.serial} ${d.poc} ${d.hub}`.toLowerCase().includes(q)));
  const editor = canEdit(role);
  const link = (b?: Bucket) => `/ims/dispatch?${new URLSearchParams({ ...(b ? { status: b } : {}), ...(r !== "30d" ? { r } : {}) }).toString()}`;

  return (
    <ImsShell current="out" role={role} readAt={data.readAt} stale={data.stale} range={r}>
      <div className="ims-head">
        <div>
          <h1>Dispatch</h1>
          <p>Items sent to customers, from the Masterbase&apos;s Dispatch Tracker, with delivery status. {s.range.label}.</p>
        </div>
      </div>
      <div className="ims-grid" style={{ marginBottom: 14 }}>
        <div className="span-3"><Kpi label="Sent" value={units(inRange.length)} sub={`${units(s.kpis.outUnits)} units left stock`} /></div>
        <div className="span-3"><Kpi label="Delivered" value={units(counts.delivered)} sub={inRange.length ? `${Math.round((counts.delivered / inRange.length) * 100)}% of sent` : ""} /></div>
        <div className="span-3"><Kpi label="On the way" value={units(counts.moving + counts.brand)} sub="Out for delivery, in transit or with the brand" /></div>
        <div className="span-3"><Kpi label="Not sent yet" value={units(counts.pending)} sub="Confirmed, waiting on stock or a slot" /></div>
      </div>
      <nav className="ims-pills" style={{ marginBottom: 12 }}>
        <Link href={link()} aria-current={!want ? "page" : undefined}>All <span>{inRange.length}</span></Link>
        {(Object.keys(BUCKET) as Bucket[]).filter((b) => counts[b]).map((b) => <Link key={b} href={link(b)} aria-current={want === b ? "page" : undefined}>{BUCKET[b].label} <span>{counts[b]}</span></Link>)}
      </nav>
      <form action="/ims/dispatch" className="ims-search" style={{ marginBottom: 12 }}>
        <label><input name="q" defaultValue={q} placeholder="Order #PIK, product, serial, POC or hub" aria-label="Filter dispatches" autoComplete="off" /></label>
        {want ? <input type="hidden" name="status" value={want} /> : null}
        <button type="submit" className="ims-btn">Filter</button>
      </form>
      <section className="ims-card">
        <CardHead title={`${units(list.length)} items`} sub={editor ? "Editors can set a delivery status; the latest update shows." : undefined} />
        {list.length ? (
          <div className="ims-table-wrap">
            <table className="ims-table">
              <thead><tr><th>Sent</th><th>Product</th><th>Order</th><th>POC · hub</th><th>Status</th>{editor ? <th>Update</th> : null}</tr></thead>
              <tbody>
                {list.slice(0, 300).map((d, i) => {
                  const b = bucketOf(d);
                  return (
                    <tr key={`${d.order}-${d.serial}-${i}`}>
                      <td>{day(d.on)}</td>
                      <td className="name">{d.sku ? <Link href={`/ims/stock/${encodeURIComponent(d.sku)}`}>{d.name}</Link> : <strong>{d.name}</strong>}<small>{d.serial ?? "No serial"}</small></td>
                      <td>{d.order ?? "—"}</td>
                      <td>{d.poc ?? "—"}<span className="ims-sub">{d.hub ?? ""}</span></td>
                      <td><span className={`ims-tag ${BUCKET[b].tone}`}>{BUCKET[b].label}</span><span className="ims-sub">{d.appStatus ? `${d.appStatus} (updated here)` : d.status ?? ""}{d.deliveredOn ? ` · ${day(d.deliveredOn)}` : ""}</span></td>
                      {editor ? <td><StatusForm kind="dispatch" refKey={(d.serial ?? d.order ?? "").toUpperCase().replace(/\s+/g, "")} options={DISPATCH_STATUSES} current={d.appStatus} /></td> : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="ims-empty">Nothing here.</p>}
      </section>
    </ImsShell>
  );
}

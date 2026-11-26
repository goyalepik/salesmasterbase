import type { Metadata } from "next";
import { inr } from "@/features/hq/ui/fmt";
import { Head } from "@/features/hq/ui/kit";
import { HqShell } from "@/features/hq/ui/shell";
import { HqSourcesForm } from "@/features/hq/ui/sources-form";
import { loadHq, readHqSources } from "@/features/hq/sources";
import "@/features/hq/hq.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sources · EPIK HQ" };

const DEFS: Array<[string, string]> = [
  ["Orders", "Unique Shopify Order IDs. Cancelled, refunded, NOT CONFIRMED and fraud orders are left out (shown separately)."],
  ["GMV", "List value before discount, incl. GST: SMB “GMV(RSP) Value Pre Disc”."],
  ["NMV", "What the customer pays: SMB “NMV Value (Inc GST)”. Ex-GST: “NMV Value (Excl GST)”. Orders finance hasn't filled yet (the newest) use Link Price and Undiscounted GMV until it does."],
  ["Discount", "GMV − NMV (incl. GST)."],
  ["COGS", "SMB “COGS Excl GST” (cost after credit notes, as finance keeps it). Rows still showing “Update data” have no cost yet."],
  ["NM, NM %", "SMB “Net Margin Value” (NMV ex-GST − COGS ex-GST), on orders with a cost. NM % = NM ÷ NMV ex-GST of those same orders. The sheet's own NM % divides by every row's NMV, including rows with no cost yet, so it reads a little lower."],
  ["NM after ads", "NM − Meta spend for the same days."],
  ["CAC", "Meta spend ÷ new customers (SMB CX Type New, unique by phone). Meta only."],
  ["ROAS", "NMV (incl. GST) ÷ Meta spend."],
  ["Cost per demo, demo → sale", "Meta spend ÷ demos booked (home + video); sales with source Demo or Virtual Demo ÷ demos."],
  ["Repeat %", "Repeat customers ÷ all customers in the period (SMB CX Type)."],
  ["Delivery", "SMB Logistic Status per order; days = sale date to delivery date."],
];

export default async function HqAdmin() {
  const [data, src] = await Promise.all([loadHq("all"), readHqSources()]);
  return (
    <HqShell current="admin">
      <div className="hq-grid">
        <section className="hq-card c-7">
          <Head title="Sources" sub="Read live every 2 minutes. The SMB itself stays private; the app reads its live copy." />
          <div className="hq-list" style={{ marginBottom: 14 }}>
            {(data?.states ?? []).map((s) => <div key={s.id}><span><strong>{s.id === "sales" ? "Sales Masterbase (Sales feed)" : "Getepik Tracker (Meta)"}</strong><small>{s.detail}</small></span><span className={`hq-tag ${s.ok ? "good" : "bad"}`}>{s.ok ? "Reading" : "Not reading"}</span></div>)}
          </div>
          <HqSourcesForm copySheet={src.copySheet ?? ""} salesTab={src.salesTab ?? "Sales feed"} adsSheet={src.adsSheet ?? ""} />
        </section>
        <section className="hq-card c-5">
          <Head title="Ties to the sheets" sub="Our sums of every row vs the sheets' own totals" />
          <div className="hq-list">
            {(data?.d.checks ?? []).map((c) => <div key={c.label}><span><strong>{c.label}</strong><small>Sheet {inr(c.sheet)} · ours {inr(c.ours)}</small></span><span className={`hq-tag ${c.ok ? "good" : "bad"}`}>{c.ok ? "Matches" : "Differs"}</span></div>)}
            {(data?.adTotals ?? []).map((a) => <div key={a.month}><span><strong>Meta spend {a.month}</strong><small>Sheet {inr(a.sheet ?? 0)} · ours {inr(a.ours)}</small></span><span className={`hq-tag ${a.sheet != null && Math.abs(a.sheet - a.ours) < 1 ? "good" : "bad"}`}>{a.sheet != null && Math.abs(a.sheet - a.ours) < 1 ? "Matches" : "Differs"}</span></div>)}
          </div>
          {data?.missing.length ? <p className="hq-note" style={{ marginTop: 10 }}>Columns not found in the Sales feed: {data.missing.join(", ")}.</p> : null}
        </section>
        <section className="hq-card c-12">
          <Head title="How each number is calculated" />
          <div className="hq-list">{DEFS.map(([k, v]) => <div key={k}><span><strong>{k}</strong><small style={{ whiteSpace: "normal" }}>{v}</small></span><span /></div>)}</div>
        </section>
      </div>
    </HqShell>
  );
}

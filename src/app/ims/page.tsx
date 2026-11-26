import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { imsRole } from "@/features/ims/role";
import { loadIms } from "@/features/ims/sources";
import { HBars, WeeklyInOut } from "@/features/ims/ui/charts";
import { ImsChat } from "@/features/ims/ui/chat";
import { day, money, units } from "@/features/ims/ui/format";
import { ImsShell } from "@/features/ims/ui/shell";
import { ImsUnavailable } from "@/features/ims/ui/unavailable";
import "@/features/ims/ims.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Inventory · EPIK" };

const SUGGESTIONS = ["What's running low?", "What's late from vendors?", "How many iPhone 16 do we have?", "What came in this week?"];

export default async function ImsOverview() {
  const [data, role] = await Promise.all([loadIms(), imsRole()]);
  if (!data) return <ImsUnavailable role={role} current="overview" />;
  const { snapshot: s } = data;
  const k = s.kpis;
  const admin = role === "admin";
  const brandRows = [...s.brands].sort((a, b) => (admin ? b.value - a.value : b.units - a.units)).slice(0, 7).map((b) => ({ label: b.brand, value: admin ? b.value : b.units, text: admin ? money(b.value) : `${units(b.units)}`, href: `/ims/stock?q=${encodeURIComponent(b.brand)}` }));
  const ageRows = s.ageing.map((a, i) => ({ label: a.label, value: a.units, text: `${units(a.units)}${admin ? ` · ${money(a.value)}` : ""}`, href: i === 3 ? "/ims/stock?view=old" : undefined }));

  return (
    <ImsShell current="overview" role={role} readAt={data.readAt} stale={data.stale}>
      <div className="ims-head">
        <div>
          <h1>Inventory</h1>
          <p>Live from the Procurement sheet, the Inventory Masterbase and the Inventory Tracker. Ask, or look below.</p>
        </div>
      </div>

      <ImsChat suggestions={SUGGESTIONS} />

      <nav className="ims-flow" aria-label="How stock moves">
        <Link href="/ims/incoming">
          <span>1 · Ordered</span>
          <strong>{units(k.incomingUnits)}</strong>
          <em>units on {units(k.incomingLines)} PO lines{k.lateLines ? <> · <b className="text-[var(--ims-bad)]">{k.lateLines} late</b></> : null}{admin && k.incomingValue ? ` · ${money(k.incomingValue)}` : ""}</em>
        </Link>
        <Link href="/ims/incoming#arrived">
          <span>2 · Received</span>
          <strong>{units(k.in30)}</strong>
          <em>in 30 days · {units(k.in7)} this week</em>
        </Link>
        <Link href="/ims/stock?view=in">
          <span>3 · In stock</span>
          <strong>{units(k.unitsInStock)}</strong>
          <em>units · {units(k.skusInStock)} products{admin ? ` · ${money(k.stockValue)}` : ""}</em>
        </Link>
        <Link href="/ims/stock">
          <span>4 · Dispatched</span>
          <strong>{units(k.out30)}</strong>
          <em>to customers in 30 days · {units(k.out7)} this week</em>
        </Link>
      </nav>


      <div className="ims-grid-2" style={{ marginBottom: 12 }}>
        <section className="ims-card ims-card-pad">
          <h2>Received vs dispatched</h2>
          <p>Units per week, last 8 weeks</p>
          <WeeklyInOut weeks={s.weeks} />
        </section>
        <section className="ims-card ims-card-pad">
          <h2>Needs attention</h2>
          <p>Tap one to see the list</p>
          {s.attention.length ? (
            <div className="ims-attn" style={{ marginTop: 6 }}>
              {s.attention.map((a) => (
                <Link key={a.kind} href={a.href}>
                  <i style={{ background: a.tone === "bad" ? "var(--ims-bad)" : "var(--ims-warn)" }} aria-hidden="true" />
                  <span className="min-w-0"><strong>{a.title}</strong><small>{a.detail}</small></span>
                  <span className="text-[var(--ims-faint)]">›</span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="ims-empty">All clear.</p>
          )}
        </section>
      </div>

      <div className="ims-grid-2">
        <section className="ims-card ims-card-pad">
          <h2>Stock by brand</h2>
          <p>{admin ? "Value at cost" : "Units"}, top 7</p>
          <HBars rows={brandRows} />
        </section>
        <section className="ims-card ims-card-pad">
          <h2>Stock age</h2>
          <p>Units with an inward date, by days in the warehouse</p>
          <HBars rows={ageRows} colour="#64748b" />
        </section>
      </div>

      {s.tracker.asOf ? (
        <p className="ims-foot">
          <AlertTriangle size={12} className="mr-1 inline" />
          Stock is counted from the Masterbase serials ({units(k.unitsInStock)} units). The Inventory Tracker says {units(k.trackerUnits)} ({s.tracker.asOf.toLowerCase()}); {k.gaps} products differ. <Link href="/ims/stock?view=gap" className="underline">See them</Link>. Today is {day(s.today)}.
        </p>
      ) : null}
    </ImsShell>
  );
}

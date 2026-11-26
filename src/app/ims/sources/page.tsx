import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, CircleAlert } from "lucide-react";
import { productsInView } from "@/features/ims/domain/model";
import { imsRole } from "@/features/ims/role";
import { loadIms, readSources, SOURCE_IDS, SOURCE_INFO } from "@/features/ims/sources";
import { units } from "@/features/ims/ui/format";
import { ImsShell } from "@/features/ims/ui/shell";
import { SourcesForm } from "@/features/ims/ui/sources-form";
import "@/features/ims/ims.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sources · Inventory · EPIK" };

const FLOW = [
  { title: "PO raised", where: "Procurement sheet · Procurement list", what: "Procurement adds a line per product: vendor, qty, ETA. Here it shows under Incoming until it arrives." },
  { title: "Goods arrive", where: "Procurement sheet · Inward Sheet", what: "Each unit is scanned in with its serial, invoice and cost. The Masterbase picks it up." },
  { title: "In stock", where: "Inventory Masterbase", what: "One row per serial, In System = Yes. This is what the IMS counts as stock." },
  { title: "Dispatched", where: "Inventory Masterbase", what: "Dispatch date and customer filled, In System = No. It leaves stock and counts as sold." },
];

export default async function ImsSources() {
  const [data, role, links] = await Promise.all([loadIms(), imsRole(), readSources()]);
  if (role !== "admin") {
    return (
      <ImsShell current="sources" role={role} readAt={data?.readAt ?? null}>
        <p className="ims-card ims-empty">Switch to Admin (top right) to see the sources.</p>
      </ImsShell>
    );
  }
  const gaps = data ? productsInView(data.snapshot, "gap") : [];

  return (
    <ImsShell current="sources" role={role} readAt={data?.readAt ?? null} stale={data?.stale}>
      <div className="ims-head">
        <div>
          <h1>Sources and how it works</h1>
          <p>The IMS reads three team sheets live and changes nothing in them.</p>
        </div>
      </div>

      <section className="ims-card ims-card-pad" style={{ marginBottom: 12 }}>
        <h2>How stock moves</h2>
        <p>Each step, and the sheet where the team writes it today</p>
        <ol className="mt-3 grid gap-3 sm:grid-cols-4">
          {FLOW.map((f, i) => (
            <li key={f.title} className="relative rounded-[12px] bg-[#f7f8fa] p-3">
              <span className="text-[11.5px] font-semibold uppercase tracking-wider text-[var(--ims-faint)]">Step {i + 1}</span>
              <strong className="mt-1 flex items-center gap-1 text-[14.5px]">{f.title}{i < FLOW.length - 1 ? <ArrowRight size={14} className="text-[var(--ims-faint)]" /> : null}</strong>
              <span className="mt-1 block text-[12px] font-medium text-[var(--ims-accent)]">{f.where}</span>
              <span className="mt-1 block text-[12.5px] leading-snug text-[var(--ims-muted)]">{f.what}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="ims-grid-2" style={{ marginBottom: 12 }}>
        <section className="ims-card ims-card-pad">
          <h2>The three sheets</h2>
          <p>Paste each tab&apos;s link (with its gid). Each sheet must be open to anyone with the link, as viewer.</p>
          <div className="mt-3 grid gap-2">
            {SOURCE_IDS.map((id) => {
              const st = data?.sources.find((x) => x.id === id);
              return (
                <div key={id} className="flex items-start gap-2 text-[13px]">
                  {st?.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[var(--ims-good)]" /> : <CircleAlert size={16} className="mt-0.5 shrink-0 text-[var(--ims-bad)]" />}
                  <span><strong>{SOURCE_INFO[id].sheet} → {SOURCE_INFO[id].tab}</strong>: {st?.ok ? `${units(st.rows)} rows read` : (st?.message ?? "not read")}. <span className="text-[var(--ims-muted)]">{SOURCE_INFO[id].role}</span></span>
                </div>
              );
            })}
          </div>
          <div className="mt-4">
            <SourcesForm fields={SOURCE_IDS.map((id) => ({ id, label: `${SOURCE_INFO[id].sheet} → ${SOURCE_INFO[id].tab}`, hint: SOURCE_INFO[id].role, value: links[id] ?? "" }))} />
          </div>
          {links.savedAt ? <p className="mt-2 text-[12px] text-[var(--ims-faint)]">Saved by {links.savedBy ?? "an admin"}.</p> : null}
        </section>

        <section className="ims-card ims-card-pad">
          <h2>Moving off the sheets</h2>
          <p>When the team is ready to stop updating the sheets</p>
          <ol className="mt-3 grid gap-2 text-[13px] leading-snug text-[var(--ims-ink-2)]">
            <li><strong>1. Today:</strong> the sheets are the source. The IMS shows everything live and never writes to them.</li>
            <li><strong>2. Take over:</strong> one button copies every serial, PO line and count into the IMS&apos;s own tables, so nothing is retyped.</li>
            <li><strong>3. Work here:</strong> raise POs, receive by serial and dispatch in the IMS. The same pages and chat keep working, now on its own data.</li>
            <li><strong>4. Sheets off:</strong> the sheets stop being read. The IMS can still give a sheet-shaped export for anyone who wants one.</li>
          </ol>
          <p className="mt-3 rounded-[10px] bg-[#fdf3e2] px-3 py-2 text-[12.5px] text-[#92400e]">Steps 2 to 4 are the next build. Everything here is already arranged around one stock model, so the switch changes where data comes from, not the screens.</p>
        </section>
      </div>

      <section className="ims-card">
        <div className="ims-po-head">
          <strong>Masterbase vs Tracker</strong>
          <small>{gaps.length} products where the serial count and the Tracker&apos;s daily count differ</small>
          <Link href="/ims/stock?view=gap" className="ml-auto text-[13px] font-semibold text-[var(--ims-accent)]">See all</Link>
        </div>
        {gaps.length ? (
          <div className="ims-table-wrap">
            <table className="ims-table">
              <thead><tr><th>Product</th><th className="n">Masterbase</th><th className="n">Tracker</th><th className="n">Difference</th></tr></thead>
              <tbody>
                {gaps.slice(0, 12).map((p) => (
                  <tr key={p.sku}>
                    <td className="name"><Link href={`/ims/stock/${encodeURIComponent(p.sku)}`}>{p.name}</Link><small>{p.sku}</small></td>
                    <td className="n">{p.inStock}</td>
                    <td className="n">{p.trackerUnits}</td>
                    <td className="n"><span className="ims-tag is-warn">{p.gap > 0 ? `+${p.gap}` : p.gap}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ims-empty">They agree.</p>
        )}
      </section>
    </ImsShell>
  );
}

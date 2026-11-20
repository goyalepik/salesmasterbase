import Link from "next/link";
import { startCountAction } from "@/app/actions/wms";
import { SubmitButton } from "@/components/ops/action-form";
import { inputClass, Panel } from "@/components/ops/bits";
import { PageHeader } from "@/components/ui";
import { activeNames } from "@/features/wms/service";
import { loadWmsPage } from "@/features/wms/ui/load";
import { WmsNav, WmsOff } from "@/features/wms/ui/wms-nav";
import { GoForm } from "@/features/wms/ui/go-form";
import { shortWhen } from "@/lib/ops-ui/format";
import "@/features/wms/wms.css";

export default async function CountsPage() {
  const page = await loadWmsPage();
  if (!page) return <WmsOff />;
  const [counts, hubs] = await Promise.all([page.ctx.wms.listRecords("count", { limit: 100 }), activeNames(page.ctx, "hub")]);

  return (
    <section>
      <PageHeader title="Stock counts" description="Scan every unit on the racks. The system compares at the end: missing, found at the wrong hub, not in records." />
      <WmsNav current="counts" />
      <Panel title="Start a count">
        <GoForm action={startCountAction} className="flex flex-wrap gap-2">
          <select name="hub" className={`${inputClass} w-56`} aria-label="Hub">{hubs.map((h) => <option key={h} value={h}>{h}</option>)}</select>
          <SubmitButton>Start counting</SubmitButton>
        </GoForm>
      </Panel>
      <Panel title="Counts" className="mt-3">
        {counts.length ? (
          <div className="wms-card-list">
            {counts.map((c) => (
              <Link key={c.number} href={`/wms/counts/${c.number}`} className="wms-card">
                <div className="wms-card-top">
                  <strong>{c.number} · {c.hub}</strong>
                  <span className={`wms-badge ${c.status === "open" ? "is-warn" : "is-good"}`}>{c.status === "open" ? "Counting" : "Done"}</span>
                </div>
                <span className="wms-muted">
                  {c.result ? `${c.result.found} found of ${c.result.expected} expected · ${c.result.missing.length} missing` : `${c.scans.length} counted so far`} · {shortWhen(c.createdAt)} · {c.createdBy}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-[14px] text-muted">No counts yet.</p>
        )}
      </Panel>
    </section>
  );
}

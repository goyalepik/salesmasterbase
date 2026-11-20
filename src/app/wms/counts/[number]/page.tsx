import Link from "next/link";
import { notFound } from "next/navigation";
import { countFinishAction } from "@/app/actions/wms";
import { ActionForm, SubmitButton } from "@/components/ops/action-form";
import { inputClass, Kpi, Panel } from "@/components/ops/bits";
import { PageHeader } from "@/components/ui";
import { UNIT_STATUS_LABELS } from "@/features/wms/domain/unit";
import { CountScreen } from "@/features/wms/ui/count-screen";
import { loadWmsPage } from "@/features/wms/ui/load";
import { WmsNav, WmsOff } from "@/features/wms/ui/wms-nav";
import { inr } from "@/lib/ops-ui/format";
import "@/features/wms/wms.css";

export default async function CountPage({ params }: { params: Promise<{ number: string }> }) {
  const page = await loadWmsPage();
  if (!page) return <WmsOff />;
  const number = decodeURIComponent((await params).number);
  const count = await page.ctx.wms.getRecord("count", number);
  if (!count) notFound();
  const r = count.result;
  const missing = r ? (await Promise.all(r.missing.map((id) => page.ctx.wms.getUnit(id)))).filter((u) => !!u) : [];
  const elsewhere = r ? (await Promise.all(r.elsewhere.map((id) => page.ctx.wms.getUnit(id)))).filter((u) => !!u) : [];
  const missingValue = missing.reduce((s, u) => s + (u!.unitCostMinor ?? 0), 0);

  return (
    <section>
      <PageHeader title={`${count.number} · ${count.hub}`} description={count.status === "open" ? "Counting. Finish when every rack is done." : `Done by ${count.closedBy}.`} />
      <WmsNav current="counts" />
      {count.status === "open" ? (
        <>
          <CountScreen number={count.number} hub={count.hub} start={count.scans.length} />
          <ActionForm action={countFinishAction} className="mt-3" confirm="Finish the count? The comparison is made now.">
            <input type="hidden" name="number" value={count.number} />
            <input type="hidden" name="step" value="finish" />
            <SubmitButton>Finish and compare</SubmitButton>
          </ActionForm>
        </>
      ) : r ? (
        <>
          <dl className="ops-grid-3 mb-3">
            <Kpi label="Expected" value={r.expected} />
            <Kpi label="Found" value={r.found} />
            <Kpi label="Missing" value={r.missing.length} tone={r.missing.length ? "bad" : "good"} note={page.showCost && missing.length ? `${inr(missingValue)} at cost` : undefined} />
            <Kpi label="Recorded at another hub" value={r.elsewhere.length} tone={r.elsewhere.length ? "warn" : undefined} />
            <Kpi label="Not in records" value={r.unexpected.length} tone={r.unexpected.length ? "warn" : undefined} />
          </dl>
          <Panel title="What didn't match">
            <div className="grid gap-1.5 text-[14px]">
              {missing.map((u) => <div key={u!.id}>Missing: <Link href={`/wms/units/${u!.id}`} className="text-accent">{u!.serial}</Link> <span className="wms-muted">{u!.sku} · {UNIT_STATUS_LABELS[u!.status]}</span></div>)}
              {elsewhere.map((u) => <div key={u!.id}>Found here, recorded {u!.hub ? `at ${u!.hub}` : ""} as {UNIT_STATUS_LABELS[u!.status].toLowerCase()}: <Link href={`/wms/units/${u!.id}`} className="text-accent">{u!.serial}</Link></div>)}
              {r.unexpected.map((s) => <div key={s}>Not in records: <strong>{s}</strong> <span className="wms-muted">(receive it on a PO, or check the label)</span></div>)}
              {!missing.length && !elsewhere.length && !r.unexpected.length ? <p className="text-good">Everything matched.</p> : null}
            </div>
          </Panel>
          {missing.length || elsewhere.length ? (
            <Panel title="Fix the records" subtitle="Units found here but recorded at another hub move here. Missing units are marked lost (procurement or admin)." className="mt-3">
              <ActionForm action={countFinishAction} className="grid gap-2">
                <input type="hidden" name="number" value={count.number} />
                <input type="hidden" name="step" value="settle" />
                <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="moveHere" value="yes" defaultChecked className="h-5 w-5" /> Move the units found here to {count.hub}</label>
                {page.showCost ? <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="markLost" value="yes" className="h-5 w-5" /> Mark the missing units lost</label> : null}
                <input name="note" maxLength={200} className={inputClass} placeholder="What was checked (needed to mark lost)" aria-label="What was checked" />
                <div><SubmitButton>Fix records</SubmitButton></div>
              </ActionForm>
            </Panel>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

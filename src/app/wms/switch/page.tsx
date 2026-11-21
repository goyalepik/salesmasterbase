import { openingUnitsAction } from "@/app/actions/wms";
import { ActionForm, SubmitButton } from "@/components/ops/action-form";
import { Kpi, Panel, TableWrap } from "@/components/ops/bits";
import { PageHeader } from "@/components/ui";
import { openingPlan, sheetVsWarehouse } from "@/features/wms/insights";
import { loadWmsPage } from "@/features/wms/ui/load";
import { WmsNav, WmsOff } from "@/features/wms/ui/wms-nav";
import { inr } from "@/lib/ops-ui/format";
import { isAdmin } from "@/lib/ops-ui/actor";
import "@/features/wms/wms.css";

const STEPS = [
  "Pick the day. Tell the team: from that day stock is scanned in and out here, the Inventory Masterbase sheet is no longer typed.",
  "Count the warehouse the evening before (Counts tab, or the usual physical count) and fix the sheet so it matches the racks.",
  "Supabase → SQL Editor → New query: paste the whole of supabase/migrations/0006_wms.sql and Run. It only adds tables.",
  "On the cut-over day only: Vercel → Project → Settings → Environment Variables: set SHEET_SYNC_FROM = off so the sheet stops adding stock. Redeploy.",
  "Open this page on the live site and press “Create opening units” below. Today's stock becomes units; nothing is counted twice.",
  "Put the Warehouse role on the warehouse team (Settings → Team roles, role inventory) and give them the receive and dispatch screens.",
  "For a week, compare the day report with the sheet each evening. Units without a serial from the sheet carry an EPIK label: check and relabel them as they're picked.",
];

export default async function SwitchOver() {
  const page = await loadWmsPage();
  if (!page) return <WmsOff />;
  const admin = await isAdmin();
  const [plan, diff] = await Promise.all([openingPlan(page.ctx), sheetVsWarehouse(page.ctx)]);
  const money = page.showCost;

  return (
    <section>
      <PageHeader title="Switch-over from the sheet" description="Moves today's stock (the team sheet and the app's ledger) into unit records here, then the warehouse works from these screens." />
      <WmsNav current="switch" />
      <dl className="ops-grid-3 mb-3">
        <Kpi label="Units to create" value={plan.units} />
        <Kpi label="With the sheet's serial" value={plan.withSerial} />
        <Kpi label="No serial (get an EPIK label)" value={plan.placeholders} tone={plan.placeholders ? "warn" : undefined} />
        {money ? <Kpi label="Their value (cost)" value={inr(plan.valueMinor)} /> : null}
        <Kpi label="Serials under two products" value={plan.duplicates.length} tone={plan.duplicates.length ? "bad" : "good"} note="Left out until fixed" />
        <Kpi label="Products with negative stock" value={plan.negative.length} tone={plan.negative.length ? "bad" : "good"} note="Fix on the sheet first" />
      </dl>

      <Panel title="Create opening units" subtitle="Safe to press again later: units already here are skipped. Stock numbers don't change.">
        {admin ? (
          <ActionForm action={openingUnitsAction} confirm={`Create ${plan.units} units from today's stock?`}>
            <SubmitButton>{plan.units ? `Create ${plan.units} opening units` : "Nothing to create"}</SubmitButton>
          </ActionForm>
        ) : (
          <p className="text-[14px] text-muted">Only admin can run this.</p>
        )}
      </Panel>

      <Panel title="Go-live steps" className="mt-3">
        <ol className="grid list-decimal gap-2 pl-5 text-[14px]">
          {STEPS.map((s) => <li key={s}>{s}</li>)}
        </ol>
      </Panel>

      {plan.duplicates.length || plan.negative.length ? (
        <Panel title="Fix these on the sheet first" className="mt-3">
          <div className="grid gap-1 text-[14px]">
            {plan.duplicates.slice(0, 50).map((d) => <div key={d.serial}>Serial <strong>{d.serial}</strong> is in stock under {d.skus.join(" and ")}</div>)}
            {plan.negative.slice(0, 50).map((n) => <div key={n.sku}><strong>{n.sku}</strong> shows {n.onHand} in stock</div>)}
          </div>
        </Panel>
      ) : null}

      <Panel title={`Ledger vs units here (${diff.length} products differ)`} subtitle="Before the switch-over almost everything differs. After it, this list should be empty; anything left is worth a look." className="mt-3">
        <TableWrap minWidth={560}>
          <thead><tr><th>Product</th><th className="num">Ledger</th><th className="num">Units here</th><th className="num">Gap</th></tr></thead>
          <tbody>
            {diff.slice(0, 200).map((r) => (
              <tr key={r.sku}><td><span className="wms-clamp-1" title={r.name}>{r.name}</span><div className="wms-muted">{r.sku}</div></td><td className="num">{r.ledger}</td><td className="num">{r.units}</td><td className="num font-semibold">{r.ledger - r.units}</td></tr>
            ))}
          </tbody>
        </TableWrap>
      </Panel>
    </section>
  );
}

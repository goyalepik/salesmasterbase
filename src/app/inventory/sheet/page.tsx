import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { pullTeamSheetAction } from "@/app/actions/ops";
import { BlockedState } from "@/components/blocked-state";
import { ActionForm, SubmitButton } from "@/components/ops/action-form";
import { Panel, TableWrap } from "@/components/ops/bits";
import { InventoryTabs } from "@/components/ops/inventory-tabs";
import { PageHeader } from "@/components/ui";
import { shortDate } from "@/lib/ops-ui/format";
import { loadOps } from "@/lib/ops-ui/load";
import { pullTeamSheet, sheetSyncStatus } from "@/lib/sheets/run";

export const maxDuration = 60;

/** Team sheet sync: opening this page reads the sheet now and shows what came in and what needs a look. */
export default async function SheetSyncPage() {
  const ops = await loadOps();
  if (ops.kind !== "ready") return <BlockedState health={ops.workspace.health} />;
  const result = await pullTeamSheet(ops.store, { force: true });
  const status = await sheetSyncStatus(ops.store);
  const grouped = new Map<string, { sku: string; product: string; message: string; keys: string[] }>();
  if (result.ran && result.ok) {
    for (const p of result.applied.problems) {
      const key = `${p.sku}|${p.message}`;
      const g = grouped.get(key) ?? { sku: p.sku, product: p.product, message: p.message, keys: [] };
      g.keys.push(p.key);
      grouped.set(key, g);
    }
  }
  const groups = [...grouped.values()].sort((a, b) => b.keys.length - a.keys.length);
  return (
    <section>
      <PageHeader
        title="Team sheet sync"
        description="The app reads Inventory Masterbase (Ritika's sheet) every 5 minutes. New stock and dispatches typed there come into the app's stock. No sheet is ever changed by the app."
        action={<ActionForm action={pullTeamSheetAction}><SubmitButton tone="quiet">Read the sheet now</SubmitButton></ActionForm>}
      />
      <InventoryTabs store={ops.store} current="view" />
      {!result.ran ? (
        <Panel title="Off">
          <p className="text-[13px] text-muted">The sync starts once SHEET_SYNC_FROM is set on the live site (Vercel → Settings → Environment Variables).</p>
        </Panel>
      ) : !result.ok ? (
        <Panel title="Could not read the sheet">
          <p className="text-[13px] text-bad">{result.error}</p>
          <p className="mt-1 text-[13px] text-muted">The sheet must stay readable by anyone with the link (Share → General access). Nothing in the app was changed.</p>
        </Panel>
      ) : (
        <div className="grid gap-3">
          <dl className="inv-strip is-4">
            <div><dt>Unit rows in the sheet</dt><dd>{result.total.toLocaleString("en-IN")}</dd><p>{result.rows} dated {shortDate(status.from)} or later</p></div>
            <div><dt>New this read</dt><dd className="is-good">{result.applied.inward + result.applied.dispatched + result.applied.returned}</dd><p>{result.applied.inward} stock in · {result.applied.dispatched} dispatched · {result.applied.returned} returned{result.applied.productsAdded ? ` · ${result.applied.productsAdded} new products` : ""}{result.applied.alreadyOut ? ` · ${result.applied.alreadyOut} already at 0 in the app` : ""}</p></div>
            <div><dt>Need a look</dt><dd className={result.applied.problems.length ? "is-bad" : undefined}>{result.applied.problems.length}</dd><p>{result.applied.problems.length ? `${groups.length} products, listed below` : "Nothing"}</p></div>
            <div><dt>SKUs where sheet ≠ app</dt><dd className={result.check.length ? "is-bad" : "is-good"}>{result.check.length}</dd><p>Fix with Stock in or Correct</p></div>
          </dl>

          {status.sheetUrl ? (
            <p className="text-[13px]">
              <a href={status.sheetUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-info">Open my sheet <ExternalLink size={13} /></a>
              <span className="text-muted"> · its “EPIK App live stock” tab shows the app’s stock{status.feedReady ? "" : " (feed key not set yet)"}.</span>
            </p>
          ) : null}

          <Panel title={`Need a look (${result.applied.problems.length} rows, ${groups.length} products)`} subtitle="Rows the app could not apply, grouped by product. Each one is tried again on every read until it is fixed.">
            {!groups.length ? (
              <p className="text-[13px] text-muted">Every new row went in.</p>
            ) : (
              <TableWrap minWidth={760}>
                <thead><tr><th>Product</th><th className="num">Rows</th><th>Serials or rows</th><th>What to do</th></tr></thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={`${g.sku}|${g.message}`}>
                      <td className="max-w-[260px]"><Link href={`/inventory/stock?q=${encodeURIComponent(g.sku)}#stock`} className="block min-w-0"><span className="block truncate">{g.product}</span><span className="block text-[11px] text-faint">{g.sku}</span></Link></td>
                      <td className="num font-semibold">{g.keys.length}</td>
                      <td className="max-w-[220px] text-[12px] text-muted"><span className="line-clamp-2">{g.keys.slice(0, 4).join(", ")}{g.keys.length > 4 ? ` +${g.keys.length - 4} more` : ""}</span></td>
                      <td className="text-[13px]">{g.message}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Panel>

          <Panel title={`Sheet vs app (${result.check.length} SKUs differ)`} subtitle="Units in stock per SKU. The sheet counts rows with no dispatch date and not returned to vendor. Biggest gap first.">
            {!result.check.length ? (
              <p className="text-[13px] text-good">The sheet and the app agree on every SKU.</p>
            ) : (
              <TableWrap minWidth={680}>
                <thead><tr><th>Product</th><th className="num">In the app</th><th className="num">In the sheet</th><th className="num">Gap</th></tr></thead>
                <tbody>
                  {result.check.slice(0, 300).map((c) => (
                    <tr key={c.sku}>
                      <td className="max-w-[340px]"><Link href={`/inventory/stock?q=${encodeURIComponent(c.sku)}#stock`} className="block min-w-0"><span className="block truncate">{c.product}</span><span className="block text-[11px] text-faint">{c.sku}</span></Link></td>
                      <td className="num">{c.app}</td>
                      <td className="num">{c.sheet}</td>
                      <td className={`num font-semibold ${c.app > c.sheet ? "text-warn" : "text-bad"}`}>{c.app > c.sheet ? `+${c.app - c.sheet}` : c.app - c.sheet}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Panel>
        </div>
      )}
    </section>
  );
}

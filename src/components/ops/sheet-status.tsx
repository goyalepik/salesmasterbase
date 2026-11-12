import Link from "next/link";
import { ArrowRight, Sheet } from "lucide-react";
import { Panel } from "@/components/ops/bits";
import type { OpsStore } from "@/lib/ops/store";
import { requestNow, shortDate, shortWhen } from "@/lib/ops-ui/format";
import { sheetSyncStatus } from "@/lib/sheets/run";

export function agoText(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  return minutes < 1 ? "just now" : minutes < 120 ? `${minutes} min ago` : shortWhen(iso);
}

/** Small status box: when the team sheet was last read and what it brought in. */
export async function SheetStatusPanel({ store }: { store: OpsStore }) {
  const status = await sheetSyncStatus(store);
  const now = requestNow();
  const broken = !!status.lastError && (!status.last || status.lastError > status.last.at);
  return (
    <Panel title={<span className="inline-flex items-center gap-2"><Sheet size={16} className="text-good" /> Team sheet</span>} subtitle="Inventory Masterbase is read every 5 minutes. Read only: no sheet is ever changed by the app.">
      {!status.on ? (
        <p className="text-[13px] text-muted">Off. It starts once SHEET_SYNC_FROM is set on the live site.</p>
      ) : (
        <div className="grid gap-1.5 text-[13px]">
          <p className={broken ? "text-bad" : "text-muted"}>
            {broken ? `Last read failed ${agoText(status.lastError!, now)}.` : status.last ? `Read ${agoText(status.last.at, now)}: ${status.last.rows.toLocaleString("en-IN")} unit rows.` : "Not read yet."}
          </p>
          {status.last && !broken ? (
            <p className="text-muted">
              Last read brought in <b className="text-ink">{status.last.inward}</b> new stock, <b className="text-ink">{status.last.dispatched}</b> dispatched
              {status.last.problems ? <>, <b className="text-warn">{status.last.problems} need a look</b></> : null}.
            </p>
          ) : null}
          <p className="text-[12px] text-faint">Rows dated {shortDate(status.from)} or later sync.</p>
          <Link href="/inventory/sheet" className="mt-1 inline-flex items-center gap-1 font-medium text-info">
            Open sheet sync <ArrowRight size={13} />
          </Link>
        </div>
      )}
    </Panel>
  );
}

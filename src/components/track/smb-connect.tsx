import { saveSmbLinkAction } from "@/app/actions/ops";
import { ActionForm, SubmitButton } from "@/components/ops/action-form";
import { loadSmbOrders, smbSetting } from "@/lib/sheets/smb-source";
import { shortWhen } from "@/lib/ops-ui/format";

/** The Sales Masterbase columns the live copy pulls (A2:B, D2:E, H2:H, K2:L, S2:S, AF2:AN of Sales Tracker). */
export function liveCopyFormula(smbId = "PASTE_SMB_ID"): string {
  const r = (range: string) => `IMPORTRANGE("${smbId}","Sales Tracker!${range}")`;
  return `={${["A2:B", "D2:E", "H2:H", "K2:L", "S2:S", "AF2:AN"].map(r).join(", ")}}`;
}

/** Logistics (admins): is the CD tracking page reading the Sales Masterbase, and the box to connect or change it. */
export async function SmbConnect() {
  const [setting, load] = await Promise.all([smbSetting(), loadSmbOrders()]);
  const ok = !!setting && load.ok;
  return (
    <details className="s-card mb-3 px-4 py-3 text-[13px]" open={!ok}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-2">
        <span className={ok ? "text-good" : "text-warn"}>
          {ok
            ? `CD tracking: reading the Sales Masterbase (${load.orders.length} orders, ${shortWhen(new Date(load.at).toISOString())})`
            : setting
              ? `CD tracking: ${load.ok ? "connected" : load.message}`
              : "CD tracking: the Sales Masterbase isn't connected yet"}
        </span>
        <span className="text-faint">{ok ? "Change" : ""}</span>
      </summary>
      <div className="mt-3 grid gap-2">
        <p className="text-muted">
          The app reads a live copy of the Sales Masterbase, never the SMB itself. The copy is a separate sheet with this in
          cell A1 (Google keeps it updated), shared as Anyone with the link → Viewer. When the SMB moves to a new sheet,
          change the ID in this formula; the link here stays the same.
        </p>
        <code className="block overflow-x-auto whitespace-nowrap rounded-[10px] bg-[var(--surface-hover)] px-3 py-2 text-[12px]">{liveCopyFormula()}</code>
        <ActionForm action={saveSmbLinkAction} className="flex flex-wrap gap-2">
          <input
            name="link"
            required
            defaultValue={setting?.link ?? ""}
            placeholder="Link of the live copy (docs.google.com/spreadsheets/…)"
            className="h-10 min-w-0 flex-1 rounded-[12px] border border-[var(--border-strong)] bg-[var(--surface-solid)] px-3 text-[13px]"
            aria-label="Link of the live copy"
          />
          <SubmitButton small>Save and check</SubmitButton>
        </ActionForm>
        {setting ? <p className="text-faint">Saved by {setting.savedBy}, {shortWhen(setting.savedAt)}.</p> : null}
      </div>
    </details>
  );
}

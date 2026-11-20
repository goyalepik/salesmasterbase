import { addMasterAction, setMasterActiveAction, setMasterNoteAction } from "@/app/actions/wms";
import { ActionForm, SubmitButton } from "@/components/ops/action-form";
import { inputClass, Panel } from "@/components/ops/bits";
import { PageHeader } from "@/components/ui";
import { ensureMasters } from "@/features/wms/service";
import { MASTER_KINDS, MASTER_LABELS } from "@/features/wms/domain/types";
import { loadWmsPage } from "@/features/wms/ui/load";
import { WmsNav, WmsOff } from "@/features/wms/ui/wms-nav";
import "@/features/wms/wms.css";

export default async function WmsLists() {
  const page = await loadWmsPage();
  if (!page) return <WmsOff />;
  const masters = await ensureMasters(page.ctx);
  const canEdit = page.canRaisePo;

  return (
    <section>
      <PageHeader title="Lists" description="The choices in the warehouse dropdowns. Taking a name off keeps it on old records." />
      <WmsNav current="lists" />
      <div className="grid gap-3 lg:grid-cols-2">
        {MASTER_KINDS.map((kind) => {
          const items = masters.filter((m) => m.kind === kind);
          return (
            <Panel key={kind} title={MASTER_LABELS[kind].many} subtitle={kind === "logistics_partner" ? "Add the partner's tracking link with {awb} and the link is made for every dispatch." : undefined}>
              <ul className="grid gap-1.5">
                {items.map((m) => (
                  <li key={m.id} className="grid gap-1">
                  <div className="flex items-center justify-between gap-2 text-[14px]">
                    <span className={m.active ? "" : "text-muted line-through"}>{m.name}{kind === "logistics_partner" ? <span className="wms-muted"> · {m.note ? "tracking link set" : "no tracking link"}</span> : null}</span>
                    {canEdit ? (
                      <ActionForm action={setMasterActiveAction}>
                        <input type="hidden" name="id" value={m.id} />
                        <input type="hidden" name="active" value={m.active ? "no" : "yes"} />
                        <SubmitButton small tone="quiet">{m.active ? "Take off" : "Put back"}</SubmitButton>
                      </ActionForm>
                    ) : null}
                  </div>
                  {kind === "logistics_partner" && canEdit && m.active ? (
                    <ActionForm action={setMasterNoteAction} className="flex gap-2">
                      <input type="hidden" name="id" value={m.id} />
                      <input name="note" defaultValue={m.note ?? ""} maxLength={300} className={inputClass} placeholder="Tracking link with {awb}, e.g. https://…/track?awb={awb}" aria-label={`Tracking link for ${m.name}`} />
                      <SubmitButton small tone="quiet">Save</SubmitButton>
                    </ActionForm>
                  ) : null}
                  </li>
                ))}
                {!items.length ? <li className="text-[13px] text-muted">Nothing yet.</li> : null}
              </ul>
              {canEdit ? (
                <ActionForm action={addMasterAction} className="mt-3 flex gap-2">
                  <input type="hidden" name="kind" value={kind} />
                  <input name="name" required minLength={2} maxLength={60} className={inputClass} placeholder={`Add ${MASTER_LABELS[kind].one.toLowerCase()}`} aria-label={`Add to ${MASTER_LABELS[kind].many}`} />
                  <SubmitButton>Add</SubmitButton>
                </ActionForm>
              ) : null}
            </Panel>
          );
        })}
      </div>
    </section>
  );
}

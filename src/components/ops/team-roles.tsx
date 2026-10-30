import { savePersonAction } from "@/app/actions/ops";
import { ActionForm, SubmitButton } from "@/components/ops/action-form";
import { Field, ROLE_LABELS, inputClass } from "@/components/ops/bits";
import { HUBS, ROLES, type Person } from "@/lib/ops/types";

const ROLE_HELP: Record<(typeof ROLES)[number], string> = {
  sales: "Posts sales, cancels",
  revops: "Verifies payments",
  inventory: "Decides stock",
  procurement: "Buys and receives goods",
  logistics: "Dispatches, delivers",
  installation: "Closes installations",
  admin: "Can press everything",
};

function PersonForm({ person }: { person?: Person }) {
  return (
    <ActionForm action={savePersonAction} className="grid gap-3" resetOnSuccess={!person}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Slack user ID" hint="Slack: profile → ⋮ → Copy member ID">
          <input name="slackUserId" required defaultValue={person?.slackUserId} readOnly={!!person} placeholder="U04ABCDEF" maxLength={20} className={`${inputClass} ${person ? "opacity-70" : ""}`} />
        </Field>
        <Field label="Name">
          <input name="name" required defaultValue={person?.name} maxLength={60} placeholder="Full name" className={inputClass} />
        </Field>
        <Field label="Hub">
          <select name="hub" defaultValue={person?.hub ?? ""} className={inputClass}>
            <option value="">No hub</option>
            {HUBS.map((hub) => <option key={hub} value={hub}>{hub}</option>)}
          </select>
        </Field>
      </div>
      <fieldset>
        <legend className="mb-1 text-[12px] text-muted">Roles</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {ROLES.map((role) => (
            <label key={role} className="flex min-h-11 items-start gap-2 rounded-[12px] border border-line px-2.5 py-2 text-[13px]">
              <input type="checkbox" name="roles" value={role} defaultChecked={person?.roles.includes(role)} className="mt-0.5 size-4 shrink-0 accent-[#3478f6]" />
              <span>
                <span className="block text-ink">{ROLE_LABELS[role]}</span>
                <span className="block text-[11px] text-faint">{ROLE_HELP[role]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <SubmitButton tone={person ? "quiet" : "primary"}>{person ? "Save changes" : "Add person"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function TeamRoles({ people }: { people: Person[] }) {
  const sorted = [...people].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <section className="mb-8" id="team">
      <h2 className="text-[16px] font-semibold text-ink">Team roles</h2>
      <p className="mt-1 max-w-2xl text-[13px] text-muted">
        Decides who can press which button in Slack. <strong className="text-ink">While this list is empty, everyone can press every button.</strong> As soon as one person is added, Slack buttons check roles, and anyone not on the list is refused. Add yourself as Admin first. The dashboard itself is not limited by roles; it records the “Acting as” name.
      </p>
      <div className={`mt-3 rounded-[14px] border px-3 py-2 text-[13px] ${people.length ? "border-[rgba(71,215,160,0.45)] text-good" : "border-[rgba(244,189,80,0.45)] text-warn"}`}>
        {people.length ? `Roles are on. ${people.length} ${people.length === 1 ? "person is" : "people are"} listed.` : "Roles are off. Everyone can press every Slack button."}
      </div>
      {sorted.length ? (
        <ul className="mt-3 grid gap-2">
          {sorted.map((person) => (
            <li key={person.slackUserId} className="panel-strong px-3 py-2">
              <details className="action-more">
                <summary>
                  <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                    <span className="text-[14px] text-ink">{person.name}</span>
                    <span className="text-[12px] text-faint">{person.slackUserId}{person.hub ? ` · ${person.hub}` : ""}</span>
                    <span className="text-[12px] text-muted">{person.roles.length ? person.roles.map((r) => ROLE_LABELS[r]).join(", ") : "No roles"}</span>
                  </span>
                </summary>
                <div className="pt-2">
                  <PersonForm person={person} />
                </div>
              </details>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="panel-strong mt-3 p-4">
        <h3 className="mb-3 text-[14px] font-semibold text-ink">Add a person</h3>
        <PersonForm />
      </div>
    </section>
  );
}

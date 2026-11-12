import Link from "next/link";
import { SettingsScreen } from "@/components/settings-screen";
import { TeamRoles } from "@/components/ops/team-roles";
import { getOpsStore } from "@/lib/ops";
import { firstParam } from "@/lib/query";
import { inspectHealth } from "@/lib/health";
import { redirect } from "next/navigation";
import { readEnv } from "@/lib/env";
import { isAdmin } from "@/lib/ops-ui/actor";
import { personalCode } from "@/lib/team-login";

const LEGACY = [
  ["/inbox", "Slack inbox"],
  ["/records", "Sales records"],
  ["/contributors", "Salespeople"],
  ["/poc", "POC (Slack)"],
  ["/customers", "Customers"],
  ["/exceptions", "Exceptions"],
  ["/activity", "Activity log"],
] as const;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!(await isAdmin())) redirect("/");
  const [{ report }, params, store] = await Promise.all([inspectHealth(), searchParams, getOpsStore()]);
  const people = store ? await store.people() : null;
  const master = readEnv().dashboardAccessCode;
  const codes = people && master && master.length >= 8 ? Object.fromEntries(people.map((p) => [p.slackUserId, personalCode(master, p.slackUserId)])) : null;
  return (
    <>
      <SettingsScreen health={report} namesStatus={firstParam(params.names)} namesCount={firstParam(params.count)} buttonStatus={firstParam(params.button)} />
      <div className="mt-8">{people ? <TeamRoles people={people} codes={codes} /> : <p className="text-[13px] text-muted">Team roles can be set once the database is configured.</p>}</div>
      <section className="dashboard-panel mt-8">
        <h2 className="dashboard-panel-title">Old Slack tools</h2>
        <p className="dashboard-panel-subtitle">From before the order flow: sales read from free-text Slack lines. Kept for looking things up.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {LEGACY.map(([href, label]) => (
            <Link key={href} href={href} className="btn-quiet inline-flex h-9 items-center rounded-full px-3.5 text-[12.5px]">{label}</Link>
          ))}
        </div>
      </section>
    </>
  );
}

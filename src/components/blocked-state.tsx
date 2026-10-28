import Link from "next/link";
import type { HealthReport } from "@/lib/health";
import { PageHeader } from "@/components/ui";

export function BlockedState({ health }: { health: HealthReport }) {
  const title = health.source === "unavailable" ? "Database unavailable" : "Live mode is not configured";
  const description = health.source === "unavailable"
    ? "The required settings are present, but the database check failed. Demo messages were not shown in their place."
    : "Required live settings are missing. Demo messages were not shown in their place.";
  return (
    <section>
      <PageHeader title={title} description={description} />
      {health.missing.length > 0 ? (
        <div className="mb-4">
          <p className="text-[12px] text-muted">Missing</p>
          <ul className="mt-2 space-y-1 text-[13px]">
            {health.missing.map((item) => <li key={item} className="font-mono text-[12px]">{item}</li>)}
          </ul>
        </div>
      ) : null}
      <p className="max-w-xl text-[13px] text-muted">{health.databaseDetail}</p>
      <p className="mt-4 text-[13px]">
        <Link href="/settings" className="text-accent">Review settings</Link>
      </p>
    </section>
  );
}

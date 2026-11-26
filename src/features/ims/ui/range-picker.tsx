"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

const OPTIONS = [
  { v: "7d", label: "Last 7 days" },
  { v: "30d", label: "Last 30 days" },
  { v: "mtd", label: "This month" },
  { v: "90d", label: "Last 90 days" },
];

/** The period the flows (received, dispatched, change chips) cover. Kept in the link as ?r=. */
export function RangePicker({ value }: { value: string }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  return (
    <select
      className="ims-select"
      aria-label="Period"
      value={OPTIONS.some((o) => o.v === value) ? value : "30d"}
      onChange={(e) => {
        const next = new URLSearchParams(params.toString());
        next.set("r", e.target.value);
        router.push(`${path}?${next.toString()}`);
      }}
    >
      {OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
    </select>
  );
}

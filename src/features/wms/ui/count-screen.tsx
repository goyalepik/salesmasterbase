"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { countScanAction } from "@/app/actions/wms";
import { ScanBox } from "./scan-box";

/** Blind count: scan every unit found. Each scan is saved at once, so two phones can count the same hub. */
export function CountScreen({ number, hub, start }: { number: string; hub: string; start: number }) {
  const router = useRouter();
  const [total, setTotal] = useState(start);
  return (
    <div className="grid gap-3">
      <p className="text-[14px]"><strong className="text-[20px]">{total}</strong> counted at {hub} so far.</p>
      <ScanBox
        placeholder="Scan or type serial"
        hint="Scan every unit you find on the racks. Don't look at the list: the system compares at the end."
        onScan={async (serial) => {
          const r = await countScanAction(number, serial);
          if (!r.ok) return { tone: "bad", text: `${serial}: ${r.message}` };
          setTotal(r.total ?? total + 1);
          if (r.total && r.total % 20 === 0) router.refresh();
          return { tone: r.known ? "ok" : "warn", text: `${serial}: ${r.message}` };
        }}
      />
    </div>
  );
}

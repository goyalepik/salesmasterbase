import { Suspense } from "react";
import Link from "next/link";
import { FileScan, ListChecks, PackageCheck, ShieldCheck } from "lucide-react";
import { BlockedState } from "@/components/blocked-state";
import { ExpectedGoods } from "@/components/ops/expected-goods";
import { InventoryTabs } from "@/components/ops/inventory-tabs";
import { SectionSkeleton } from "@/components/ops/overview";
import { IncomingUpload, StockInDialog } from "@/components/ops/stock-forms";
import { loadOps } from "@/lib/ops-ui/load";

const STEPS = [
  { icon: FileScan, title: "Upload the bill", text: "Photo or PDF. The AI reads products, units, costs and serials." },
  { icon: ShieldCheck, title: "The app checks it", text: "Same bill twice, serials already in stock, cost far from last time, more than the PO expects." },
  { icon: ListChecks, title: "You confirm", text: "Fix a product or a number if needed. Lines that failed a check start unticked." },
  { icon: PackageCheck, title: "Stock is added", text: "On the PO if there is one, so waiting orders get their units first." },
];

/** Incoming: every unit enters here. Upload a bill, the app checks it, then it goes into stock. Below: what we are waiting for. */
export default async function IncomingPage() {
  const ops = await loadOps();
  if (ops.kind !== "ready") return <BlockedState health={ops.workspace.health} />;
  return (
    <section className="in">
      <InventoryTabs store={ops.store} current="incoming" />
      <div className="in-head">
        <div>
          <h1>Incoming</h1>
          <p>Goods arrived? Upload the bill. Nothing goes into stock until it is checked and you press Add.</p>
        </div>
        <StockInDialog />
      </div>
      <div className="in-top">
        <section className="in-card">
          <IncomingUpload />
        </section>
        <ol className="in-steps">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <li key={step.title}>
                <span className="in-step-icon"><Icon size={16} /></span>
                <span>
                  <b>{i + 1}. {step.title}</b>
                  <span>{step.text}</span>
                </span>
              </li>
            );
          })}
          <li className="in-step-link"><Link href="/inventory/activity" className="text-info">See everything that came in today →</Link></li>
        </ol>
      </div>
      <h2 className="in-h2">Expected deliveries</h2>
      <Suspense fallback={<SectionSkeleton height={420} />}>
        <ExpectedGoods store={ops.store} />
      </Suspense>
    </section>
  );
}

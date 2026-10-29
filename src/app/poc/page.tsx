import Link from "next/link";
import { BlockedState } from "@/components/blocked-state";
import { EmptyState, PageHeader } from "@/components/ui";
import { formatInrFromMinor, lastDaysBounds } from "@/lib/format";
import { pocBoard } from "@/lib/poc";
import { loadWorkspace } from "@/lib/workspace";

export default async function PocPage() {
  const workspace = await loadWorkspace();
  if (workspace.kind !== "ready") return <BlockedState health={workspace.health} />;
  const five = lastDaysBounds(new Date(), 5);
  const rows = await workspace.repo.listSenderActivity(five.start.toISOString(), five.end.toISOString());
  const sellers = pocBoard(rows);
  const orders = sellers.reduce((sum, seller) => sum + seller.orders, 0);
  const offered = sellers.reduce((sum, seller) => sum + seller.offeredMinor, 0);
  return (
    <section>
      <PageHeader
        title="POC"
        description="Each seller, from the POC name on the order. Last 5 days. Offered price is the product price, not money collected."
      />
      {sellers.length === 0 ? <EmptyState title="No seller in the last 5 days" detail="A sale appears here after it has a customer, a product, and an offered price." /> : (
        <>
          <dl className="mb-4 grid gap-3 sm:grid-cols-2">
            <div className="glass-stat">
              <dt className="text-[12px] text-muted">Orders</dt>
              <dd className="text-[28px] leading-none tabular-nums">{orders}</dd>
            </div>
            <div className="glass-stat">
              <dt className="text-[12px] text-muted">Offered price</dt>
              <dd className="text-[28px] leading-none tabular-nums">{formatInrFromMinor(offered)}</dd>
            </div>
          </dl>
          <div className="panel-strong overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-[13px]">
              <thead className="text-[12px] text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">POC</th>
                  <th className="px-3 py-2 font-medium">Orders</th>
                  <th className="px-3 py-2 font-medium">Offered price</th>
                  <th className="px-3 py-2 font-medium">New</th>
                  <th className="px-3 py-2 font-medium">Repeat</th>
                  <th className="px-3 py-2 font-medium">Hubs</th>
                  <th className="px-3 py-2 font-medium">Add-ons</th>
                </tr>
              </thead>
              <tbody>
                {sellers.map((seller) => (
                  <tr key={seller.name} className="border-t border-line align-top">
                    <td className="px-3 py-2">
                      <Link href={`/inbox?q=${encodeURIComponent(seller.name)}`}>{seller.name}</Link>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{seller.orders}</td>
                    <td className="px-3 py-2 tabular-nums">{formatInrFromMinor(seller.offeredMinor)}</td>
                    <td className="px-3 py-2 tabular-nums">{seller.fresh}</td>
                    <td className="px-3 py-2 tabular-nums">{seller.repeat}</td>
                    <td className="px-3 py-2">{seller.hubs.length ? seller.hubs.join(", ") : "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{seller.addons}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { poView } from "@/features/wms/service";
import { loadWmsPage } from "@/features/wms/ui/load";
import { ReceiveScreen } from "@/features/wms/ui/receive-screen";
import { WmsOff } from "@/features/wms/ui/wms-nav";
import "@/features/wms/wms.css";

export default async function ReceivePo({ params }: { params: Promise<{ po: string }> }) {
  const page = await loadWmsPage();
  if (!page) return <WmsOff />;
  const poNumber = decodeURIComponent((await params).po);
  const view = await poView(page.ctx, poNumber);
  if (!view) notFound();
  const lines = view.lines.filter((l) => l.pending > 0).map((l) => ({ sku: l.sku, name: l.product?.name ?? l.productName ?? l.sku, pending: l.pending }));
  const vendor = view.header?.vendor ?? view.lines[0]?.vendor ?? null;

  return (
    <section>
      <PageHeader
        title={`Receive ${poNumber}`}
        description={`${vendor ?? "Vendor not set"}${view.header?.hub ? ` · to ${view.header.hub}` : ""}. Scan each unit. Damaged or defective units are kept on hold.`}
        action={<Link href={`/wms/po/${encodeURIComponent(poNumber)}`} className="btn-quiet inline-flex h-10 items-center rounded-[12px] px-3.5 text-[13px] font-medium">See the PO</Link>}
      />
      {!page.canReceive ? (
        <p className="dashboard-panel text-[14px]">Only the warehouse team can receive goods. Switch to the Warehouse or Inventory role.</p>
      ) : lines.length ? (
        <ReceiveScreen poNumber={poNumber} vendor={vendor} lines={lines} />
      ) : (
        <p className="dashboard-panel text-[14px]">Everything on {poNumber} has been received.</p>
      )}
    </section>
  );
}

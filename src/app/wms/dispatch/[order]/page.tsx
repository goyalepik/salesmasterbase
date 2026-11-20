import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { dispatchQueue } from "@/features/wms/flows";
import { ensureMasters } from "@/features/wms/service";
import { DispatchScreen } from "@/features/wms/ui/dispatch-screen";
import { loadWmsPage } from "@/features/wms/ui/load";
import { WmsOff } from "@/features/wms/ui/wms-nav";
import "@/features/wms/wms.css";

export default async function DispatchOrderPage({ params }: { params: Promise<{ order: string }> }) {
  const page = await loadWmsPage();
  if (!page) return <WmsOff />;
  const orderId = decodeURIComponent((await params).order);
  const [queue, masters] = await Promise.all([dispatchQueue(page.ctx), ensureMasters(page.ctx)]);
  const row = queue.find((o) => o.orderId === orderId);
  if (!row) {
    const order = await page.ctx.ops.getOrder(orderId);
    if (!order) notFound();
    return (
      <section>
        <PageHeader title={`Send ${order.shopifyOrderId ?? order.id}`} description={order.customerName} />
        <p className="dashboard-panel text-[14px]">This order has nothing to send from the warehouse now (already sent, cancelled, waiting for payment approval, or its products have no SKU yet). <Link href={`/orders/${order.id}`} className="text-accent">Open the order</Link></p>
      </section>
    );
  }
  const partners = masters.filter((m) => m.kind === "logistics_partner" && m.active).map((m) => ({ name: m.name, hasLink: !!m.note }));
  return (
    <section>
      <PageHeader
        title={`Send ${row.label}`}
        description={`${row.customer}${row.hub ? ` · ${row.hub}` : ""}`}
        action={<Link href={`/orders/${row.orderId}`} className="btn-quiet inline-flex h-10 items-center rounded-[12px] px-3.5 text-[13px] font-medium">Open the order</Link>}
      />
      <DispatchScreen orderId={row.orderId} label={row.label} lines={row.lines.map((l) => ({ lineId: l.lineId, sku: l.sku, name: l.name, need: l.qty - l.sent }))} partners={partners} />
    </section>
  );
}

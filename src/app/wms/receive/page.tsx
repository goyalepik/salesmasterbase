import Link from "next/link";
import { Panel } from "@/components/ops/bits";
import { PageHeader } from "@/components/ui";
import { listPos } from "@/features/wms/service";
import { loadWmsPage } from "@/features/wms/ui/load";
import { WmsNav, WmsOff } from "@/features/wms/ui/wms-nav";
import { isoDateInIst } from "@/lib/format";
import { shortDate } from "@/lib/ops-ui/format";
import "@/features/wms/wms.css";

export default async function ReceivePick() {
  const page = await loadWmsPage();
  if (!page) return <WmsOff />;
  const open = (await listPos(page.ctx)).filter((p) => p.open && p.ordered > p.received);
  const today = isoDateInIst(new Date());

  return (
    <section>
      <PageHeader title="Receive goods" description="Pick the PO the goods came on. Then scan each unit's serial number." />
      <WmsNav current="receive" />
      <Panel title={`POs waiting for goods (${open.length})`} subtitle="Soonest ETA first. Past the ETA shows in red.">
        {open.length ? (
          <div className="wms-card-list">
            {open.map((p) => {
              const pending = p.ordered - p.received;
              const late = p.eta && p.eta < today;
              return (
                <Link key={p.poNumber} href={`/wms/receive/${encodeURIComponent(p.poNumber)}`} className="wms-card">
                  <div className="wms-card-top">
                    <strong>{p.poNumber}</strong>
                    <span className={late ? "text-bad text-[12.5px] font-semibold" : "wms-muted"}>{p.eta ? `ETA ${shortDate(p.eta)}` : "No ETA"}</span>
                  </div>
                  <span className="text-[13.5px]">{p.vendor ?? "Vendor not set"} · {p.products} product{p.products === 1 ? "" : "s"}</span>
                  <span className="wms-muted">{pending} of {p.ordered} still to come</span>
                  <span className="wms-bar" aria-hidden="true"><span style={{ width: `${(p.received / p.ordered) * 100}%` }} /></span>
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="text-[14px] text-muted">No PO is waiting for goods. {page.canRaisePo ? <Link href="/wms/po#new" className="text-accent">Raise a PO</Link> : "Ask procurement to raise the PO first."}</p>
        )}
      </Panel>
    </section>
  );
}

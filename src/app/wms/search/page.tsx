import Link from "next/link";
import { redirect } from "next/navigation";
import { Panel } from "@/components/ops/bits";
import { PageHeader } from "@/components/ui";
import { search } from "@/features/wms/service";
import { loadWmsPage } from "@/features/wms/ui/load";
import { WmsNav, WmsOff } from "@/features/wms/ui/wms-nav";
import { firstParam } from "@/lib/query";
import "@/features/wms/wms.css";

const KIND = { unit: "Unit", po: "PO", grn: "Receipt", order: "Order", product: "Product", sheet: "Team sheet" } as const;

export default async function WmsSearch({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const page = await loadWmsPage();
  if (!page) return <WmsOff />;
  const q = firstParam((await searchParams).q).trim().slice(0, 80);
  const hits = q ? await search(page.ctx, q) : [];
  // A scanned serial that matches one unit opens it straight away.
  if (hits.length === 1 && hits[0].href && (hits[0].kind === "unit" || hits[0].kind === "po" || hits[0].kind === "order")) redirect(hits[0].href);

  return (
    <section>
      <PageHeader title="Find" description="A serial or IMEI, a PO, a goods receipt (GRN-…), an order (EPK-… or #PIK…) or a product." />
      <WmsNav current={null} q={q} />
      <Panel title={q ? `${hits.length} result${hits.length === 1 ? "" : "s"} for “${q}”` : "Scan or type above"}>
        {hits.length ? (
          <div className="wms-card-list">
            {hits.map((h, i) => {
              const body = (
                <>
                  <div className="wms-card-top">
                    <strong>{h.title}</strong>
                    <span className="wms-badge is-quiet">{KIND[h.kind]}</span>
                  </div>
                  <span className="wms-muted">{h.detail}</span>
                </>
              );
              return h.href ? (
                <Link key={`${h.kind}-${i}`} href={h.href} className="wms-card">{body}</Link>
              ) : (
                <div key={`${h.kind}-${i}`} className="wms-card">{body}</div>
              );
            })}
          </div>
        ) : q ? (
          <p className="text-[14px] text-muted">Nothing found. Check the serial, or search the product name.</p>
        ) : null}
      </Panel>
    </section>
  );
}

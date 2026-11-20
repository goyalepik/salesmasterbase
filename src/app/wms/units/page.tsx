import Link from "next/link";
import { Panel, TableWrap } from "@/components/ops/bits";
import { PageHeader } from "@/components/ui";
import { CONDITION_LABELS, ON_HAND, UNIT_STATUS_LABELS, sellableCondition, type UnitStatus } from "@/features/wms/domain/unit";
import { loadWmsPage } from "@/features/wms/ui/load";
import { WmsNav, WmsOff } from "@/features/wms/ui/wms-nav";
import { firstParam } from "@/lib/query";
import { inr, shortWhen } from "@/lib/ops-ui/format";
import "@/features/wms/wms.css";

const VIEWS: Record<string, { label: string; statuses?: UnitStatus[] }> = {
  stock: { label: "In the warehouse", statuses: [...ON_HAND] },
  hold: { label: "On hold", statuses: ["quarantine", "damaged", "defective", "received"] },
  all: { label: "All" },
};

export default async function UnitsList({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const page = await loadWmsPage();
  if (!page) return <WmsOff />;
  const params = await searchParams;
  const sku = firstParam(params.sku).trim().slice(0, 60) || undefined;
  const po = firstParam(params.po).trim().slice(0, 60) || undefined;
  const status = VIEWS[firstParam(params.status)] ? firstParam(params.status) : "stock";
  const [units, product] = await Promise.all([page.ctx.wms.listUnits({ sku, poNumber: po, statuses: VIEWS[status].statuses, limit: 1000 }), sku ? page.ctx.ops.getProduct(sku) : null]);
  const base = (s: string) => `/wms/units?${new URLSearchParams({ ...(sku ? { sku } : {}), ...(po ? { po } : {}), status: s })}`;

  return (
    <section>
      <PageHeader title={product?.name ?? "Units"} description={[sku, po ? `on ${po}` : null].filter(Boolean).join(" · ") || "Every unit with a serial number."} />
      <WmsNav current="stock" />
      <nav className="s-chips" aria-label="Which units">
        {Object.entries(VIEWS).map(([id, v]) => (
          <Link key={id} href={base(id)} aria-current={status === id ? "page" : undefined}>{v.label}</Link>
        ))}
      </nav>
      <Panel title={`${units.length} unit${units.length === 1 ? "" : "s"}`} subtitle="Newest first. Tap a serial for its history.">
        {units.length ? (
          <TableWrap minWidth={720}>
            <thead>
              <tr>
                <th>Serial</th>
                {!sku ? <th>SKU</th> : null}
                <th>Condition</th>
                <th>Status</th>
                <th>Where</th>
                {page.showCost ? <th className="num">Cost</th> : null}
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {units.map((u) => (
                <tr key={u.id}>
                  <td><Link href={`/wms/units/${u.id}`} className="font-medium text-accent">{u.serial}</Link></td>
                  {!sku ? <td className="wms-muted">{u.sku}</td> : null}
                  <td><span className={`wms-badge ${sellableCondition(u.condition) ? "is-quiet" : "is-bad"}`}>{CONDITION_LABELS[u.condition]}</span></td>
                  <td>{UNIT_STATUS_LABELS[u.status]}</td>
                  <td>{u.hub ?? "—"}</td>
                  {page.showCost ? <td className="num">{inr(u.unitCostMinor)}</td> : null}
                  <td className="wms-muted">{shortWhen(u.receivedAt)}{u.poNumber ? ` · ${u.poNumber}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : (
          <p className="text-[14px] text-muted">No units here.</p>
        )}
      </Panel>
    </section>
  );
}

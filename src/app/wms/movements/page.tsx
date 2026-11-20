import { Panel, TableWrap } from "@/components/ops/bits";
import { PageHeader } from "@/components/ui";
import { dailyMovement } from "@/features/wms/insights";
import { loadWmsPage } from "@/features/wms/ui/load";
import { WmsNav, WmsOff } from "@/features/wms/ui/wms-nav";
import { isoDateInIst } from "@/lib/format";
import { firstParam } from "@/lib/query";
import { shortDate } from "@/lib/ops-ui/format";
import "@/features/wms/wms.css";

export default async function DayReport({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const page = await loadWmsPage();
  if (!page) return <WmsOff />;
  const params = await searchParams;
  const today = isoDateInIst(new Date());
  const asked = firstParam(params.date);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= today ? asked : today;
  const all = firstParam(params.all) === "1";
  const rows = await dailyMovement(page.ctx, date, all);
  const sum = (k: "opening" | "inward" | "dispatch" | "returns" | "adjust" | "closing") => rows.reduce((s, r) => s + r[k], 0);

  return (
    <section>
      <PageHeader title="Day report" description="Per product for one day: opening, came in, went out, came back, corrections, closing. Worked out from the stock ledger, nobody types it." />
      <WmsNav current="day" />
      <form action="/wms/movements" className="mb-3 flex flex-wrap items-center gap-2">
        <label className="text-[13px] text-muted" htmlFor="day">Day</label>
        <input id="day" type="date" name="date" defaultValue={date} max={today} className="field h-11 px-3 text-[14px]" />
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="all" value="1" defaultChecked={all} className="h-5 w-5" /> Every product in stock</label>
        <button type="submit" className="glow-button h-11 rounded-[14px] px-4 text-[14px] font-medium text-white">Show</button>
      </form>
      <Panel title={`${shortDate(date)}: ${rows.length} product${rows.length === 1 ? "" : "s"}${all ? "" : " with movement"}`}>
        <TableWrap minWidth={760}>
          <thead>
            <tr><th>Product</th><th className="num">Opening</th><th className="num">In</th><th className="num">Out</th><th className="num">Back</th><th className="num">Corrections</th><th className="num">Closing</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sku}>
                <td><span className="wms-clamp-1 font-medium" title={r.name}>{r.name}</span><div className="wms-muted">{r.sku}</div></td>
                <td className="num">{r.opening}</td>
                <td className="num">{r.inward || ""}</td>
                <td className="num">{r.dispatch || ""}</td>
                <td className="num">{r.returns || ""}</td>
                <td className="num">{r.adjust || ""}</td>
                <td className="num font-semibold">{r.closing}</td>
              </tr>
            ))}
            {rows.length ? (
              <tr className="font-semibold"><td>Total</td><td className="num">{sum("opening")}</td><td className="num">{sum("inward")}</td><td className="num">{sum("dispatch")}</td><td className="num">{sum("returns")}</td><td className="num">{sum("adjust")}</td><td className="num">{sum("closing")}</td></tr>
            ) : null}
          </tbody>
        </TableWrap>
        {!rows.length ? <p className="mt-2 text-[14px] text-muted">No stock moved this day.</p> : null}
      </Panel>
    </section>
  );
}

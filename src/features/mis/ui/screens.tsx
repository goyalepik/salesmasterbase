"use client";

import { useState } from "react";
import type { Cell, MisReport, MisTable } from "../lib/types";
import { BarList, Columns, Donut, Lines, Meter, StackBar, Waterfall, type BarRow, type Segment, type Step } from "./charts";
import { cleanLabel, col, count, inUnit, lakh, metric, monthName, num, pct, rupees, shortMonth, text } from "./format";
import { Delta, Mark, Panel, useMis, type Detail } from "./kit";

const C = { blue: "#2a78d6", orange: "#eb6834", aqua: "#1baf7a", yellow: "#eda100", magenta: "#e87ba4", green: "#008300", violet: "#6250d6", red: "#e34948", grey: "#c9c5ba" };
const SLOTS = [C.blue, C.orange, C.aqua, C.yellow, C.magenta, C.violet];

type P = { r: MisReport };

const src = (r: MisReport, tab: string) => `${r.source}, tab "${tab}" (${monthName(r.month)} vs ${monthName(r.prev)})`;
const v = (t: MisTable, row: Cell[], name: string) => num(row[col(t, name)]);
const momText = (n: number | null) => (n == null ? null : `${n > 0 ? "+" : ""}${n.toFixed(1)}%`);
const isReal = (label: string) => label !== "" && !/^(Other \/ new values|Other \/ blank)/i.test(label);

/** Every "dimension" table (category, brand, channel, hub, POC) has the same columns. */
function dimDetail(r: MisReport, t: MisTable, row: Cell[], tab: string, kind: string): Detail {
  const name = cleanLabel(text(row[0]));
  const rows: [string, string][] = [
    ["NMV incl. GST", lakh(v(t, row, "NMV incl"))],
    ["Share of NMV", pct(v(t, row, "Share of NMV"))],
    ["Net revenue", lakh(v(t, row, "Net revenue"))],
    ["GMV", lakh(v(t, row, "GMV"))],
    ["Discount", pct(v(t, row, "Disc %"))],
    ["Net margin", pct(v(t, row, "Net margin %"))],
    ["Lines sold", count(v(t, row, "Lines"))],
    ["Customers", count(v(t, row, "Customers"))],
    ["NMV per line", rupees(v(t, row, "NMV per line"))],
    [`NMV in ${monthName(r.prev)}`, lakh(v(t, row, "NMV prev"))],
    ["Refunded, RTO or fraud", lakh(v(t, row, "Refunded"))],
  ];
  return {
    kicker: kind,
    title: name,
    value: lakh(v(t, row, "NMV incl")),
    delta: { mom: momText(v(t, row, "MoM")), better: "up" },
    rows,
    method: "Net lines only: payment filled and not refunded, delivery status not fraud, RTO or blank. NMV is the deal value including GST. Customers are counted once, under the row where they first appear.",
    sample: `${count(v(t, row, "Lines"))} of ${count(num(t.total?.[1]))} net lines this month`,
    source: src(r, tab),
  };
}

/* ================================ Overview ================================ */

const KPIS: { label: string; m: string; better?: "up" | "down" }[] = [
  { label: "Net revenue", m: "Net revenue (NMV excl. GST)" },
  { label: "NMV (incl. GST)", m: "NMV (incl. GST)" },
  { label: "Orders", m: "Orders (unique)" },
  { label: "Customers", m: "Customers (unique)" },
  { label: "Average order", m: "Average order value (NMV incl. GST)" },
  { label: "Net margin", m: "Net margin %" },
  { label: "EBITDA", m: "EBITDA" },
  { label: "Demos completed", m: "Demos completed" },
];

function metricDetail(r: MisReport, label: string, title?: string, better: "up" | "down" = "up"): Detail {
  const m = metric(r, label);
  return {
    kicker: "Key number",
    title: title ?? m.label,
    value: inUnit(m.unit, m.cur),
    delta: { mom: m.mom, better },
    rows: [
      [monthName(r.month), inUnit(m.unit, m.cur)],
      [monthName(r.prev), inUnit(m.unit, m.prev)],
      ["Change", m.mom && m.mom !== "-" ? m.mom : "Not comparable"],
    ],
    method: m.def ?? undefined,
    source: src(r, "Executive Summary"),
  };
}

export function Overview({ r }: P) {
  const p = (label: string) => r.pnl.find((x) => x.label.startsWith(label));
  const m = (label: string) => metric(r, label).cur ?? 0;
  const step = (label: string, value: number, kind: Step["kind"], metricLabel: string | null, method: string): Step => ({
    label,
    value,
    kind,
    display: lakh(value),
    detail: metricLabel ? { ...metricDetail(r, metricLabel, label, kind === "delta" && value < 0 ? "down" : "up"), kicker: "Bookings to net revenue", method } : { kicker: "Bookings to net revenue", title: label, value: lakh(value), method, source: src(r, "P&L Unit Economics") },
  });
  const blank = p("Add: NMV on lines where col BF is blank")?.cur ?? 0;
  const steps: Step[] = [
    step("GMV booked", m("Gross bookings - GMV (all line items)"), "start", "Gross bookings - GMV (all line items)", "Every line booked in the month at list price (GMV), before anything is taken off."),
    step("Unconfirmed", -m("Less: unconfirmed (col S or col AG blank)"), "delta", "Less: unconfirmed (col S or col AG blank)", "Payment or delivery status still blank, so not counted yet."),
    step("Refund / RTO", -m("Less: refunded / RTO"), "delta", "Less: refunded / RTO", "Refunded, or returned to origin."),
    step("Fraud", -m("Less: fraudulent transactions"), "delta", "Less: fraudulent transactions", "Marked as a fraudulent transaction."),
    step("Net GMV", m("Net GMV"), "subtotal", "Net GMV", "GMV on confirmed lines."),
    step("Discounts", -m("Less: discounts"), "delta", "Less: discounts", "List price minus deal price on confirmed lines."),
    step("No list price", blank, "delta", null, "Lines where the tracker says \"Update GMV/SKU Qty\" have no list price, so their deal value is added here."),
    step("NMV", m("NMV (incl. GST)"), "subtotal", "NMV (incl. GST)", "Deal value of confirmed lines, including GST."),
    step("GST", -m("Less: GST"), "delta", "Less: GST", "NMV minus NMV excluding GST."),
    step("Net revenue", m("Net revenue (NMV excl. GST)"), "total", "Net revenue (NMV excl. GST)", "Deal value of confirmed lines, without GST."),
  ];

  const notes = r.notes;
  const after = (head: string) => notes[notes.indexOf(head) + 1] ?? "";
  const hiStart = notes.findIndex((n) => /performance highlights/i.test(n));
  const hiEnd = notes.indexOf("Management commentary");
  const bullets = hiStart >= 0 ? notes.slice(hiStart + 1, hiEnd > hiStart ? hiEnd : undefined) : [];
  const actions = after("Key actions next month").split(/\s*\d\)\s*/).filter(Boolean);
  const checks = metric(r, "Tie-out checks passed").cur;

  return (
    <div className="scr scr-overview">
      <div className="kpis">
        {KPIS.map((k) => {
          const mm = metric(r, k.m);
          return (
            <Mark key={k.m} detail={metricDetail(r, k.m, k.label, k.better)} className={`kpi ${(mm.cur ?? 0) < 0 ? "is-neg" : ""}`}>
              <span className="kpi-label">{k.label}</span>
              <b className="kpi-value">{inUnit(mm.unit, mm.cur)}</b>
              <span className="kpi-foot">
                <Delta mom={mm.mom} better={k.better} />
                <i>{shortMonth(r.prev)} {inUnit(mm.unit, mm.prev)}</i>
              </span>
            </Mark>
          );
        })}
      </div>
      <Panel className="ov-walk" title="From bookings to net revenue" sub={`₹ lakhs · ${count(metric(r, "Line items").cur)} net lines out of ${count(num(r.status.total?.[1]))} booked · ${checks ?? 0} of ${checks ?? 0} tie-out checks passed`}>
        <Waterfall steps={steps} />
      </Panel>
      <Panel className="ov-story" title="The month in short" sub="From the management commentary">
        <ul className="story">
          {bullets.slice(0, 6).map((b) => (
            <li key={b}>
              <Mark detail={{ kicker: "Highlight", title: b.split(/[;.]/)[0], note: b, source: src(r, "Executive Summary") }} className="story-line">{b}</Mark>
            </li>
          ))}
        </ul>
        <div className="story-cards">
          <Mark className="story-card is-risk" detail={{ kicker: "Lowlights and risks", title: "What went wrong", note: after("Lowlights / risks"), source: src(r, "Executive Summary") }}>
            <b>Risks</b><span>{after("Lowlights / risks").split(". ")[0]}.</span>
          </Mark>
          <Mark className="story-card is-act" detail={{ kicker: "Key actions next month", title: `${actions.length} actions`, rows: actions.map((a, i) => [`${i + 1}`, a.replace(/\.$/, "")] as [string, string]), source: src(r, "Executive Summary") }}>
            <b>{actions.length} actions</b><span>{actions[0]}</span>
          </Mark>
          <Mark className="story-card is-ask" detail={{ kicker: "Asks", title: "Support needed", note: after("Asks / support needed"), source: src(r, "Executive Summary") }}>
            <b>Asks</b><span>{after("Asks / support needed").split(". ")[0]}.</span>
          </Mark>
        </div>
      </Panel>
    </div>
  );
}

/* ================================ P&L ================================ */

const plain = (label: string) => {
  const out = label.replace(/\s*\(col [^)]*\)/gi, "").replace(/^(Less|Add): /, "").replace(/ \/ scheme income/, "").trim();
  return out.charAt(0).toUpperCase() + out.slice(1);
};

export function Pnl({ r }: P) {
  const line = (start: string) => r.pnl.find((x) => x.label.startsWith(start));
  const amt = (start: string) => line(start)?.cur ?? 0;
  const detailFor = (start: string, better: "up" | "down" = "up"): Detail => {
    const l = line(start);
    return {
      kicker: "P&L",
      title: plain(l?.label ?? start),
      value: lakh(l?.cur ?? null, 2),
      delta: { mom: l?.mom ?? null, better },
      rows: [
        [monthName(r.month), lakh(l?.cur ?? null, 2)],
        [monthName(r.prev), lakh(l?.prev ?? null, 2)],
        ["Share of net revenue", l?.pctRev ?? "Not given"],
        ["Where the number comes from", l?.basis === "Inputs" ? "Finance inputs (provisional for this month)" : "Sales Tracker, net lines"],
      ],
      note: l?.note ?? undefined,
      source: src(r, "P&L Unit Economics"),
    };
  };
  const s = (label: string, start: string, kind: Step["kind"], sign = 1, better: "up" | "down" = "up"): Step => ({ label, value: sign * amt(start), kind, display: lakh(sign * amt(start)), detail: detailFor(start, better) });
  const steps: Step[] = [
    s("Margin after discount", "Net margin after discount", "start"),
    s("Brand support", "Add: brand support", "delta"),
    s("Net margin", "Net margin incl. brand support", "subtotal"),
    s("Demo partners", "Less: Demo Partner Cost - Existing", "delta", -1, "down"),
    s("Hub", "Less: Hub Cost", "delta", -1, "down"),
    s("Delivery", "Less: Outward Logistics", "delta", -1, "down"),
    s("CM1", "CM1", "subtotal"),
    s("Salaries", "Less: Salary Cost", "delta", -1, "down"),
    s("New demo partners", "Less: Demo Partner Cost - New", "delta", -1, "down"),
    s("Rent", "Less: Rent and Utilities", "delta", -1, "down"),
    s("Professional fees", "Less: Professional Fees", "delta", -1, "down"),
    s("Consultants", "Less: Marketing Consultants", "delta", -1, "down"),
    s("EBITDA", "EBITDA", "total"),
  ];
  const tableRows: { start: string; better?: "up" | "down"; strong?: boolean }[] = [
    { start: "Net revenue (col BN", strong: true },
    { start: "Less: COGS", better: "down" },
    { start: "Gross margin before discount (col BT)" },
    { start: "Less: discount impact", better: "down" },
    { start: "Net margin after discount (col BV)" },
    { start: "Add: brand support" },
    { start: "Net margin incl. brand support", strong: true },
    { start: "CM1", strong: true },
    { start: "EBITDA", strong: true },
  ];
  const ratios: { label: string; start: string }[] = [
    { label: "Gross margin before discount", start: "Gross margin % before discount" },
    { label: "Net margin before brand support", start: "Net margin % (col BV" },
    { label: "Net margin with brand support", start: "Net margin % of net revenue" },
    { label: "CM1", start: "CM1 % of net revenue" },
    { label: "EBITDA", start: "EBITDA % of net revenue" },
  ];
  const provisional = r.pnl.some((x) => x.basis === "Inputs");

  return (
    <div className="scr scr-pnl">
      <Panel className="pnl-bridge" title="From margin to EBITDA" sub={`₹ lakhs · ${monthName(r.month)} · CM2 and CM3 equal CM1 because marketing spend is not entered yet`} aside={provisional ? <span className="chip is-warn">Costs provisional</span> : null}>
        <Waterfall steps={steps} />
      </Panel>
      <Panel className="pnl-table" title="P&L" sub={`₹ lakhs · ${monthName(r.month)} vs ${monthName(r.prev)}`}>
        <div className="tbl">
          <div className="tbl-head pnl-grid"><span>Line</span><span>{shortMonth(r.month)}</span><span>{shortMonth(r.prev)}</span><span>Change</span><span>% rev</span></div>
          {tableRows.map((t) => {
            const l = line(t.start);
            if (!l) return null;
            return (
              <Mark key={t.start} detail={detailFor(t.start, t.better)} className={`tbl-row pnl-grid ${t.strong ? "is-strong" : ""}`}>
                <span>{plain(l.label)}</span>
                <span className={(l.cur ?? 0) < 0 ? "is-neg" : ""}>{lakh(l.cur, 2)}</span>
                <span className="is-muted">{lakh(l.prev, 2)}</span>
                <span>{l.prev == null && l.cur != null ? <span className="mis-delta is-flat">New</span> : <Delta mom={l.mom} better={t.better} />}</span>
                <span className="is-muted">{l.pctRev ?? ""}</span>
              </Mark>
            );
          })}
        </div>
        <div className="ladder">
          {ratios.map((x) => {
            const l = line(x.start);
            return (
              <Mark key={x.start} detail={{ ...detailFor(x.start), value: pct(l?.cur ?? null), rows: [[monthName(r.month), pct(l?.cur ?? null)], [monthName(r.prev), pct(l?.prev ?? null)], ["Change", l?.mom ?? ""]] }} className={`ladder-step ${(l?.cur ?? 0) < 0 ? "is-neg" : ""}`}>
                <b>{pct(l?.cur ?? null)}</b>
                <span>{x.label}</span>
              </Mark>
            );
          })}
        </div>
      </Panel>
      <div className="unit-strip">
        {r.unit.map((u) => {
          const better = /cost/i.test(u.label) ? "down" : "up";
          return (
            <Mark key={u.label} className={`unit ${(u.cur ?? 0) < 0 ? "is-neg" : ""}`} detail={{ kicker: "Per order", title: u.label, value: u.basis === "₹" ? rupees(u.cur) : count(u.cur), delta: { mom: u.mom, better }, rows: [[monthName(r.month), u.basis === "₹" ? rupees(u.cur) : count(u.cur)], [monthName(r.prev), u.basis === "₹" ? rupees(u.prev) : count(u.prev)], ["Change", u.mom ?? ""]], source: src(r, "P&L Unit Economics") }}>
              <span>{u.label.replace(" (NMV incl. GST)", "").replace(" (incl. brand support)", "")}</span>
              <b>{u.basis === "₹" ? rupees(u.cur) : count(u.cur)}</b>
              <Delta mom={u.mom} better={better} />
            </Mark>
          );
        })}
      </div>
    </div>
  );
}

/* ================================ Mix ================================ */

export function Mix({ r }: P) {
  const cat = r.category;
  const cats = cat.rows.filter((row) => isReal(text(row[0])) && (v(cat, row, "NMV incl") ?? 0) > 0).sort((a, b) => (v(cat, b, "NMV incl") ?? 0) - (v(cat, a, "NMV incl") ?? 0));
  const top = cats.slice(0, 5);
  const rest = cats.slice(5);
  const restNmv = rest.reduce((s, row) => s + (v(cat, row, "NMV incl") ?? 0), 0);
  const totalNmv = num(cat.total?.[col(cat, "NMV incl")]) ?? 0;
  const slices = [
    ...top.map((row, i) => ({ label: text(row[0]), value: v(cat, row, "NMV incl") ?? 0, color: SLOTS[i], detail: dimDetail(r, cat, row, "Category", "Category") })),
    { label: "Other", value: restNmv, color: C.grey, detail: { kicker: "Category", title: `${rest.length} smaller categories`, value: lakh(restNmv), table: { head: ["Category", "NMV", "Share"], rows: rest.map((row) => [text(row[0]), lakh(v(cat, row, "NMV incl")), pct(v(cat, row, "Share of NMV"))]) }, source: src(r, "Category") } },
  ];

  const br = r.brand;
  const brands = br.rows.filter((row) => isReal(text(row[0])) && (v(br, row, "NMV incl") ?? 0) > 0).sort((a, b) => (v(br, b, "NMV incl") ?? 0) - (v(br, a, "NMV incl") ?? 0));
  const brandRows: BarRow[] = brands.slice(0, 10).map((row) => ({
    label: text(row[0]),
    sub: `${count(v(br, row, "Lines"))} lines · ${v(br, row, "Net margin %") == null ? "no unit cost" : `margin ${pct(v(br, row, "Net margin %"))}`}`,
    value: v(br, row, "NMV incl") ?? 0,
    prev: v(br, row, "NMV prev"),
    display: lakh(v(br, row, "NMV incl")),
    tone: (v(br, row, "Net margin %") ?? 0) < 0 ? "neg" : undefined,
    right: <Delta mom={momText(v(br, row, "MoM"))} isNew={!v(br, row, "NMV prev")} />,
    detail: dimDetail(r, br, row, "Brand & Model", "Brand"),
  }));

  const seg = r.segment;
  const segColors = [C.blue, C.orange, C.aqua];
  const segDetail = (row: Cell[]): Detail => ({
    kicker: "Customer type",
    title: text(row[0]),
    value: lakh(v(seg, row, "NMV incl")),
    delta: { mom: momText(v(seg, row, "MoM")) },
    rows: [["Share of NMV", pct(v(seg, row, "Share of NMV"))], ["Customers", count(v(seg, row, "Customers"))], ["Lines", count(v(seg, row, "Lines"))], ["Net revenue", lakh(v(seg, row, "Net revenue"))], [monthName(r.prev), lakh(v(seg, row, "NMV prev"))]],
    method: "B2B means the B2B flag is set, or the customer name has a company word in it. Internal means a purchase by Vivavilla itself.",
    source: src(r, "Customers & Ops"),
  });
  const segNow: Segment[] = seg.rows.map((row, i) => ({ label: text(row[0]).replace(" / own entity", ""), value: v(seg, row, "NMV incl") ?? 0, color: segColors[i % 3], display: lakh(v(seg, row, "NMV incl")), detail: segDetail(row) }));
  const segPrev: Segment[] = seg.rows.map((row, i) => ({ label: text(row[0]).replace(" / own entity", ""), value: v(seg, row, "NMV prev") ?? 0, color: segColors[i % 3], display: lakh(v(seg, row, "NMV prev")), detail: segDetail(row) }));

  const cx = r.cxType;
  const cxRows = cx.rows.filter((row) => (v(cx, row, "Customers") ?? 0) > 0);
  const cxSeg: Segment[] = cxRows.map((row, i) => ({
    label: text(row[0]),
    value: v(cx, row, "Customers") ?? 0,
    color: [C.blue, C.aqua, C.grey][i] ?? C.grey,
    display: count(v(cx, row, "Customers")),
    detail: { kicker: "Customers", title: `${text(row[0])} customers`, value: count(v(cx, row, "Customers")), rows: [["Share of customers", pct(v(cx, row, "Share of customers"))], ["NMV", lakh(v(cx, row, "NMV incl"))], ["NMV per customer", rupees(v(cx, row, "NMV per customer"))], [`Customers in ${monthName(r.prev)}`, count(v(cx, row, "Customers prev"))]], method: "From the CX Type column of the Sales Tracker. Not tagged means the column was left blank.", source: src(r, "Customers & Ops") },
  }));
  const repeat = metric(r, "Repeat share (tagged customers)");

  return (
    <div className="scr scr-mix">
      <Panel className="mix-cat" title="What sold" sub={`Share of NMV by category · ${count(num(cat.total?.[1]))} net lines`}>
        <div className="mix-cat-body">
          <Donut slices={slices} center={lakh(totalNmv)} sub="NMV" size={200} />
          <ul className="cat-list">
            {cats.slice(0, 8).map((row, i) => (
              <li key={text(row[0])}>
                <Mark detail={dimDetail(r, cat, row, "Category", "Category")} className="cat-row">
                  <i style={{ background: i < 5 ? SLOTS[i] : C.grey }} />
                  <span className="cat-name">{text(row[0])}</span>
                  <b>{lakh(v(cat, row, "NMV incl"))}</b>
                  <span className="cat-share">{pct(v(cat, row, "Share of NMV"), 0)}</span>
                  <span className={`cat-margin ${(v(cat, row, "Net margin %") ?? 0) < 0 ? "is-neg" : ""}`}>{pct(v(cat, row, "Net margin %"))}</span>
                </Mark>
              </li>
            ))}
          </ul>
        </div>
        <p className="panel-note">Columns: NMV, share of NMV, net margin. {cats[0] ? `${text(cats[0][0])} is ${pct(v(cat, cats[0], "Share of NMV"), 0)} of NMV at ${pct(v(cat, cats[0], "Net margin %"))} net margin.` : null}</p>
      </Panel>
      <Panel className="mix-brand" title="Top 10 brands" sub={`NMV, with ${monthName(r.prev)} as a tick · red bars lose money`}>
        <BarList rows={brandRows} dense />
      </Panel>
      <Panel className="mix-cx" title="Who bought" sub={`NMV by customer type · ${count(metric(r, "Customers (unique)").cur)} customers`}>
        <div className="mix-seg">
          <p className="mix-seg-label">{monthName(r.month)}</p>
          <StackBar segments={segNow} legend={false} />
          <p className="mix-seg-label">{monthName(r.prev)}</p>
          <StackBar segments={segPrev} legend={false} />
          <div className="seg-change">
            {seg.rows.map((row, i) => (
              <Mark key={text(row[0])} detail={segDetail(row)} className="seg-change-row">
                <i style={{ background: segColors[i % 3] }} />
                <span>{text(row[0]).replace(" / own entity", "")}</span>
                <b>{lakh(v(seg, row, "NMV incl"))}</b>
                <span className="is-muted">{lakh(v(seg, row, "NMV prev"))}</span>
                <Delta mom={momText(v(seg, row, "MoM"))} />
              </Mark>
            ))}
          </div>
        </div>
        <div className="mix-new">
          <p className="mix-seg-label">New vs repeat customers</p>
          <StackBar segments={cxSeg} />
          <Mark className="mix-repeat" detail={metricDetail(r, "Repeat share (tagged customers)", "Repeat share")}>
            <b>{pct(repeat.cur)}</b><span>of tagged customers came back</span><Delta mom={repeat.mom} />
          </Mark>
        </div>
      </Panel>
    </div>
  );
}

/* ================================ Sales team ================================ */

function dimBars(r: MisReport, t: MisTable, tab: string, kind: string, limit = 10): BarRow[] {
  return t.rows
    .filter((row) => isReal(text(row[0])) && (v(t, row, "NMV incl") ?? 0) > 0)
    .sort((a, b) => (v(t, b, "NMV incl") ?? 0) - (v(t, a, "NMV incl") ?? 0))
    .slice(0, limit)
    .map((row) => ({
      label: cleanLabel(text(row[0])),
      sub: `${count(v(t, row, "Customers"))} customers · ${v(t, row, "Net margin %") == null ? "no unit cost" : `margin ${pct(v(t, row, "Net margin %"))}`}`,
      value: v(t, row, "NMV incl") ?? 0,
      prev: v(t, row, "NMV prev"),
      display: lakh(v(t, row, "NMV incl")),
      tone: text(row[0]) === "Not tagged" ? "muted" : (v(t, row, "Net margin %") ?? 0) < 0 ? "neg" : undefined,
      right: text(row[0]) === "Not tagged" ? null : <Delta mom={momText(v(t, row, "MoM"))} isNew={!v(t, row, "NMV prev")} />,
      detail: dimDetail(r, t, row, tab, kind),
    }));
}

export function SalesTeam({ r }: P) {
  const { open } = useMis();
  const [sort, setSort] = useState<"nmv" | "customers" | "margin">("nmv");
  const poc = r.poc;
  const people = poc.rows.filter((row) => isReal(text(row[0])) && text(row[0]) !== "Not tagged" && (v(poc, row, "NMV incl") ?? 0) > 0);
  const key = (row: Cell[]) => (sort === "nmv" ? v(poc, row, "NMV incl") : sort === "customers" ? v(poc, row, "Customers") : v(poc, row, "Net margin %")) ?? -999;
  const ranked = [...people].sort((a, b) => key(b) - key(a));
  const maxNmv = Math.max(...people.map((row) => v(poc, row, "NMV incl") ?? 0), 1);

  const st = r.saleType;
  const stSeg: Segment[] = st.rows.filter((row) => (v(st, row, "NMV incl") ?? 0) > 0).map((row, i) => ({ label: text(row[0]), value: v(st, row, "NMV incl") ?? 0, color: [C.blue, C.orange, C.grey][i] ?? C.grey, display: lakh(v(st, row, "NMV incl")), detail: dimDetail(r, st, row, "Channel Hub POC", "Sale type") }));

  const allTable = {
    head: ["POC", "NMV", "Lines", "Customers", "Margin", "Change"],
    rows: [...people].sort((a, b) => (v(poc, b, "NMV incl") ?? 0) - (v(poc, a, "NMV incl") ?? 0)).map((row) => [text(row[0]), lakh(v(poc, row, "NMV incl")), count(v(poc, row, "Lines")), count(v(poc, row, "Customers")), pct(v(poc, row, "Net margin %")), momText(v(poc, row, "MoM")) ?? "New"]),
  };

  return (
    <div className="scr scr-sales">
      <Panel className="sl-channel" title="Where sales came from" sub={`Sale source · NMV, ${monthName(r.prev)} as a tick`}>
        <BarList rows={dimBars(r, r.channel, "Channel Hub POC", "Sale source", 8)} dense />
      </Panel>
      <Panel className="sl-hub" title="Hubs" sub="NMV by the seller's hub">
        <BarList rows={dimBars(r, r.hub, "Channel Hub POC", "Hub", 8)} dense />
      </Panel>
      <Panel className="sl-type" title="Same day or follow-up" sub="Was it sold at the demo, or later?">
        <StackBar segments={stSeg} />
      </Panel>
      <Panel
        className="sl-poc"
        title="Sales people"
        sub={`${people.length} POCs with a sale this month`}
        aside={
          <div className="seg-ctl" role="group" aria-label="Sort sales people">
            {(["nmv", "customers", "margin"] as const).map((k) => (
              <button key={k} type="button" aria-pressed={sort === k} onClick={() => setSort(k)}>{k === "nmv" ? "NMV" : k === "customers" ? "Customers" : "Margin"}</button>
            ))}
          </div>
        }
      >
        <ol className="lb">
          {ranked.slice(0, 13).map((row, i) => {
            const nmv = v(poc, row, "NMV incl") ?? 0;
            const margin = v(poc, row, "Net margin %");
            const channel = /shopify|online/i.test(text(row[0]));
            return (
              <li key={text(row[0])}>
                <Mark detail={dimDetail(r, poc, row, "Channel Hub POC", channel ? "Channel" : "Sales person")} className="lb-row">
                  <span className="lb-rank">{i + 1}</span>
                  <span className="lb-name">{text(row[0])}{channel ? <i>online</i> : null}</span>
                  <span className="lb-bar"><span style={{ width: `${(nmv / maxNmv) * 100}%` }} /></span>
                  <b>{lakh(nmv)}</b>
                  <span className="lb-num">{count(v(poc, row, "Customers"))}</span>
                  <span className={`lb-num ${(margin ?? 0) < 0 ? "is-neg" : ""}`}>{pct(margin)}</span>
                </Mark>
              </li>
            );
          })}
        </ol>
        <button type="button" className="link-btn" onClick={() => open({ kicker: "Sales people", title: `All ${people.length} POCs`, table: allTable, method: "POC is the seller typed on the sale. Shopify Direct is the online store.", source: src(r, "Channel Hub POC") })}>
          See all {people.length}
        </button>
      </Panel>
    </div>
  );
}

/* ================================ Operations ================================ */

export function Operations({ r }: P) {
  const sb = r.status;
  const stColors = [C.blue, C.yellow, C.orange, C.red];
  const statusSeg: Segment[] = sb.rows.filter((row) => (v(sb, row, "GMV") ?? 0) > 0).map((row, i) => ({
    label: text(row[0]),
    value: v(sb, row, "GMV") ?? 0,
    color: stColors[i] ?? C.grey,
    display: `${lakh(v(sb, row, "GMV"))} · ${pct(v(sb, row, "% of GMV"), 0)}`,
    detail: { kicker: "Order status", title: text(row[0]), value: lakh(v(sb, row, "GMV")), rows: [["Share of GMV booked", pct(v(sb, row, "% of GMV"))], ["NMV", lakh(v(sb, row, "NMV incl"))], ["Lines", count(v(sb, row, "Lines"))], [`Lines in ${monthName(r.prev)}`, count(v(sb, row, "Lines prev"))], [`GMV in ${monthName(r.prev)}`, lakh(v(sb, row, "GMV prev"))]], method: "Each line falls in one bucket, in this order: fraudulent, refunded or RTO, not confirmed (payment or delivery status blank), confirmed.", sample: `${count(num(sb.total?.[1]))} lines booked`, source: src(r, "Customers & Ops") },
  }));

  const pay = r.payment;
  const nmv = num(pay.total?.[col(pay, "NMV incl")]) ?? 0;
  const paid = num(pay.total?.[col(pay, "Amount paid")]) ?? 0;
  const pending = num(pay.total?.[col(pay, "Balance pending")]) ?? 0;
  const payDetail: Detail = { kicker: "Collections", title: "Cash collected", value: lakh(paid), rows: [["NMV", lakh(nmv)], ["Collected", lakh(paid)], ["Still to collect", lakh(pending)], ...pay.rows.filter((row) => (v(pay, row, "Lines") ?? 0) > 0).map((row) => [text(row[0]), `${lakh(v(pay, row, "NMV incl"))} NMV, ${lakh(v(pay, row, "Amount paid"))} paid`] as [string, string])], method: "Amount paid and balance pending from the Sales Tracker, on net lines.", source: src(r, "Customers & Ops") };
  const collected = metric(r, "Collected % of NMV");
  const delivered = metric(r, "Delivered % of NMV");

  const lg = r.logistics;
  const lgRows: BarRow[] = lg.rows.filter((row) => (v(lg, row, "NMV incl") ?? 0) > 0).map((row) => ({
    label: (text(row[1]) || text(row[0])).replace(/ in col AF, col S not Refunded$/, ", refund not marked"),
    value: v(lg, row, "NMV incl") ?? 0,
    display: `${lakh(v(lg, row, "NMV incl"))} · ${pct(v(lg, row, "Share of NMV"), 0)}`,
    tone: /DELIVERED|BRAND_DEL/.test(text(row[0])) ? undefined : "muted",
    detail: { kicker: "Fulfilment", title: text(row[1]) || text(row[0]), value: lakh(v(lg, row, "NMV incl")), rows: [["Status code", text(row[0])], ["Lines", count(v(lg, row, "Lines"))], ["Share of NMV", pct(v(lg, row, "Share of NMV"))]], method: "Logistic status of each net line in the Sales Tracker.", source: src(r, "Customers & Ops") },
  }));

  const health: { label: string; m: string; better: "up" | "down"; bad?: (n: number) => boolean }[] = [
    { label: "Lines with a key field blank", m: "Line items with a key field blank", better: "down", bad: (n) => n > 10 },
    { label: "Refund, RTO and fraud rate", m: "Refund / RTO + fraud rate (of paid NMV)", better: "down", bad: (n) => n > 5 },
    { label: "Lines with a unit cost", m: "Cost coverage (share of net revenue with a unit cost)", better: "up", bad: (n) => n < 95 },
    { label: "Lines sold below cost", m: "Net lines billed below unit cost", better: "down", bad: (n) => n > 50 },
  ];

  return (
    <div className="scr scr-ops">
      <Panel className="op-status" title="Every line booked, by status" sub={`GMV · ${count(num(sb.total?.[1]))} lines · ${lakh(num(sb.total?.[col(sb, "GMV")]))} booked`}>
        <p className="mix-seg-label">{monthName(r.month)}</p>
        <StackBar segments={statusSeg} />
        <p className="mix-seg-label" style={{ marginTop: 12 }}>{monthName(r.prev)} · {lakh(num(sb.total?.[col(sb, "GMV prev")]))} booked</p>
        <StackBar legend={false} segments={sb.rows.filter((row) => (v(sb, row, "GMV prev") ?? 0) > 0).map((row) => ({ ...statusSeg.find((x) => x.label === text(row[0]))!, value: v(sb, row, "GMV prev") ?? 0 }))} />
      </Panel>
      <Panel className="op-cash" title="Money collected" sub={`On ${lakh(nmv)} of NMV`}>
        <div className="op-cash-body">
          <Donut size={132} center={pct(collected.cur, 0)} sub="collected" slices={[{ label: "Collected", value: paid, color: C.blue, detail: payDetail }, { label: "To collect", value: pending, color: C.yellow, detail: { ...payDetail, title: "Still to collect", value: lakh(pending) } }]} />
          <div className="op-cash-side">
            <Mark detail={payDetail} className="op-stat"><span>Collected</span><b>{lakh(paid)}</b><Delta mom={metric(r, "Cash collected on net orders").mom} /></Mark>
            <Mark detail={{ ...payDetail, title: "Still to collect", value: lakh(pending) }} className="op-stat"><span>To collect</span><b>{lakh(pending)}</b><Delta mom={metric(r, "Balance pending (COD / to collect)").mom} better="down" /></Mark>
            <Mark detail={metricDetail(r, "Delivered % of NMV", "Delivered")} className="op-stat"><span>Delivered</span><Meter value={delivered.cur ?? 0} label={`${pct(delivered.cur)} of NMV`} /></Mark>
          </div>
        </div>
      </Panel>
      <Panel className="op-ful" title="Where the goods are" sub={`Net lines by logistic status · NMV and share · ${count(num(lg.total?.[col(lg, "Lines")]))} lines`}>
        <BarList rows={lgRows} dense />
      </Panel>
      <Panel className="op-health" title="Data health" sub="How much of the tracker can be trusted">
        <div className="health">
          {health.map((h) => {
            const mm = metric(r, h.m);
            const bad = mm.cur != null && h.bad?.(mm.cur);
            return (
              <Mark key={h.m} detail={metricDetail(r, h.m, h.label, h.better)} className={`health-tile ${bad ? "is-bad" : "is-good"}`}>
                <b>{inUnit(mm.unit, mm.cur)}</b>
                <span>{h.label}</span>
                <Delta mom={mm.mom} better={h.better} />
              </Mark>
            );
          })}
          <Mark detail={metricDetail(r, "Tie-out checks passed", "Tie-out checks")} className="health-tile is-good">
            <b>{count(metric(r, "Tie-out checks passed").cur)} of {count(metric(r, "Tie-out checks passed").cur)}</b>
            <span>Tie-out checks passed</span>
            <span className="mis-delta is-good">All reconcile</span>
          </Mark>
        </div>
      </Panel>
    </div>
  );
}

/* ================================ Products ================================ */

const SIGNALS = ["Selling below cost", "Picking up", "New this month", "Slowing"] as const;
const PAGE = 12;

export function Products({ r }: P) {
  const t = r.sku;
  const skus = t.rows.filter((row) => text(row[0]) !== "All other SKUs");
  const others = t.rows.find((row) => text(row[0]) === "All other SKUs");
  const [signal, setSignal] = useState<string>("all");
  const [page, setPage] = useState(0);
  const sig = (row: Cell[]) => text(row[col(t, "Signal")]) || "Steady";
  const shown = signal === "all" ? skus : skus.filter((row) => sig(row) === signal);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const at = Math.min(page, pages - 1);
  const topNmv = skus.reduce((s, row) => s + (v(t, row, "NMV incl") ?? 0), 0);
  const total = num(t.total?.[col(t, "NMV incl")]) ?? 0;
  const pick = (s: string) => { setSignal(s); setPage(0); };

  const skuDetail = (row: Cell[]): Detail => ({
    kicker: `${text(row[2])} · ${text(row[3])}`,
    title: text(row[1]) || text(row[0]),
    value: lakh(v(t, row, "NMV incl"), 2),
    delta: { mom: text(row[col(t, "Units MoM")]) ? `${v(t, row, "Units MoM")! > 0 ? "+" : ""}${v(t, row, "Units MoM")}%` : null },
    rows: [["SKU", text(row[0])], [`Units in ${monthName(r.month)}`, count(v(t, row, "Units (sel"))], [`Units in ${monthName(r.prev)}`, count(v(t, row, "Units (prev"))], ["Average selling price", rupees(v(t, row, "Avg selling"))], ["Discount", pct(v(t, row, "Disc %"))], ["Net margin", text(row[col(t, "Net margin")]) === "no cost" ? "No unit cost in the tracker" : pct(v(t, row, "Net margin"))], ["Signal", sig(row)]],
    method: "Top 40 SKUs by NMV this month. Net margin uses only lines that have a unit cost. Selling below cost means the net margin is negative.",
    source: src(r, "Brand & Model"),
  });

  return (
    <div className="scr scr-products">
      <aside className="pr-side">
        <Panel title="Top 40 products" sub={`${lakh(topNmv)} of ${lakh(total)} NMV (${pct((topNmv / (total || 1)) * 100, 0)})`}>
          <ul className="sig-list">
            <li><button type="button" className="sig" aria-pressed={signal === "all"} onClick={() => pick("all")}><span>All</span><b>{skus.length}</b></button></li>
            {[...SIGNALS, "Steady"].map((s) => {
              const rows = skus.filter((row) => sig(row) === s);
              if (!rows.length) return null;
              const val = rows.reduce((x, row) => x + (v(t, row, "NMV incl") ?? 0), 0);
              return (
                <li key={s}>
                  <button type="button" className={`sig is-${s.split(" ")[0].toLowerCase()}`} aria-pressed={signal === s} onClick={() => pick(s)}>
                    <span>{s}</span><b>{rows.length}</b><i>{lakh(val)}</i>
                  </button>
                </li>
              );
            })}
          </ul>
          {others ? <p className="panel-note">Every other SKU together: {count(v(t, others, "Units (sel"))} units, {lakh(v(t, others, "NMV incl"))}.</p> : null}
        </Panel>
      </aside>
      <Panel className="pr-table" title={signal === "all" ? "Products by NMV" : signal} sub={`${shown.length} products · click a row for its numbers`} aside={pages > 1 ? (
        <div className="pager">
          <button type="button" disabled={at === 0} onClick={() => setPage(at - 1)} aria-label="Previous page">‹</button>
          <span>{at + 1} / {pages}</span>
          <button type="button" disabled={at >= pages - 1} onClick={() => setPage(at + 1)} aria-label="Next page">›</button>
        </div>
      ) : null}>
        <div className="tbl">
          <div className="tbl-head sku-grid"><span>Product</span><span>Units</span><span>{shortMonth(r.prev)}</span><span>NMV</span><span>Avg price</span><span>Disc</span><span>Margin</span><span>Signal</span></div>
          {shown.slice(at * PAGE, at * PAGE + PAGE).map((row) => {
            const margin = v(t, row, "Net margin");
            return (
              <Mark key={`${text(row[0])}-${text(row[1])}`} detail={skuDetail(row)} className="tbl-row sku-grid">
                <span className="sku-name"><b>{text(row[1]) || text(row[0])}</b><i>{text(row[2])} · {text(row[0])}</i></span>
                <span>{count(v(t, row, "Units (sel"))}</span>
                <span className="is-muted">{v(t, row, "Units (prev") ?? 0}</span>
                <span><b>{lakh(v(t, row, "NMV incl"), 2)}</b></span>
                <span>{rupees(v(t, row, "Avg selling"))}</span>
                <span className="is-muted">{v(t, row, "Disc %") == null ? "0%" : pct(v(t, row, "Disc %"))}</span>
                <span className={(margin ?? 0) < 0 ? "is-neg" : ""}>{margin == null ? "No cost" : pct(margin)}</span>
                <span><i className={`sig-chip is-${sig(row).split(" ")[0].toLowerCase()}`}>{sig(row)}</i></span>
              </Mark>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

/* ================================ Demos ================================ */

const DRIVER_SHORT: Record<string, string> = { "Demo format": "Format", "Demo length": "Length", "Lead source": "Lead source", Product: "Product", "Robot-vacuum brand": "RV brand", Hub: "Hub" };

export function Demos({ r }: P) {
  const head = r.demoHead;
  const trend = r.demoTrend;
  const months = trend.rows.filter((row) => num(row[1]) != null);
  const dr = r.drivers;
  const groups = [...new Set(dr.rows.map((row) => text(row[0])).filter(Boolean))];
  const [group, setGroup] = useState(groups[0] ?? "");
  const up = r.upside;
  const calls = { ...r.calls, rows: r.calls.rows.filter((row) => text(row[1]) && text(row[2])) };
  const demoSrc = src(r, "Demo Insights");
  const sampleNote = r.demoText[0] ?? "";

  const booked = metric(r, "Demos booked");
  const done = metric(r, "Demos completed");
  const demoCx = metric(r, "Demo-sourced customers");

  const monthDetail = (row: Cell[]): Detail => ({
    kicker: "Demos by month",
    title: text(row[0]),
    value: `${count(num(row[1]))} demos`,
    rows: [["Demos", count(num(row[1]))], ["Became a sale", count(num(row[2]))], ["Demo to sale", pct(num(row[3]))], ["Video demo share", pct(num(row[4]))], ["Status", text(row[5])]],
    method: "A demo counts as a sale if the CRM says converted, or the same phone placed an EPIK order within 60 days.",
    sample: sampleNote.split(". ")[1] ?? undefined,
    source: demoSrc,
  });

  const driverRows: BarRow[] = dr.rows.filter((row) => text(row[0]) === group).map((row) => ({
    label: text(row[1]),
    sub: `${count(num(row[2]))} demos · ${count(num(row[3]))} sales`,
    value: num(row[4]) ?? 0,
    display: pct(num(row[4])),
    detail: { kicker: group, title: text(row[1]), value: `${pct(num(row[4]))} became a sale`, rows: [["Demos", count(num(row[2]))], ["Sales", count(num(row[3]))], ["Demo to sale", pct(num(row[4]))]], note: text(row[5]) || undefined, method: "Judged demos from February to 19 October 2026 (old enough to have an outcome).", source: demoSrc },
  }));
  const groupNote = dr.rows.find((row) => text(row[0]) === group && text(row[5]))?.[5];

  const upRows: BarRow[] = up.rows.map((row) => ({
    label: text(row[0]),
    value: num(row[2]) ?? 0,
    display: `${lakh(num(row[2]))} · ${count(num(row[1]))} sales`,
    detail: { kicker: "Upside from the same demos", title: text(row[0]), value: lakh(num(row[2])), rows: [["Extra sales", count(num(row[1]))], ["Extra value", lakh(num(row[2]))]], note: text(row[3]) || undefined, method: "Cautious: only half of each gap is credited.", source: demoSrc },
  }));
  const upTotal = up.total;

  return (
    <div className="scr scr-demos">
      <div className="dm-top">
        {head.rows.map((row) => (
          <Mark key={text(row[0])} className="kpi is-small" detail={{ kicker: "Demo funnel", title: text(row[0]), value: text(row[0]).includes("₹ L") ? lakh(num(row[1])) : text(row[0]).includes("(₹)") ? rupees(num(row[1])) : text(row[0]).includes("conversion") ? pct(num(row[1])) : count(num(row[1])), note: text(row[2]), sample: sampleNote.split(". ").slice(1, 3).join(". "), source: demoSrc }}>
            <span className="kpi-label">{text(row[0]).replace(" (₹ L)", "").replace(" (₹)", "")}</span>
            <b className="kpi-value">{text(row[0]).includes("₹ L") ? lakh(num(row[1])) : text(row[0]).includes("(₹)") ? rupees(num(row[1])) : text(row[0]).includes("conversion") ? pct(num(row[1])) : count(num(row[1]))}</b>
            <span className="kpi-foot"><i>{text(row[2])}</i></span>
          </Mark>
        ))}
        <Mark className="kpi is-small is-funnel" detail={{ kicker: `${monthName(r.month)} funnel`, title: "Demos booked to customers", rows: [["Booked", count(booked.cur)], ["Completed", count(done.cur)], ["Completion rate", pct(metric(r, "Demo completion rate").cur)], ["Demo-sourced customers", count(demoCx.cur)], ["Share of NMV from demos", pct(metric(r, "Demo-sourced share of NMV").cur)]], method: "Booked and completed demos come from the OCT NM sheet. Demo-sourced customers are those whose sale source is Demo or Virtual Demo.", source: src(r, "Executive Summary") }}>
          <span className="kpi-label">{monthName(r.month)} funnel</span>
          <b className="kpi-value">{count(booked.cur)} › {count(done.cur)} › {count(demoCx.cur)}</b>
          <span className="kpi-foot"><i>booked › completed › customers</i></span>
        </Mark>
      </div>
      <Panel className="dm-months" title="Demos each month" sub={`${monthName(r.month)} is still maturing, so its sales will rise`}>
        <Columns cols={months.map((row) => ({ label: text(row[0]).slice(0, 3), value: num(row[1]) ?? 0, display: count(num(row[1])), faded: /maturing/i.test(text(row[5])), detail: monthDetail(row) }))} />
      </Panel>
      <Panel className="dm-rate" title="Conversion and video share" sub="Video demos convert at about a quarter of the home rate">
        <Lines
          labels={months.map((row) => text(row[0]).slice(0, 3))}
          lines={[
            { key: "conv", label: "Demo to sale %", color: C.blue, points: months.map((row) => num(row[3])), details: months.map((row) => monthDetail(row)) },
            { key: "video", label: "Video demo share %", color: C.orange, points: months.map((row) => num(row[4])), details: months.map((row) => monthDetail(row)) },
          ]}
          max={80}
        />
      </Panel>
      <Panel className="dm-drivers" title="What drives a sale" sub={groupNote ? String(groupNote) : "Demo to sale %, judged demos"}>
        <div className="seg-ctl is-row" role="group" aria-label="Driver">
          {groups.map((g) => <button key={g} type="button" aria-pressed={group === g} onClick={() => setGroup(g)}>{DRIVER_SHORT[g] ?? g}</button>)}
        </div>
        <BarList rows={driverRows} max={Math.max(35, ...driverRows.map((x) => x.value))} dense />
      </Panel>
      <Panel className="dm-upside" title="Upside from the same demos" sub={upTotal ? `${count(num(upTotal[1]))} more sales, ${lakh(num(upTotal[2]))}, with no extra leads` : undefined}>
        <BarList rows={upRows} dense stacked />
      </Panel>
      <Panel className="dm-calls" title="Why they buy, why they walk" sub={`${text(calls.cols[0]).replace("Calls that sold ", "")} sold calls read`}>
        <div className="calls">
          <ul>
            <li className="calls-head is-good">Bought because</li>
            {calls.rows.map((row) => (
              <li key={text(row[0])}><Mark className="calls-row" detail={{ kicker: "Calls that sold", title: text(row[0]), value: `${text(row[1])} calls`, method: "60 robot-vacuum calls read by hand, January to October 2026.", source: demoSrc }}><span>{text(row[0])}</span><b>{text(row[1])}</b></Mark></li>
            ))}
          </ul>
          <ul>
            <li className="calls-head is-bad">Walked away because</li>
            {calls.rows.map((row) => (
              <li key={text(row[2])}><Mark className="calls-row" detail={{ kicker: "Calls that did not sell", title: text(row[2]), value: `${text(row[5])} calls`, method: "60 robot-vacuum calls read by hand, January to October 2026.", note: r.demoText.find((x) => x.startsWith("At least")), source: demoSrc }}><span>{text(row[2])}</span><b>{text(row[5])}</b></Mark></li>
            ))}
          </ul>
        </div>
      </Panel>
    </div>
  );
}

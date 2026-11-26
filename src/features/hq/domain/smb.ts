// EPIK HQ reads the Sales Masterbase "Sales Tracker" (through the live copy tab "Sales feed"). One row per product
// sold. Columns are found by their heading (row 2), so the team can move them; row 1 holds the sheet's own totals,
// kept to cross-check what the dashboard adds up. Pure: tests use it.

export type SaleLine = {
  row: number;
  order: string;
  day: string | null;
  customer: string | null;
  phone: string | null;
  cxType: "New" | "Repeat" | null;
  brand: string | null;
  product: string;
  sku: string | null;
  category: string;
  poc: string | null;
  hub: string | null;
  source: string | null;
  saleType: string | null;
  qty: number;
  /** As written in the sheet (₹, GST included unless the name says otherwise). */
  undiscountedGmv: number;
  linkPrice: number;
  paymentStatus: string | null;
  amountPaid: number;
  balance: number;
  logisticStatus: string | null;
  deliveryStatus: string | null;
  dispatchedOn: string | null;
  deliveredOn: string | null;
  tat: number | null;
  city: string | null;
  /** Finance columns. Finance fills them once an order is confirmed; until then financeDone is false. */
  financeDone: boolean;
  /** "GMV(RSP) Value Pre Disc" (incl. GST) and "GMV After Tax Pre Disc" (GST taken out). */
  gmvIncl: number;
  gmvExcl: number;
  discount: number;
  nmvIncl: number;
  nmvExcl: number;
  /** COGS is a number (finance writes "Update data" until the cost is known). */
  cogsKnown: boolean;
  cpuIncl: number;
  creditNote: number;
  cogsIncl: number;
  cogsExcl: number;
  grossMarginPreDisc: number | null;
  netMargin: number | null;
  fraud: boolean;
};

export type SheetTotals = Record<string, number>;

const clean = (v: string | undefined) => (v ?? "").replace(/\s+/g, " ").trim();
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9%]/g, "");
/** "₹1,23,456.78", "69,900", "-", "12%" → number (percent as 12). Blank or text → NaN. */
export function num(v: string | undefined): number {
  const s = clean(v).replace(/[₹,\s]/g, "").replace(/%$/, "");
  if (!s || s === "-" || /[a-z]/i.test(s)) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
const n0 = (v: string | undefined) => {
  const n = num(v);
  return Number.isFinite(n) ? n : 0;
};
const nn = (v: string | undefined) => {
  const n = num(v);
  return Number.isFinite(n) ? n : null;
};

/** "01/11/2026", "1-Nov-2026", "01-Nov-2026" → "2026-11-01". */
export function sheetDay(v: string | undefined): string | null {
  const s = clean(v);
  let m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = /^(\d{1,2})[- ]([A-Za-z]{3})[a-z]*[- ](\d{4})$/.exec(s);
  if (m) {
    const mo = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[2].toLowerCase()) + 1;
    if (mo) return `${m[3]}-${String(mo).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

const COLS = {
  order: ["Shopify Order ID"],
  day: ["Invoice Date"],
  customer: ["Customer Name"],
  phone: ["Phone Number"],
  cxType: ["CX Type"],
  brand: ["Brand"],
  product: ["Product Name"],
  sku: ["SKU CODE", "SKU Code"],
  category: ["Category"],
  poc: ["POC"],
  hub: ["HUB"],
  source: ["Sale Source"],
  saleType: ["Sale Type"],
  qty: ["SKU Qty"],
  undiscountedGmv: ["Undiscounted GMV (Epik's)", "Undiscounted GMV"],
  linkPrice: ["Link Price"],
  paymentStatus: ["Payment Status"],
  amountPaid: ["Amount Paid"],
  balance: ["Balance Pending"],
  logisticStatus: ["Logistic Status"],
  deliveryStatus: ["Delivery Status"],
  dispatchedOn: ["Dipatch Date", "Dispatch Date"],
  deliveredOn: ["Delivery date"],
  tat: ["Delivery TAT"],
  city: ["Delivery City Cohort"],
  nmvExclTax: ["NMV Excl Tax"],
  gmvPreDisc: ["GMV(RSP) Value Pre Disc"],
  gmvAfterTax: ["GMV After Tax Pre Disc"],
  discount: ["Discount"],
  nmvIncl: ["NMV Value (Inc GST)", "NMV Value (Incl GST)"],
  nmvExcl: ["NMV Value (Excl GST)"],
  cpuIncl: ["CPU Incl GST (to be considered)"],
  creditNote: ["Credit Note"],
  cogsIncl: ["COGS Incl GST"],
  cogsExcl: ["COGS Excl GST"],
  gmPreDisc: ["Gross Margin Value Pre Disc"],
  netMargin: ["Net Margin Value"],
  fraud: ["Fraudlent", "Fraudulent"],
} as const;
type Col = keyof typeof COLS;

export type SmbRead = { lines: SaleLine[]; totals: SheetTotals; headings: string[]; missing: Col[] };

/** The heading row is the one (among the first five) with "Shopify Order ID" and "POC". Row above it: totals. */
export function readSales(rows: string[][]): SmbRead {
  let h = -1;
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const r = (rows[i] ?? []).map((x) => norm(x ?? ""));
    if (r.includes(norm("Shopify Order ID")) && r.includes(norm("POC"))) { h = i; break; }
  }
  if (h < 0) return { lines: [], totals: {}, headings: [], missing: Object.keys(COLS) as Col[] };
  const head = rows[h].map((x) => norm(x ?? ""));
  const at: Partial<Record<Col, number>> = {};
  for (const [k, names] of Object.entries(COLS) as Array<[Col, readonly string[]]>) {
    // The first heading that matches exactly wins ("Discount" is not "Discount (%)").
    const i = head.findIndex((x) => names.some((n) => norm(n) === x));
    if (i >= 0) at[k] = i;
  }
  const get = (row: string[], k: Col) => (at[k] == null ? "" : clean(row[at[k]!]));
  const totals: SheetTotals = {};
  if (h > 0) for (const [k] of Object.entries(at) as Array<[Col, number]>) {
    const v = num(rows[h - 1]?.[at[k]!]);
    if (Number.isFinite(v)) totals[k] = v;
  }
  const lines: SaleLine[] = [];
  rows.slice(h + 1).forEach((row, i) => {
    const order = get(row, "order");
    const product = get(row, "product");
    if (!order && !product) return;
    const cx = get(row, "cxType").toLowerCase();
    lines.push({
      row: h + i + 2,
      order: order || `row-${h + i + 2}`,
      day: sheetDay(get(row, "day")),
      customer: get(row, "customer") || null,
      phone: get(row, "phone") || null,
      cxType: cx.startsWith("new") ? "New" : cx.startsWith("rep") ? "Repeat" : null,
      brand: get(row, "brand") || null,
      product: product || get(row, "sku") || "Unknown product",
      sku: get(row, "sku") || null,
      category: get(row, "category") || "Not set",
      poc: get(row, "poc") || null,
      hub: get(row, "hub") || null,
      source: get(row, "source") || null,
      saleType: get(row, "saleType") || null,
      qty: Math.max(1, n0(get(row, "qty")) || 1),
      undiscountedGmv: n0(get(row, "undiscountedGmv")),
      linkPrice: n0(get(row, "linkPrice")),
      paymentStatus: get(row, "paymentStatus") || null,
      amountPaid: n0(get(row, "amountPaid")),
      balance: n0(get(row, "balance")),
      logisticStatus: get(row, "logisticStatus") || null,
      deliveryStatus: get(row, "deliveryStatus") || null,
      dispatchedOn: sheetDay(get(row, "dispatchedOn")),
      deliveredOn: sheetDay(get(row, "deliveredOn")),
      tat: nn(get(row, "tat")),
      city: get(row, "city") || null,
      financeDone: nn(get(row, "nmvIncl")) != null,
      gmvIncl: n0(get(row, "gmvPreDisc")),
      gmvExcl: n0(get(row, "gmvAfterTax")),
      discount: n0(get(row, "discount")),
      nmvIncl: n0(get(row, "nmvIncl")),
      nmvExcl: n0(get(row, "nmvExcl")),
      cogsKnown: nn(get(row, "cogsExcl")) != null,
      cpuIncl: n0(get(row, "cpuIncl")),
      creditNote: n0(get(row, "creditNote")),
      cogsIncl: n0(get(row, "cogsIncl")),
      cogsExcl: n0(get(row, "cogsExcl")),
      grossMarginPreDisc: nn(get(row, "gmPreDisc")),
      netMargin: nn(get(row, "netMargin")),
      fraud: /^(y|yes|true|fraud)/i.test(get(row, "fraud")),
    });
  });
  return { lines, totals, headings: rows[h], missing: (Object.keys(COLS) as Col[]).filter((k) => at[k] == null) };
}

// The monthly MIS, as read from the finance workbook (Epik_MIS_<month>_Working_File). Totals and rates only:
// no customer names or phone numbers. Money is in ₹ lakhs unless a row says ₹.

export type Cell = string | number | null;

/** One block of the workbook: the header row, the body rows and the "Total" row when it has one. */
export type MisTable = { cols: string[]; rows: Cell[][]; total: Cell[] | null };

export type MisMetric = {
  label: string;
  indent: boolean;
  /** "₹ L", "₹", "%", "#" or "months". */
  unit: string;
  cur: number | null;
  prev: number | null;
  /** As the sheet writes it: "+4.5%", "-1.1 pp", "-". */
  mom: string | null;
  def: string | null;
};

export type MisPnlLine = { label: string; basis: string | null; cur: number | null; prev: number | null; mom: string | null; pctRev: string | null; note: string | null };

export type MisReport = {
  source: string;
  month: string;
  prev: string;
  exec: { title: string; rows: MisMetric[] }[];
  /** The commentary column of the Executive Summary, in order. */
  notes: string[];
  pnl: MisPnlLine[];
  unit: MisPnlLine[];
  category: MisTable;
  brand: MisTable;
  sku: MisTable;
  channel: MisTable;
  saleType: MisTable;
  hub: MisTable;
  poc: MisTable;
  segment: MisTable;
  cxType: MisTable;
  status: MisTable;
  payment: MisTable;
  logistics: MisTable;
  demoHead: MisTable;
  demoTrend: MisTable;
  drivers: MisTable;
  findings: MisTable;
  upside: MisTable;
  calls: MisTable;
  context: MisTable;
  demoText: string[];
};

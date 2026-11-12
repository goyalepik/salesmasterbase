import type { Cell, MisMetric, MisReport, MisTable } from "../lib/types";

const IN = new Intl.NumberFormat("en-IN");

/** ₹ lakhs: "₹194.3 L", "-₹36.7 L". */
export function lakh(n: number | null | undefined, digits = 1): string {
  if (n == null) return "Not given";
  const abs = Math.abs(n);
  return `${n < 0 ? "-" : ""}₹${abs.toFixed(digits)} L`;
}

/** Whole rupees with Indian grouping: "₹51,744". */
export function rupees(n: number | null | undefined): string {
  if (n == null) return "Not given";
  return `${n < 0 ? "-" : ""}₹${IN.format(Math.round(Math.abs(n)))}`;
}

export function count(n: number | null | undefined): string {
  return n == null ? "Not given" : IN.format(n);
}

export function pct(n: number | null | undefined, digits = 1): string {
  return n == null ? "Not given" : `${n.toFixed(digits)}%`;
}

/** A value in the unit the sheet gives it. */
export function inUnit(unit: string, n: number | null): string {
  if (unit === "₹ L") return lakh(n);
  if (unit === "₹") return rupees(n);
  if (unit === "%") return pct(n);
  return count(n);
}

/** "+4.5%" → 4.5, "-1.1 pp" → -1.1, "-" → null. */
export function deltaNumber(mom: string | null | undefined): number | null {
  if (!mom || mom.trim() === "-" || mom.trim() === "") return null;
  const n = Number(mom.replace(/[%\s,]|pp/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Month labels from the sheet ("October-26") to "October 2026". */
export function monthName(sheetMonth: string): string {
  const [m, y] = sheetMonth.split("-");
  return y ? `${m} 20${y}` : sheetMonth;
}

export function shortMonth(sheetMonth: string): string {
  return sheetMonth.slice(0, 3);
}

export function metric(report: MisReport, label: string): MisMetric {
  for (const section of report.exec) {
    const hit = section.rows.find((r) => r.label === label);
    if (hit) return hit;
  }
  return { label, indent: false, unit: "#", cur: null, prev: null, mom: null, def: null };
}

/** Column index by the start of its header, e.g. col(t, "NMV incl"). */
export function col(table: MisTable, start: string): number {
  return table.cols.findIndex((c) => c.toLowerCase().startsWith(start.toLowerCase()));
}

export function num(cell: Cell | undefined): number | null {
  return typeof cell === "number" ? cell : null;
}

export function text(cell: Cell | undefined): string {
  return cell == null ? "" : String(cell);
}

/** Readable labels for the sheet's raw spellings. */
export function cleanLabel(label: string): string {
  return label.replace(/\s*\(add to Lists\)/i, "").replace(/\s*\(ties to Executive Summary\)/i, "").trim();
}

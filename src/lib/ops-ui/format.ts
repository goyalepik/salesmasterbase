// Small display helpers for the operations screens. No server-only imports, so client components can use them.

const TIME_ZONE = "Asia/Kolkata";

/** ₹1,23,456 — whole rupees, Indian grouping. Paise only when present. */
export function inr(minor: number | null | undefined): string {
  if (minor == null) return "—";
  const whole = minor % 100 === 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(minor / 100);
}

/** ₹1.2L / ₹3.4Cr for tight places like chart axes and KPI tiles. */
export function inrCompact(minor: number | null | undefined): string {
  if (minor == null) return "—";
  const rupees = minor / 100;
  if (Math.abs(rupees) >= 1e7) return `₹${(rupees / 1e7).toFixed(2)}Cr`;
  if (Math.abs(rupees) >= 1e5) return `₹${(rupees / 1e5).toFixed(1)}L`;
  if (Math.abs(rupees) >= 1e3) return `₹${(rupees / 1e3).toFixed(1)}k`;
  return `₹${Math.round(rupees)}`;
}

/** 30 Oct, 14:05 in IST. */
export function shortWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", { timeZone: TIME_ZONE, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

/** 30 Oct 2026 for a YYYY-MM-DD date or an ISO time. */
export function shortDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00+05:30`) : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", { timeZone: TIME_ZONE, day: "2-digit", month: "short", year: "numeric" }).format(date);
}

/** "3h", "2d", "just now". */
export function age(iso: string, nowMs: number): string {
  const minutes = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 60000));
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function ageHours(iso: string, nowMs: number): number {
  return (nowMs - new Date(iso).getTime()) / 3_600_000;
}

/** Rupee text from a form ("1,23,456.50", "₹ 5000") to paise. Null when empty or not a number. */
export function formRupeesToMinor(value: FormDataEntryValue | null): number | null {
  const text = typeof value === "string" ? value.replace(/[₹,\s]/g, "").replace(/^rs\.?/i, "") : "";
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  return Math.round(Number(text) * 100);
}

export function plural(count: number, word: string, many = `${word}s`): string {
  return `${count} ${count === 1 ? word : many}`;
}

/** Current time for server-rendered age labels. Each request renders once, so this is stable per response. */
export function requestNow(): number {
  return new Date().getTime();
}

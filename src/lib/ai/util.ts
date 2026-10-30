import { isoDateInIst } from "@/lib/format";

const DAY = 24 * 60 * 60 * 1000;

/** ₹ with Indian digit grouping, whole rupees. Input is paise. */
export function inr(minor: number | null | undefined): string {
  if (minor == null || !Number.isFinite(minor)) return "—";
  const rupees = Math.round(minor / 100);
  const sign = rupees < 0 ? "-" : "";
  return `${sign}₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.abs(rupees))}`;
}

/** Whole rupees as a number, for tool payloads the model may add up. */
export function rupees(minor: number | null | undefined): number | null {
  if (minor == null || !Number.isFinite(minor)) return null;
  return Math.round(minor / 100);
}

/** Keep the last 4 digits of a phone number. */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "****";
  return `******${digits.slice(-4)}`;
}

/** Mask any phone-like run of 8+ digits inside free text. */
export function maskPhonesInText(text: string): string {
  return text.replace(/\+?\d[\d\s-]{6,}\d/g, (match) => {
    const digits = match.replace(/\D/g, "");
    return digits.length >= 8 ? `******${digits.slice(-4)}` : match;
  });
}

export function clip(text: string | null | undefined, max: number): string | null {
  if (text == null) return null;
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}

export function todayIst(now: Date): string {
  return isoDateInIst(now);
}

/** YYYY-MM-DD in IST, `days` before the given IST date string. */
export function shiftIstDate(date: string, days: number): string {
  const start = new Date(`${date}T00:00:00+05:30`).getTime();
  return isoDateInIst(new Date(start + days * DAY + 6 * 60 * 60 * 1000));
}

/** Inclusive IST dates → UTC ISO bounds, end exclusive. */
export function istRange(from: string, to: string): { fromIso: string; toIso: string } {
  const start = new Date(`${from}T00:00:00+05:30`);
  const end = new Date(new Date(`${to}T00:00:00+05:30`).getTime() + DAY);
  return { fromIso: start.toISOString(), toIso: end.toISOString() };
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00+05:30`).getTime());
}

/** "2026-10-30 14:05" in IST. */
export function istDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

export function istDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return isoDateInIst(date);
}

/** Days between two IST dates (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00+05:30`).getTime() - new Date(`${a}T00:00:00+05:30`).getTime()) / DAY);
}

// Numbers and dates the IMS way: ₹ in lakhs and crores, Indian digit groups, "26 Nov".

export const units = (n: number) => Math.round(n).toLocaleString("en-IN");

export function money(n: number): string {
  const a = Math.abs(n);
  const s = n < 0 ? "−" : "";
  if (!a) return "₹0";
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(1)} L`;
  return `${s}₹${Math.round(a).toLocaleString("en-IN")}`;
}

/** "2026-11-26" → "26 Nov". */
export function day(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** Change vs the previous period, as a chip. */
export function change(now: number, before: number): { text: string; tone: "up" | "down" | "flat" } {
  if (!before && !now) return { text: "0%", tone: "flat" };
  if (!before) return { text: "new", tone: "up" };
  const pct = Math.round(((now - before) / before) * 100);
  return { text: `${pct > 0 ? "+" : ""}${pct}%`, tone: pct > 0 ? "up" : pct < 0 ? "down" : "flat" };
}

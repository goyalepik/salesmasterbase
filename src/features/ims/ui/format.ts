// Numbers and dates the IMS way: ₹ in lakhs and crores, Indian digit groups, "26 Nov".

export const units = (n: number) => Math.round(n).toLocaleString("en-IN");

export function money(n: number): string {
  if (!n) return "₹0";
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

/** "2026-11-26" → "26 Nov". */
export function day(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

export const plural = (n: number, one: string, many = `${one}s`) => `${units(n)} ${n === 1 ? one : many}`;

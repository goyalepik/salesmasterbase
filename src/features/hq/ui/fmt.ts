export const inr = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return "—";
  const a = Math.abs(n), s = n < 0 ? "−" : "";
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(1)} L`;
  return `${s}₹${Math.round(a).toLocaleString("en-IN")}`;
};
export const int = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("en-IN"));
export const pct = (x: number | null | undefined, d = 0) => (x == null || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(d)}%`);
export const day = (d: string | null | undefined) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }) : "—");
export function delta(now: number | null, before: number | null, invert = false): { text: string; cls: "up" | "down" | "flat" } | null {
  if (now == null || before == null) return null;
  // Nothing to compare with (before 1 Nov 2026, or zero): no chip.
  if (!before) return null;
  const p = Math.round(((now - before) / Math.abs(before)) * 100);
  const good = invert ? p < 0 : p > 0;
  return { text: `${p > 0 ? "▲" : p < 0 ? "▼" : ""} ${Math.abs(p)}%`, cls: p === 0 ? "flat" : good ? "up" : "down" };
}
/** Minutes since a moment (for "Live · 2 min ago"). */
export const minsAgo = (at: number) => Math.max(0, Math.round((Date.now() - at) / 60000));
/** Today in IST as weekday, month and day parts. */
export function todayParts() {
  const parts = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", month: "long", day: "numeric" }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { day: get("day"), weekday: get("weekday"), month: get("month") };
}

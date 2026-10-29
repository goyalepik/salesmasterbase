const TIME_ZONE = "Asia/Kolkata";

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function formatInrFromMinor(minor: number | null): string {
  if (minor == null) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

export function lastDaysBounds(now: Date, days: number): { start: Date; end: Date } {
  const today = istDayBounds(now);
  const span = Math.max(1, Math.floor(days));
  const start = new Date(today.start.getTime() - (span - 1) * 24 * 60 * 60 * 1000);
  return { start, end: today.end };
}

export function istDayBounds(now: Date): { start: Date; end: Date } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  const start = new Date(`${year}-${month}-${day}T00:00:00+05:30`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

export function isoDateInIst(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return parts;
}

export function dateInputToBounds(from: string, to: string): { start: Date | null; end: Date | null } {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(from) ? new Date(`${from}T00:00:00+05:30`) : null;
  const end = /^\d{4}-\d{2}-\d{2}$/.test(to) ? new Date(`${to}T00:00:00+05:30`) : null;
  const endExclusive = end ? new Date(end.getTime() + 24 * 60 * 60 * 1000) : null;
  return { start, end: endExclusive };
}

export function channelLabel(id: string, name: string | null): string {
  return name ? `${name}` : id;
}

export function senderLabel(name: string | null, id: string | null): string {
  if (name) return name;
  if (id) return id;
  return "Unknown sender";
}

export function shortText(value: string, max = 96): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1)}…`;
}

import { PRIORITY_RANK } from "../domain/config";
import { slaState } from "../domain/sla";
import type { Ticket } from "../domain/types";
import type { CxUser } from "./auth";
import { customerRef, maskDigits, maskPhonesInText } from "./redact";

// The ticket list is filtered, sorted and paged on the server (v5 16.2): the browser gets 50 rows at a time.

export const PAGE_SIZE = 50;

export type ListQuery = {
  view?: string;
  level?: string;
  queue?: string;
  bucket?: string;
  channel?: string;
  type?: string;
  label?: string;
  status?: string;
  priority?: string;
  owner?: string;
  q?: string;
  /** "today" | "7d" | "30d" | "90d" | "all": by last activity. */
  range?: string;
  page?: number;
};

const DAY = 86_400_000;
const OPEN = (t: Ticket) => t.status !== "resolved" && t.status !== "closed";

export function rangeStart(range: string | undefined, now: Date): number {
  const ist = new Date(now.getTime() + 5.5 * 3_600_000);
  const midnight = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 5.5 * 3_600_000;
  switch (range) {
    case "today": return midnight;
    case "7d": return midnight - 6 * DAY;
    case "30d": return midnight - 29 * DAY;
    case "90d": return midnight - 89 * DAY;
    case "all": return 0;
    default: return midnight - 29 * DAY;
  }
}

const activity = (t: Ticket) => new Date(t.lastActivityAt ?? t.createdAt).getTime();
const digits = (s: string) => s.replace(/\D/g, "");

/** Search: ticket number, order number, a word, or (for those allowed to see numbers) phone digits. */
export function matchesSearch(t: Ticket, q: string, phoneSearch: boolean): boolean {
  const needle = q.trim().toLowerCase().replace(/^#/, "");
  if (!needle) return true;
  const compact = needle.replace(/\s+/g, "");
  const code = (t.external?.code ?? "").toLowerCase();
  if (code && (code === compact || `${code}`.startsWith(compact))) return true;
  if (t.id.toLowerCase() === compact) return true;
  // "#20028", "20028-2", "W-1004"
  const ref = (t.ref ?? "").toLowerCase().replace(/^#/, "");
  if (ref && (ref === compact || (/^\d+$/.test(compact) && ref.split("-")[0] === compact))) return true;
  const orders = [t.orderRef ?? "", ...t.entities.orderRefs].map((o) => o.toLowerCase());
  if (orders.some((o) => o && (o === compact || o === `pik${compact.replace(/^pik/, "")}`))) return true;
  const d = digits(compact);
  if (phoneSearch && d.length >= 4 && d.length === compact.replace(/^\+/, "").length && t.customerUid.startsWith("+91") && t.customerUid.endsWith(d.slice(-10))) return true;
  const hay = `${t.id} ${t.subject} ${t.body} ${t.scenarioId}`.toLowerCase();
  return hay.includes(needle);
}

export function filterTickets(all: Iterable<Ticket>, query: ListQuery, user: CxUser, now: Date): Ticket[] {
  const from = rangeStart(query.range, now);
  const phoneSearch = user.role === "l1" || user.role === "admin";
  const out: Ticket[] = [];
  for (const t of all) {
    const open = OPEN(t);
    // Open tickets always show, whatever the date range; closed ones only inside it.
    if (!open && activity(t) < from) continue;
    if (query.view === "open" && !open) continue;
    if (query.view === "risk" && (!open || slaState(t, [], now).state === "ok")) continue;
    if (query.view === "mine" && t.ownerId !== user.id) continue;
    if (query.level && t.level !== query.level) continue;
    if (query.queue && t.queueId !== query.queue) continue;
    if (query.bucket && t.bucket !== query.bucket) continue;
    if (query.channel && t.channel !== query.channel) continue;
    if (query.type && t.type !== query.type) continue;
    if (query.label && t.label !== query.label) continue;
    if (query.priority && t.priority !== query.priority) continue;
    if (query.status && t.status !== query.status) continue;
    if (query.owner && (query.owner === "none" ? t.ownerId : t.ownerId !== query.owner)) continue;
    if (query.q && !matchesSearch(t, query.q, phoneSearch)) continue;
    out.push(t);
  }
  return out;
}

/** Most urgent first: breached, then P0 → P3, then least time left; closed tickets last, latest first. */
export function sortTickets(list: Ticket[], view: string | undefined, now: Date): Ticket[] {
  const scored = list.map((t) => ({ t, s: slaState(t, [], now) }));
  if (view === "all") return scored.sort((a, b) => activity(b.t) - activity(a.t)).map((x) => x.t);
  return scored
    .sort((a, b) => {
      const doneA = a.s.state === "met" || !OPEN(a.t) ? 1 : 0;
      const doneB = b.s.state === "met" || !OPEN(b.t) ? 1 : 0;
      const brA = a.s.state === "breached" ? 0 : 1;
      const brB = b.s.state === "breached" ? 0 : 1;
      return doneA - doneB || brA - brB || PRIORITY_RANK[a.t.priority] - PRIORITY_RANK[b.t.priority] || a.s.remainingMs - b.s.remainingMs;
    })
    .map((x) => x.t);
}

/** What a list row needs, with phones masked and the customer key replaced by an opaque reference. */
export function redactTicket(t: Ticket, secret: string, bodyMax = 400): Ticket {
  return {
    ...t,
    customerUid: customerRef(t.customerUid, secret),
    subject: maskPhonesInText(t.subject),
    body: maskPhonesInText(t.body.length > bodyMax ? `${t.body.slice(0, bodyMax)}…` : t.body),
    explanation: t.explanation.map(maskPhonesInText),
    warnings: t.warnings.map(maskPhonesInText),
    entities: { ...t.entities, phone: t.entities.phone ? maskDigits(t.entities.phone.slice(3)) : undefined },
  };
}

export type Counters = { open: number; p0: number; atRisk: number; breached: number; callbacks: number };

export function counters(all: Iterable<Ticket>, now: Date): Counters {
  const c: Counters = { open: 0, p0: 0, atRisk: 0, breached: 0, callbacks: 0 };
  for (const t of all) {
    if (!OPEN(t)) continue;
    c.open++;
    if (t.priority === "P0") c.p0++;
    if (t.queueId === "callbacks") c.callbacks++;
    const s = slaState(t, [], now).state;
    if (s === "at_risk") c.atRisk++;
    if (s === "breached") c.breached++;
  }
  return c;
}

export function readListQuery(params: URLSearchParams): ListQuery {
  const get = (k: string) => params.get(k)?.slice(0, 120) || undefined;
  return {
    view: get("view"), level: get("level"), queue: get("queue"), bucket: get("bucket"), channel: get("channel"), type: get("type"),
    label: get("label"), status: get("status"), priority: get("priority"), owner: get("owner"), q: get("q"), range: get("range"),
    page: Math.max(0, Number(params.get("page") ?? 0) || 0),
  };
}

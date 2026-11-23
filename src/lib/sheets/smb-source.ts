import "server-only";

import { parseCsv } from "@/lib/sheets/sheet-sync";
import { readSmbOrders, type TrackOrder } from "@/lib/sheets/smb-orders";

// Where the CD tracking page reads the Sales Masterbase from: the sheet's CSV link (File → Share → anyone with the
// link can view). SALES_MASTERBASE_CSV overrides it; several tabs can be given, separated by spaces or commas.
export const DEFAULT_SMB_CSV = "";

const FRESH_MS = 60_000;
const holder = globalThis as { __epikSmb?: { at: number; orders: TrackOrder[] } };

export type SmbLoad =
  | { ok: true; orders: TrackOrder[]; at: number; stale: boolean }
  | { ok: false; reason: "not_set" | "not_shared" | "failed"; message: string };

/** "…/edit?gid=123#gid=123" or an export link: the CSV export link for that tab. */
export function csvLinkFor(link: string): string | null {
  const m = /docs\.google\.com\/spreadsheets\/d\/([\w-]{20,})/.exec(link);
  if (!m) return /^https?:\/\//.test(link) ? link : null;
  const gid = /[#&?]gid=(\d+)/.exec(link)?.[1];
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? `&gid=${gid}` : ""}`;
}

export function smbLinks(env: Record<string, string | undefined> = process.env): string[] {
  const raw = env.SALES_MASTERBASE_CSV?.trim() || DEFAULT_SMB_CSV;
  return raw.split(/[\s,]+/).map(csvLinkFor).filter((v): v is string => !!v);
}

async function fetchTab(url: string): Promise<string[][]> {
  const res = await fetch(url, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(15_000) });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || type.includes("text/html")) throw Object.assign(new Error(`HTTP ${res.status}`), { notShared: res.status === 401 || res.status === 403 || type.includes("text/html") });
  return parseCsv(await res.text());
}

/** The Sales Masterbase orders, read at most once a minute. A failed read serves the last good copy. */
export async function loadSmbOrders(): Promise<SmbLoad> {
  const links = smbLinks();
  if (!links.length) return { ok: false, reason: "not_set", message: "The Sales Masterbase link isn't set yet." };
  const cached = holder.__epikSmb;
  if (cached && Date.now() - cached.at < FRESH_MS) return { ok: true, orders: cached.orders, at: cached.at, stale: false };
  try {
    const tabs = await Promise.all(links.map(fetchTab));
    const orders = tabs.flatMap(readSmbOrders);
    holder.__epikSmb = { at: Date.now(), orders };
    return { ok: true, orders, at: holder.__epikSmb.at, stale: false };
  } catch (error) {
    if (cached) return { ok: true, orders: cached.orders, at: cached.at, stale: true };
    const notShared = !!(error as { notShared?: boolean }).notShared;
    return notShared
      ? { ok: false, reason: "not_shared", message: "The Sales Masterbase isn't open to anyone with the link." }
      : { ok: false, reason: "failed", message: "Couldn't read the Sales Masterbase right now." };
  }
}

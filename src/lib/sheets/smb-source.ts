import "server-only";

import { readSetting, saveSetting } from "@/lib/app-setting";
import { parseCsv } from "@/lib/sheets/sheet-sync";
import { readSmbOrders, type TrackOrder } from "@/lib/sheets/smb-orders";

// Where the app reads the Sales Masterbase from. The SMB itself stays private and untouched: a separate "live copy"
// sheet pulls its Sales Tracker columns with IMPORTRANGE (Google keeps it updated), and only that copy is readable by
// link. Its link is saved in the app (Logistics → CD tracking), not in Vercel.

export const SMB_SETTING = "cd_tracking_sheet";
export type SmbSetting = { link: string; savedBy: string; savedAt: string };

const FRESH_MS = 60_000;
const holder = globalThis as { __epikSmb?: { at: number; link: string; orders: TrackOrder[] } };

export type SmbLoad =
  | { ok: true; orders: TrackOrder[]; at: number; stale: boolean }
  | { ok: false; reason: "not_set" | "not_shared" | "failed"; message: string };

/** "…/edit?gid=123#gid=123" or an export link: the CSV export link for that tab. */
export function csvLinkFor(link: string): string | null {
  const m = /docs\.google\.com\/spreadsheets\/d\/([\w-]{20,})/.exec(link);
  if (!m) return /^https?:\/\//.test(link.trim()) ? link.trim() : null;
  const gid = /[#&?]gid=(\d+)/.exec(link)?.[1];
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? `&gid=${gid}` : ""}`;
}

export async function smbSetting(): Promise<SmbSetting | null> {
  try {
    return await readSetting<SmbSetting>(SMB_SETTING);
  } catch {
    return null;
  }
}

export async function saveSmbLink(link: string, by: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const csv = csvLinkFor(link);
  if (!csv) return { ok: false, message: "Paste the Google Sheets link of the live copy." };
  const res = await fetch(csv, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!res || !res.ok || (res.headers.get("content-type") ?? "").includes("text/html")) {
    return { ok: false, message: "Can't open that sheet. In the copy: Share → Anyone with the link → Viewer." };
  }
  if (!readSmbOrders(parseCsv(await res.text())).length) return { ok: false, message: "That sheet has no Sales Tracker orders (no Shopify Order ID and POC headings)." };
  await saveSetting(SMB_SETTING, { link: link.trim(), savedBy: by, savedAt: new Date().toISOString() } satisfies SmbSetting);
  holder.__epikSmb = undefined;
  return { ok: true };
}

/** The Sales Masterbase orders, read at most once a minute. A failed read serves the last good copy. */
export async function loadSmbOrders(): Promise<SmbLoad> {
  const setting = await smbSetting();
  const csv = setting ? csvLinkFor(setting.link) : null;
  if (!csv) return { ok: false, reason: "not_set", message: "The Sales Masterbase isn't connected yet." };
  const cached = holder.__epikSmb;
  if (cached && cached.link === csv && Date.now() - cached.at < FRESH_MS) return { ok: true, orders: cached.orders, at: cached.at, stale: false };
  try {
    const res = await fetch(csv, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(15_000) });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || type.includes("text/html")) throw Object.assign(new Error(`HTTP ${res.status}`), { notShared: true });
    const orders = readSmbOrders(parseCsv(await res.text()));
    holder.__epikSmb = { at: Date.now(), link: csv, orders };
    return { ok: true, orders, at: holder.__epikSmb.at, stale: false };
  } catch (error) {
    if (cached && cached.link === csv) return { ok: true, orders: cached.orders, at: cached.at, stale: true };
    return (error as { notShared?: boolean }).notShared
      ? { ok: false, reason: "not_shared", message: "The live copy of the Sales Masterbase isn't readable by link." }
      : { ok: false, reason: "failed", message: "Couldn't read the Sales Masterbase right now." };
  }
}

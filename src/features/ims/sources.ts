import "server-only";

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readSetting, saveSetting } from "@/lib/app-setting";
import { parseCsv } from "@/lib/sheets/sheet-sync";
import { buildSnapshot, type Snapshot } from "./domain/model";
import { readPoLines, readTrackerStock, readUnits } from "./domain/sheets";

// Where the IMS reads from: the three team sheets, each one tab, by its link (Share → anyone with the link can view).
// The links are saved in the app's database (Sources page, admins), never in git: the repo is public and the sheets
// hold costs and customer names. Localhost can use data/ims-sources.local.json (git-ignored) instead.
// Read live: at most once every 2 minutes; a failed read keeps the last good copy.

export type SourceId = "procurement" | "masterbase" | "tracker";
export const SOURCE_INFO: Record<SourceId, { sheet: string; tab: string; role: string }> = {
  procurement: { sheet: "Procurement sheet", tab: "Procurement list", role: "What is coming: every PO line raised, its ETA and GRN status." },
  masterbase: { sheet: "Inventory Masterbase", tab: "Inventory Masterbase", role: "The truth for stock: one row per serial, from goods in to the customer." },
  tracker: { sheet: "Inventory Tracker", tab: "Current Stock", role: "The team's daily count per SKU, used as a cross-check." },
};
export const SOURCE_IDS: SourceId[] = ["procurement", "masterbase", "tracker"];

const SETTING = "ims_sources";
export type Sources = Partial<Record<SourceId, string>> & { savedBy?: string; savedAt?: string };

export async function readSources(): Promise<Sources> {
  try {
    const saved = await readSetting<Sources>(SETTING);
    if (saved && SOURCE_IDS.some((id) => saved[id])) return saved;
  } catch {
    // fall through to the local file
  }
  const file = join(process.cwd(), "data", "ims-sources.local.json");
  if (existsSync(file)) {
    try {
      return JSON.parse(readFileSync(file, "utf8")) as Sources;
    } catch {
      return {};
    }
  }
  return {};
}

/** "…/edit?gid=123#gid=123" → the CSV export link of that tab. */
export function csvLink(link: string | undefined): string | null {
  const m = /docs\.google\.com\/spreadsheets\/d\/([\w-]{20,})/.exec(link ?? "");
  if (!m) return null;
  const gid = /[#&?]gid=(\d+)/.exec(link ?? "")?.[1] ?? "0";
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;
}

async function fetchRows(link: string | undefined): Promise<string[][]> {
  const url = csvLink(link);
  if (!url) throw new Error("not set");
  const res = await fetch(url, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!res.ok || (res.headers.get("content-type") ?? "").includes("text/html")) throw new Error(`can't open (${res.status})`);
  return parseCsv(await res.text());
}

export type SourceStatus = { id: SourceId; ok: boolean; rows: number; message: string | null };
export type ImsData = { snapshot: Snapshot; sources: SourceStatus[]; readAt: number; stale: boolean };

const FRESH_MS = 120_000;
const holder = globalThis as { __epikIms?: ImsData; __epikImsLoading?: Promise<ImsData | null> };

const todayIst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

async function readAll(): Promise<ImsData | null> {
  const links = await readSources();
  const results = await Promise.allSettled(SOURCE_IDS.map((id) => fetchRows(links[id])));
  const rows = Object.fromEntries(SOURCE_IDS.map((id, i) => [id, results[i].status === "fulfilled" ? (results[i] as PromiseFulfilledResult<string[][]>).value : null])) as Record<SourceId, string[][] | null>;
  const units = rows.masterbase ? readUnits(rows.masterbase) : [];
  const lines = rows.procurement ? readPoLines(rows.procurement) : [];
  const tracker = rows.tracker ? readTrackerStock(rows.tracker) : { asOf: null, counts: [] };
  const counts: Record<SourceId, number> = { masterbase: units.length, procurement: lines.length, tracker: tracker.counts.length };
  const sources: SourceStatus[] = SOURCE_IDS.map((id, i) => {
    const r = results[i];
    if (r.status === "rejected") return { id, ok: false, rows: 0, message: r.reason instanceof Error && r.reason.message === "not set" ? "Link not set" : "Can't open the sheet by link" };
    return counts[id] ? { id, ok: true, rows: counts[id], message: null } : { id, ok: false, rows: 0, message: `No "${SOURCE_INFO[id].tab}" headings found in that tab` };
  });
  if (!sources.some((s) => s.ok)) return null;
  return { snapshot: buildSnapshot(units, lines, tracker, todayIst()), sources, readAt: Date.now(), stale: false };
}

/** The current stock picture. Reads the sheets when the last read is older than 2 minutes (once, for everyone). */
export async function loadIms(force = false): Promise<ImsData | null> {
  const cached = holder.__epikIms;
  if (!force && cached && Date.now() - cached.readAt < FRESH_MS) return cached;
  holder.__epikImsLoading ??= readAll()
    .then((d) => {
      if (d) holder.__epikIms = d;
      return d ?? (cached ? { ...cached, stale: true } : null);
    })
    .catch(() => (cached ? { ...cached, stale: true } : null))
    .finally(() => {
      holder.__epikImsLoading = undefined;
    });
  return holder.__epikImsLoading;
}

export async function saveSources(next: Partial<Record<SourceId, string>>, by: string): Promise<{ ok: true } | { ok: false; message: string }> {
  for (const id of SOURCE_IDS) {
    if (next[id] && !csvLink(next[id])) return { ok: false, message: `${SOURCE_INFO[id].sheet}: paste the Google Sheets link of the "${SOURCE_INFO[id].tab}" tab.` };
  }
  const current = await readSources();
  await saveSetting(SETTING, { ...current, ...next, savedBy: by, savedAt: new Date().toISOString() });
  holder.__epikIms = undefined;
  return { ok: true };
}

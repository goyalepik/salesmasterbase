import "server-only";

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readSetting, saveSetting } from "@/lib/app-setting";
import { parseCsv } from "@/lib/sheets/sheet-sync";
import { addDays, buildSnapshot, defaultRange, type Range, type Snapshot, type Sources as SheetData } from "./domain/model";
import { readCatalog, readDispatches, readInwards, readPoLines, readTrackerStock, readUnits } from "./domain/sheets";
import { loadEntries } from "./store";

// Where the IMS reads from: one tab of each team sheet that matters, by its link (Share → anyone with the link can
// view). The links are saved in the app's database (Sources page, admins), never in git: the repo is public and the
// sheets hold costs. Localhost can use data/ims-sources.local.json (git-ignored) instead. The sheets are only read.

export type SourceId = "masterbase" | "inward" | "dispatch" | "procurement" | "tracker" | "catalog";
export const SOURCE_INFO: Record<SourceId, { sheet: string; tab: string; role: string }> = {
  masterbase: { sheet: "Inventory Masterbase", tab: "Inventory Masterbase", role: "Stock: one row per serial, from goods in to dispatch." },
  inward: { sheet: "Procurement sheet", tab: "Inward Sheet -Sale unit", role: "Stock in: every unit received, with invoice, vendor and cost." },
  dispatch: { sheet: "Inventory Masterbase", tab: "Dispatch Tracker", role: "Stock out: each item sent, with delivery status." },
  procurement: { sheet: "Procurement sheet", tab: "Procurement list", role: "Coming: every PO line raised, with ETA and GRN status." },
  tracker: { sheet: "Inventory Tracker", tab: "Current Stock", role: "The team's daily count and cost per SKU (cross-check, fills missing costs)." },
  catalog: { sheet: "Inventory Tracker", tab: "In warehouse", role: "Product list: category and list price per SKU." },
};
export const SOURCE_IDS: SourceId[] = ["masterbase", "inward", "dispatch", "procurement", "tracker", "catalog"];

const SETTING = "ims_sources";
const CATEGORY_SETTING = "ims_categories";
export type SourceLinks = Partial<Record<SourceId, string>> & { savedBy?: string; savedAt?: string };

export async function readSources(): Promise<SourceLinks> {
  let saved: SourceLinks | null = null;
  try {
    saved = await readSetting<SourceLinks>(SETTING);
  } catch {
    saved = null;
  }
  const file = join(process.cwd(), "data", "ims-sources.local.json");
  const local: SourceLinks = existsSync(file) ? (() => { try { return JSON.parse(readFileSync(file, "utf8")) as SourceLinks; } catch { return {}; } })() : {};
  return { ...local, ...(saved ?? {}) };
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
  const res = await fetch(url, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(25_000) });
  if (!res.ok || (res.headers.get("content-type") ?? "").includes("text/html")) throw new Error(`can't open (${res.status})`);
  return parseCsv(await res.text());
}

export type SourceStatus = { id: SourceId; ok: boolean; rows: number; message: string | null };
type Read = { data: SheetData; sources: SourceStatus[]; readAt: number; stale: boolean };

const FRESH_MS = 120_000;
const holder = globalThis as { __imsRead?: Read; __imsReading?: Promise<Read | null> };

async function readAll(): Promise<Read | null> {
  const links = await readSources();
  const results = await Promise.allSettled(SOURCE_IDS.map((id) => fetchRows(links[id])));
  const rows = (id: SourceId) => {
    const r = results[SOURCE_IDS.indexOf(id)];
    return r.status === "fulfilled" ? r.value : null;
  };
  const data: SheetData = {
    units: rows("masterbase") ? readUnits(rows("masterbase")!) : [],
    inwards: rows("inward") ? readInwards(rows("inward")!) : [],
    dispatches: rows("dispatch") ? readDispatches(rows("dispatch")!) : [],
    lines: rows("procurement") ? readPoLines(rows("procurement")!) : [],
    tracker: rows("tracker") ? readTrackerStock(rows("tracker")!) : { asOf: null, counts: [] },
    catalog: rows("catalog") ? readCatalog(rows("catalog")!) : [],
  };
  const counts: Record<SourceId, number> = { masterbase: data.units.length, inward: data.inwards.length, dispatch: data.dispatches.length, procurement: data.lines.length, tracker: data.tracker.counts.length, catalog: data.catalog.length };
  const sources = SOURCE_IDS.map((id, i): SourceStatus => {
    const r = results[i];
    if (r.status === "rejected") return { id, ok: false, rows: 0, message: r.reason instanceof Error && r.reason.message === "not set" ? "Link not set" : "Can't open the sheet by link" };
    return counts[id] ? { id, ok: true, rows: counts[id], message: null } : { id, ok: false, rows: 0, message: `No "${SOURCE_INFO[id].tab}" headings found in that tab` };
  });
  if (!sources.find((s) => s.id === "masterbase")?.ok) return null;
  return { data, sources, readAt: Date.now(), stale: false };
}

async function readSheets(force = false): Promise<Read | null> {
  const cached = holder.__imsRead;
  if (!force && cached && Date.now() - cached.readAt < FRESH_MS) return cached;
  holder.__imsReading ??= readAll()
    .then((d) => {
      if (d) holder.__imsRead = d;
      return d ?? (cached ? { ...cached, stale: true } : null);
    })
    .catch(() => (cached ? { ...cached, stale: true } : null))
    .finally(() => {
      holder.__imsReading = undefined;
    });
  return holder.__imsReading;
}

export const todayIst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

/** "7d", "30d", "90d", "mtd" or "2026-11-01..2026-11-27" → a range ending today at most. */
export function parseRange(raw: string | null | undefined, today: string): Range {
  const v = (raw ?? "").trim();
  if (v === "7d") return { from: addDays(today, -6), to: today, label: "Last 7 days" };
  if (v === "90d") return { from: addDays(today, -89), to: today, label: "Last 90 days" };
  if (v === "mtd") return { from: `${today.slice(0, 7)}-01`, to: today, label: "This month" };
  const m = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(v);
  if (m && m[1] <= m[2]) return { from: m[1], to: m[2] > today ? today : m[2], label: `${m[1]} to ${m[2]}` };
  return defaultRange(today);
}

export type ImsData = { snapshot: Snapshot; sources: SourceStatus[]; readAt: number; stale: boolean; entriesReady: boolean };

/** The stock picture for a page: sheets (read at most every 2 minutes) + IMS entries + admin category choices. */
export async function loadIms(opts: { range?: string | null; force?: boolean } = {}): Promise<ImsData | null> {
  const [read, app, choices] = await Promise.all([readSheets(opts.force), loadEntries().catch(() => ({ receipts: [], statuses: [], ready: false })), categoryChoices()]);
  if (!read) return null;
  const today = todayIst();
  const snapshot = buildSnapshot(read.data, today, { range: parseRange(opts.range, today), app, categoryChoices: choices });
  return { snapshot, sources: read.sources, readAt: read.readAt, stale: read.stale, entriesReady: app.ready };
}

export async function categoryChoices(): Promise<Record<string, string>> {
  try {
    return (await readSetting<Record<string, string>>(CATEGORY_SETTING)) ?? {};
  } catch {
    return {};
  }
}

export async function setCategory(sku: string, category: string | null): Promise<void> {
  const all = await categoryChoices();
  const k = sku.toLowerCase().trim();
  if (category) all[k] = category;
  else delete all[k];
  await saveSetting(CATEGORY_SETTING, all);
}

export async function saveSources(next: Partial<Record<SourceId, string>>, by: string): Promise<{ ok: true } | { ok: false; message: string }> {
  for (const id of SOURCE_IDS) {
    if (next[id] && !csvLink(next[id])) return { ok: false, message: `${SOURCE_INFO[id].sheet}: paste the Google Sheets link of the "${SOURCE_INFO[id].tab}" tab.` };
  }
  let current: SourceLinks = {};
  try {
    current = (await readSetting<SourceLinks>(SETTING)) ?? {};
  } catch {
    current = {};
  }
  await saveSetting(SETTING, { ...current, ...next, savedBy: by, savedAt: new Date().toISOString() });
  holder.__imsRead = undefined;
  return { ok: true };
}

export async function refreshSheets(): Promise<void> {
  await readSheets(true);
}

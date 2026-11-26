import "server-only";

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readSetting, saveSetting } from "@/lib/app-setting";
import { parseCsv } from "@/lib/sheets/sheet-sync";
import { monthOfTab, readAdTab, type AdDay } from "./domain/meta";
import { buildDashboard, START, type Dashboard } from "./domain/metrics";
import { readSales, type SaleLine, type SheetTotals } from "./domain/smb";

// Where EPIK HQ reads from, live:
//   Sales ... the "Sales feed" tab of the live copy sheet (=IMPORTRANGE of the SMB's Sales Tracker; the SMB stays private)
//   Ads ..... the Getepik Tracker (Meta spend), every monthly tab from November 2026 on, found by tab name
// Sheet IDs are saved in the database (HQ → Sources, admins) or data/hq-sources.local.json on localhost; never in git.
// Read at most every 2 minutes; a failed read keeps the last good copy.

export type HqSources = { copySheet?: string; salesTab?: string; adsSheet?: string; savedBy?: string; savedAt?: string };
const SETTING = "hq_sources";
const DEFAULT_TAB = "Sales feed";

const idOf = (v: string | undefined) => /\/d\/([\w-]{20,})/.exec(v ?? "")?.[1] ?? (/^[\w-]{20,}$/.test(v ?? "") ? v : undefined);

export async function readHqSources(): Promise<HqSources> {
  let saved: HqSources | null = null;
  try { saved = await readSetting<HqSources>(SETTING); } catch { saved = null; }
  const file = join(process.cwd(), "data", "hq-sources.local.json");
  const local: HqSources = existsSync(file) ? (() => { try { return JSON.parse(readFileSync(file, "utf8")) as HqSources; } catch { return {}; } })() : {};
  return { ...local, ...(saved ?? {}) };
}

export async function saveHqSources(next: HqSources, by: string): Promise<void> {
  const cur = (await readSetting<HqSources>(SETTING).catch(() => null)) ?? {};
  await saveSetting(SETTING, { ...cur, ...next, savedBy: by, savedAt: new Date().toISOString() });
  holder.__hq = undefined;
}

/** The tabs of a link-shared sheet: name → gid (from its public HTML view). */
async function tabsOf(sheetId: string): Promise<Array<{ name: string; gid: string }>> {
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/htmlview`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`sheet not open by link (${res.status})`);
  const html = await res.text();
  const out: Array<{ name: string; gid: string }> = [];
  for (const m of html.matchAll(/items\.push\(\{name: "([^"]*)", pageUrl: "[^"]*?gid=(\d+)/g)) {
    out.push({ name: m[1].replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\\//g, "/"), gid: m[2] });
  }
  return out;
}

async function csv(sheetId: string, gid: string): Promise<string[][]> {
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(25_000) });
  if (!res.ok || (res.headers.get("content-type") ?? "").includes("text/html")) throw new Error(`can't read tab (${res.status})`);
  return parseCsv(await res.text());
}

export type SourceState = { id: "sales" | "ads"; ok: boolean; detail: string };
type Read = { lines: SaleLine[]; totals: SheetTotals; ads: AdDay[]; adTotals: Array<{ month: string; sheet: number | null; ours: number }>; missing: string[]; states: SourceState[]; at: number; stale: boolean };

const FRESH = 120_000;
const holder = globalThis as { __hq?: Read; __hqReading?: Promise<Read | null> };

async function readAll(): Promise<Read | null> {
  const src = await readHqSources();
  const copy = idOf(src.copySheet), ads = idOf(src.adsSheet);
  const states: SourceState[] = [];
  let lines: SaleLine[] = [], totals: SheetTotals = {}, missing: string[] = [];
  try {
    if (!copy) throw new Error("copy sheet not set");
    const tab = (await tabsOf(copy)).find((t) => t.name.trim().toLowerCase() === (src.salesTab ?? DEFAULT_TAB).toLowerCase());
    if (!tab) throw new Error(`no "${src.salesTab ?? DEFAULT_TAB}" tab in the copy sheet yet`);
    const r = readSales(await csv(copy, tab.gid));
    if (!r.lines.length) throw new Error("no Sales Tracker headings in that tab");
    lines = r.lines; totals = r.totals; missing = r.missing;
    states.push({ id: "sales", ok: true, detail: `${r.lines.length} sale lines` });
  } catch (e) {
    states.push({ id: "sales", ok: false, detail: e instanceof Error ? e.message : "can't read" });
  }
  const adDays: AdDay[] = [];
  const adTotals: Read["adTotals"] = [];
  try {
    if (!ads) throw new Error("ads tracker not set");
    const tabs = (await tabsOf(ads)).map((t) => ({ ...t, month: monthOfTab(t.name) })).filter((t) => t.month && t.month >= START.slice(0, 7));
    for (const t of tabs) {
      const r = readAdTab(await csv(ads, t.gid));
      adDays.push(...r.days);
      adTotals.push({ month: t.month!, sheet: r.sheetTotalSpend, ours: r.days.reduce((s, d) => s + d.totalSpend, 0) });
    }
    states.push({ id: "ads", ok: true, detail: `${tabs.length} month${tabs.length === 1 ? "" : "s"}, ${adDays.length} days` });
  } catch (e) {
    states.push({ id: "ads", ok: false, detail: e instanceof Error ? e.message : "can't read" });
  }
  if (!lines.length && !adDays.length) return null;
  return { lines, totals, ads: adDays, adTotals, missing, states, at: Date.now(), stale: false };
}

async function read(force = false): Promise<Read | null> {
  const c = holder.__hq;
  if (!force && c && Date.now() - c.at < FRESH) return c;
  holder.__hqReading ??= readAll()
    .then((d) => { if (d) holder.__hq = d; return d ?? (c ? { ...c, stale: true } : null); })
    .catch(() => (c ? { ...c, stale: true } : null))
    .finally(() => { holder.__hqReading = undefined; });
  return holder.__hqReading;
}

export const todayIst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

export type HqData = { d: Dashboard; states: SourceState[]; adTotals: Read["adTotals"]; missing: string[]; at: number; stale: boolean; hasSales: boolean };

export async function loadHq(range?: string | null, force = false): Promise<HqData | null> {
  const r = await read(force);
  if (!r) return null;
  return { d: buildDashboard(r.lines, r.totals, r.ads, todayIst(), range ?? "mtd"), states: r.states, adTotals: r.adTotals, missing: r.missing, at: r.at, stale: r.stale, hasSales: r.lines.length > 0 };
}

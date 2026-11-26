// The Getepik Tracker: Meta ad spend per day, one tab per month, and the columns change from month to month
// ("Spend (Home)", "Spend(iphone)", "Demo Spend"…). Read by heading; campaigns are mapped to SMB categories so CAC
// can be split by category. Pure: tests use it.

import { num, sheetDay } from "./smb";

export type AdDay = {
  day: string;
  spend: Record<string, number>;
  totalSpend: number;
  homeDemos: Record<string, number>;
  videoDemos: Record<string, number>;
  totalDemos: number;
  purchases: number;
  metaRevenue: number;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** "Spend (Home)" → "home"; "Spend(iphone)" → "iphone"; "Demo Spend" → "home". */
const campaignOf = (h: string) => {
  const m = /\(([^)]+)\)/.exec(h);
  if (m) return m[1].trim().toLowerCase();
  if (/demo spend/i.test(h)) return "home";
  return null;
};

/** Which SMB category a campaign sells. Unknown campaigns stay under their own name. */
export const CAMPAIGN_CATEGORY: Record<string, string> = {
  home: "Robo Vaccum",
  robo: "Robo Vaccum",
  mobile: "Phones",
  iphone: "Phones",
  ap: "Air Purifier",
  af: "Kitchen",
  kitchen: "Kitchen",
  ember: "Kitchen",
};
export const CAMPAIGN_LABEL: Record<string, string> = { home: "Home demos (robot vacuums)", robo: "Home demos (robot vacuums)", mobile: "Phones", iphone: "Phones", ap: "AP", af: "AF", kitchen: "Kitchen", ember: "Kitchen (Ember)" };

export function readAdTab(rows: string[][]): { days: AdDay[]; sheetTotalSpend: number | null } {
  const h = rows.findIndex((r, i) => i < 8 && r.some((c) => norm(c) === "date") && r.some((c) => norm(c) === "totalspend"));
  if (h < 0) return { days: [], sheetTotalSpend: null };
  const head = rows[h];
  const days: AdDay[] = [];
  let sheetTotalSpend: number | null = null;
  for (const row of rows.slice(h + 1)) {
    const label = (row[0] ?? "").trim();
    const total = head.findIndex((c) => norm(c) === "totalspend");
    if (/total/i.test(label)) {
      const v = num(row[total]);
      if (Number.isFinite(v)) sheetTotalSpend = v;
      continue;
    }
    const day = sheetDay(label);
    if (!day) continue;
    const d: AdDay = { day, spend: {}, totalSpend: 0, homeDemos: {}, videoDemos: {}, totalDemos: 0, purchases: 0, metaRevenue: 0 };
    head.forEach((hRaw, i) => {
      const hd = (hRaw ?? "").trim();
      const v = num(row[i]);
      const val = Number.isFinite(v) ? v : 0;
      const n = norm(hd);
      const c = campaignOf(hd);
      if (n === "totalspend") d.totalSpend = val;
      else if (/spend/i.test(hd) && !/cpa/i.test(hd) && c) d.spend[c] = (d.spend[c] ?? 0) + val;
      else if (/^video demos/i.test(hd) && c) d.videoDemos[c] = (d.videoDemos[c] ?? 0) + val;
      else if (/^(home )?demos( booked)?/i.test(hd) && !/cpa/i.test(hd) && c) d.homeDemos[c] = (d.homeDemos[c] ?? 0) + val;
      else if (n === "totaldemos") d.totalDemos = val;
      else if (/^purchases/i.test(hd)) d.purchases += val;
      else if (n === "grossrevenue") d.metaRevenue = val;
    });
    if (!d.totalDemos) d.totalDemos = Object.values(d.homeDemos).reduce((s, x) => s + x, 0) + Object.values(d.videoDemos).reduce((s, x) => s + x, 0);
    if (d.totalSpend || d.totalDemos || d.purchases) days.push(d);
  }
  return { days, sheetTotalSpend };
}

/** Tab names like "Nov 2026 Tracker", "October 2026", "Sep 2026" → "2026-11". */
export function monthOfTab(name: string): string | null {
  const m = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(\d{4})/i.exec(name);
  if (!m) return null;
  const mo = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[1].toLowerCase()) + 1;
  return `${m[2]}-${String(mo).padStart(2, "0")}`;
}

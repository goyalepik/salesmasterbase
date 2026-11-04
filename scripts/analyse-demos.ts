/**
 * Reads the "completed demos with transcripts" workbook and writes the Customer Insights report:
 * data/demo-insights.local.json (gitignored). The report holds totals and rates only, no customer details.
 *
 *   npx tsx scripts/analyse-demos.ts --demos "epik_completed_demos_with_transcripts.xlsx" [--orders data/ops-seed.local.json] [--out data/demo-insights.local.json] [--push]
 *   npx tsx scripts/analyse-demos.ts --push      # upload the report already on this computer
 *
 * --orders links demos to real orders by phone, which catches sales the CRM status missed and gives the order value.
 * --push copies the report (and Claude's call notes, if present) to a private Supabase Storage bucket, which is
 *        what the live /insights page shows. It reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { normaliseDemo, type RawRow } from "../src/features/insights/lib/demos";
import { buildReport, type OrderRef } from "../src/features/insights/lib/report";
import { INSIGHTS_BUCKET, STORED_FILES, downloadJson, uploadInsights } from "../src/features/insights/lib/storage";
import type { InsightsReport } from "../src/features/insights/lib/types";
import { readEnv } from "../src/lib/env";
import type { OpsSeed } from "../src/lib/ops/snapshot";

const NOTES_PATH = "data/demo-call-notes.local.json";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

function text(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const o = v as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((r) => r.text).join("");
    if (o.text != null) return text(o.text);
    if (o.result != null) return text(o.result);
    return "";
  }
  return String(v).trim();
}

async function main() {
  const demosPath = arg("demos");
  const push = process.argv.includes("--push");
  const out = arg("out") ?? "data/demo-insights.local.json";
  if (!demosPath && !push) throw new Error('Pass --demos "<completed demos workbook>.xlsx", or --push to upload the report already on this computer');
  if (demosPath) await analyse(demosPath, out);
  if (push) await pushReport(out);
}

async function analyse(demosPath: string, out: string) {
  const ordersPath = arg("orders") ?? (existsSync("data/ops-seed.local.json") ? "data/ops-seed.local.json" : null);

  console.log(`Reading ${basename(demosPath)} …`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(demosPath);
  const ws = wb.getWorksheet("Completed Demos") ?? wb.worksheets[0];
  const head = (ws.getRow(1).values as unknown[]).slice(1).map(text);
  const rows: RawRow[] = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const r: RawRow = {};
    head.forEach((h, c) => { r[h] = text(row.getCell(c + 1).value); });
    if (r["Booking ID"]) rows.push(r);
  });

  // "Data pulled 2026-11-02." in the Summary sheet; otherwise today.
  let pulledAt = new Date().toISOString().slice(0, 10);
  wb.getWorksheet("Summary")?.eachRow((row) => {
    for (const v of (row.values as unknown[]).slice(1)) {
      const m = /data pulled (\d{4}-\d{2}-\d{2})/i.exec(text(v));
      if (m) pulledAt = m[1];
    }
  });

  let orders: OrderRef[] | undefined;
  if (ordersPath) {
    const seed = JSON.parse(readFileSync(ordersPath, "utf8")) as OpsSeed;
    orders = seed.orders
      .filter((o) => o.phone && o.createdAt)
      .map((o) => ({ phone: o.phone!.replace(/\D/g, "").slice(-10), date: o.createdAt.slice(0, 10), valueMinor: o.lines.reduce((s, l) => s + (l.offeredPriceMinor || 0), 0) }));
    console.log(`Linking to ${orders.length} orders from ${basename(ordersPath)}`);
  }

  const demos = rows.map(normaliseDemo);
  const report = buildReport(demos, { file: basename(demosPath), pulledAt, orders });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 1));

  console.log(`\n${report.base.demos} demos · ${report.base.mature} old enough to judge · ${report.base.won} sales (${(report.base.rate * 100).toFixed(1)}%)`);
  console.log(`Lead score AUC ${report.model.auc.toFixed(3)} on ${report.model.test} unseen demos`);
  for (const h of report.headlines) console.log(`- [${h.metric}] ${h.title}`);
  console.log(`\nWrote ${out}`);
}

/** Copy the report to Supabase Storage for the live site, then read it back the way the site does. */
async function pushReport(out: string) {
  if (!process.env.SUPABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const env = readEnv();
  if (!env.supabaseUrl || !env.serviceRoleKey) throw new Error("Add the live SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.local first.");
  if (!existsSync(out)) throw new Error(`No report at ${out}. Run with --demos first.`);
  const files: { name: string; json: string }[] = [{ name: STORED_FILES.report, json: readFileSync(out, "utf8") }];
  if (existsSync(NOTES_PATH)) files.push({ name: STORED_FILES.notes, json: readFileSync(NOTES_PATH, "utf8") });

  const db = createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  await uploadInsights(db, files);
  const back = await downloadJson<InsightsReport>(db, STORED_FILES.report);
  if (!back || back.generatedAt !== (JSON.parse(files[0].json) as InsightsReport).generatedAt) throw new Error("Uploaded, but reading it back gave a different report. Try again.");
  console.log(`\nUploaded ${files.map((f) => f.name).join(" and ")} to the private "${INSIGHTS_BUCKET}" bucket in Supabase, and read it back: ${back.base.demos.toLocaleString("en-IN")} demos, ${back.headlines.length} headlines. The live /insights page now shows this report.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

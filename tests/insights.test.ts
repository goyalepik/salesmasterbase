import assert from "node:assert/strict";
import { test } from "node:test";
import { brandOf, categoryOf, dealPrice, normaliseDemo, sourceGroup, speedBucket, type RawRow } from "../src/features/insights/lib/demos";
import { buildReport } from "../src/features/insights/lib/report";
import { auc, fitLogit, predict, shrunkRate, wilson } from "../src/features/insights/lib/stats";
import type { SupabaseClient } from "@supabase/supabase-js";
import { STORED_FILES, downloadJson, uploadInsights } from "../src/features/insights/lib/storage";

// Made-up demos only. Phones use the +9190000xxxxx test range.
function row(i: number, over: Partial<RawRow> = {}): RawRow {
  const month = String(2 + (i % 8)).padStart(2, "0");
  const day = String(1 + (i % 27)).padStart(2, "0");
  return {
    "Booking ID": `b-${i}`,
    "Demo Date (IST)": `2026-${month}-${day} 1${i % 9}:00`,
    "Lead Created (IST)": `2026-${month}-${day} 09:00`,
    "Demo Type": i % 5 === 0 ? "virtual" : "physical",
    Status: "COMPLETED",
    Source: i % 3 === 0 ? "whatsapp" : "Mobile-Website",
    "Customer Phone": `90000${String(i).padStart(5, "0")}`,
    Hub: i % 2 ? "Hebbal" : "Jayanagar",
    Products: i % 4 === 0 ? "DREAME L50 Robot Vacuum and Mop" : "ECOVACS DEEBOT N30 Robot Vacuum",
    "CD Name": `CDE ${i % 6}`,
    "Customer Rating": String(1 + (i % 5)),
    "CD Comments": JSON.stringify({ q1DemoOutcome: "Interested but not ready yet", q2CustomerIssue: "Family decision pending", q3ApproximateAgeGroup: "25–35", q4DecisionMaker: "Customer + family", q5PriceResponseDuringDemo: "Asked for discount / better offer" }),
    "Start Time (IST)": `2026-${month}-${day} 11:00`,
    "End Time (IST)": `2026-${month}-${day} 1${1 + (i % 3)}:${i % 2 ? "10" : "40"}`,
    "Audio Duration (sec)": "",
    "Hot Lead (AI)": i % 2 ? "true" : "false",
    "AI Intent": "low | medium | high",
    "AI Sentiment": "positive",
    "AI Call Result": "",
    "Full Transcript": "",
    ...over,
  };
}

test("cleaning a demo row", () => {
  const d = normaliseDemo(row(1, { "Customer Rating": "0", "CD Comments": "INR59999", "Full Transcript": "We talked about the EMI" }));
  assert.equal(d.type, "Physical");
  assert.equal(d.brand, "Ecovacs");
  assert.equal(d.category, "Robot vacuum");
  assert.equal(d.rating, null, "0 means never asked");
  assert.equal(d.survey, null, "a price overwrote the survey");
  assert.equal(d.dealMinor, 5_999_900);
  assert.equal(d.ai.intent, null, "the list of allowed values is not an answer");
  assert.equal(d.demoMinutes, 70);
  assert.equal(dealPrice("INR1"), null);
  assert.equal(brandOf("ILIFE V9 robot"), "iLife");
  assert.equal(brandOf("iPhone 17 Pro"), "Apple");
  assert.equal(categoryOf("Ray-Ban Meta Wayfarer glasses"), "Smart glasses");
  assert.equal(sourceGroup("android"), "App");
  assert.equal(sourceGroup("philips_brand_sheet"), "Brand partner leads");
  assert.equal(speedBucket("2026-03-01", "2026-03-01"), "Same day");
  assert.equal(speedBucket("2026-03-01", "2026-03-20"), "15+ days");
  assert.equal(speedBucket("2026-03-05", "2026-03-01"), "Not known");
});

test("wilson interval and shrinkage behave at the edges", () => {
  assert.deepEqual(wilson(0, 0), { lo: 0, hi: 0 });
  const w = wilson(20, 100);
  assert.ok(w.lo > 0.12 && w.lo < 0.14 && w.hi > 0.28 && w.hi < 0.3);
  assert.ok(wilson(0, 10).hi > 0.2, "zero wins still leaves room");
  assert.equal(shrunkRate(0, 0, 0.2), 0.2);
  assert.ok(Math.abs(shrunkRate(2, 3, 0.2) - 0.2) < 0.05, "3 demos barely move the estimate");
});

test("logistic regression learns a clear signal and AUC scores it", () => {
  const samples = Array.from({ length: 400 }, (_, i) => ({ x: new Map([[i % 2, 1]]), y: (i % 2 === 0 ? (i % 10 < 8 ? 1 : 0) : i % 10 < 1 ? 1 : 0) as 0 | 1 }));
  const model = fitLogit(samples, 2);
  assert.ok(predict(model, new Map([[0, 1]])) > 0.6);
  assert.ok(predict(model, new Map([[1, 1]])) < 0.25);
  assert.equal(auc([{ p: 0.9, y: 1 }, { p: 0.1, y: 0 }]), 1);
  assert.equal(auc([{ p: 0.5, y: 1 }, { p: 0.5, y: 0 }]), 0.5);
});

test("the report: outcomes, tracking start, survey leak and no customer data", () => {
  const raw = Array.from({ length: 900 }, (_, i) => row(i));
  // WhatsApp leads and long demos close; closing writes the price over the survey, as in the real sheet.
  for (const r of raw) {
    const i = Number(r["Booking ID"].slice(2));
    if ((r.Source === "whatsapp" && i % 2 === 0) || i % 11 === 0) { r.Status = "NEGOTIATION_CLOSED"; r["CD Comments"] = "INR45000"; }
  }
  // An old imported month whose outcomes were never tracked.
  for (let i = 0; i < 120; i++) raw.push(row(5000 + i, { "Demo Date (IST)": "2026-01-10 12:00", "Lead Created (IST)": "2026-01-09 10:00" }));
  raw.push(row(9999, { "Demo Date (IST)": "2000-01-01 00:00" }));
  const orders = [{ phone: "9000000007", date: "2026-02-20", valueMinor: 3_000_000 }];
  const report = buildReport(raw.map(normaliseDemo), { file: "test.xlsx", pulledAt: "2026-10-30", orders, now: new Date("2026-11-04T00:00:00Z") });

  assert.equal(report.base.mature, 900, "the untracked January and the broken date are left out");
  assert.ok(report.quality.some((q) => /no outcome tracked/.test(q.label) && q.count === 120));
  assert.ok(report.quality.some((q) => /broken date/.test(q.label) && q.count === 1));
  assert.ok(report.quality.some((q) => /survey was overwritten/.test(q.label)));
  assert.equal(report.base.aovMinor, 4_500_000, "average sale comes from the deal prices");
  const wa = report.segments.source.rows.find((r) => r.key === "WhatsApp")!;
  const web = report.segments.source.rows.find((r) => r.key === "Website")!;
  assert.ok(wa.rate > web.rate * 3);
  assert.ok(report.model.auc > 0.6);
  assert.ok(!report.model.drivers.some((d) => d.group === "Price reaction" || d.level === "Not asked"), "the survey stays out of the model");
  assert.ok(report.headlines.length >= 5);
  // Every data-health count says what it is out of.
  for (const q of report.quality) assert.ok(q.of >= q.count && q.of > 0, q.label);
  const funnel = report.dataset.funnel.map((f) => f.n);
  assert.deepEqual(funnel, [...funnel].sort((x, y) => y - x), "each processing step keeps the same or fewer rows");
  assert.equal(funnel[0], 1021);
  assert.ok(report.dataset.healthScore > 0 && report.dataset.healthScore <= 100);
  // The model lab: six models plus the AI flag, the floor model scores AUC 0.5, the best beats it.
  const ids = report.lab.results.map((m) => m.id);
  assert.deepEqual(ids, ["gbm", "rf", "logit", "tree", "nb", "base", "aiflag"]);
  const base = report.lab.results.find((m) => m.id === "base")!;
  const best = report.lab.results.find((m) => m.id === report.lab.best)!;
  assert.equal(base.holdout.auc, 0.5);
  assert.ok(best.cv.f1 > base.cv.f1, "the best model beats guessing everyone buys");
  const c = report.lab.confusion;
  assert.equal(c.tp + c.fp + c.fn + c.tn, report.lab.test);
  assert.ok(report.lab.gains.at(-1)![1] === 1, "the gains curve ends at every buyer found");
  const json = JSON.stringify(report);
  assert.ok(!/90000\d{5}/.test(json), "no phone numbers in the report");
});

test("the live copy: a private bucket made once, files replaced on every push, read back as JSON", async () => {
  const calls: string[] = [];
  const files = new Map<string, string>();
  let bucket = false;
  let failNext = false;
  const fake = {
    storage: {
      getBucket: async () => (bucket ? { data: {}, error: null } : { data: null, error: { message: "Bucket not found" } }),
      createBucket: async (id: string, o: { public: boolean }) => { calls.push(`create ${id} public=${o.public}`); bucket = true; return { data: {}, error: null }; },
      from: (b: string) => ({
        upload: async (path: string, body: string, o: { upsert: boolean }) => {
          if (failNext) return { data: null, error: { message: "quota exceeded" } };
          calls.push(`upload ${b}/${path} upsert=${o.upsert}`);
          files.set(path, body);
          return { data: {}, error: null };
        },
        download: async (path: string) => (files.has(path) ? { data: new Blob([files.get(path)!]), error: null } : { data: null, error: { message: "Object not found" } }),
      }),
    },
  } as unknown as SupabaseClient;

  assert.equal(await downloadJson(fake, STORED_FILES.report), null, "nothing uploaded yet");
  await uploadInsights(fake, [{ name: STORED_FILES.report, json: '{"version":1}' }]);
  await uploadInsights(fake, [{ name: STORED_FILES.report, json: '{"version":2}' }]);
  assert.deepEqual(calls, ["create insights public=false", "upload insights/demo-insights.json upsert=true", "upload insights/demo-insights.json upsert=true"]);
  assert.deepEqual(await downloadJson(fake, STORED_FILES.report), { version: 2 });
  failNext = true;
  await assert.rejects(uploadInsights(fake, [{ name: STORED_FILES.notes, json: "{}" }]), /Could not upload demo-call-notes.json: quota exceeded/);
});

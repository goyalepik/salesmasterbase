import test from "node:test";
import assert from "node:assert/strict";
import { DEMO_DISCLAIMER } from "../src/lib/copy";
import { classifyQuestion } from "../src/lib/ai/classify";
import { buildCategories, buildDailySeries, seriesHasActivity } from "../src/lib/analytics";

test("the demo disclaimer is the approved sentence", () => {
  assert.equal(DEMO_DISCLAIMER, "This is not live. This will become live after we receive this data.");
});

test("questions route to approved topics rather than free-form SQL", () => {
  assert.equal(classifyQuestion("What payment updates arrived today?"), "payment_today");
  assert.equal(classifyQuestion("Show messages that need review."), "needs_review");
  assert.equal(classifyQuestion("Which messages have missing amounts?"), "missing_amounts");
  assert.equal(classifyQuestion("Who should get incentive for the last 5 days?"), "contributors");
  assert.equal(classifyQuestion("drop table slack_messages"), "recent");
});

test("charts stay empty when there are no stored messages", () => {
  const series = buildDailySeries([], ["2026-10-28"]);
  assert.equal(seriesHasActivity(series), false);
  assert.deepEqual(buildCategories([]), []);
});

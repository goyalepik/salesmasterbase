import test from "node:test";
import assert from "node:assert/strict";
import { DEMO_DISCLAIMER } from "../src/lib/copy";
import { groundedAnswer, type GroundedFacts } from "../src/lib/ai/ground";
import { classifyQuestion } from "../src/lib/ai/classify";
import { buildCategories, buildDailySeries, seriesHasActivity } from "../src/lib/analytics";

const facts: GroundedFacts = {
  mode: "live",
  question: "What arrived?",
  rangeLabel: "Today, IST",
  counts: { Messages: 2, "Payment mentions": 1 },
  notes: ["Payment mentions are unverified."],
  sources: [{ id: "m1", href: "/inbox/m1", label: "sample" }],
  brief: "See, this is what I found. 2 messages were stored, with 1 payment mention.",
};

test("the demo disclaimer is the approved sentence", () => {
  assert.equal(DEMO_DISCLAIMER, "This is not live. This will become live after we receive this data.");
});

test("a model answer that introduces a number outside the query is discarded", () => {
  const rejected = groundedAnswer(facts, "Revenue reached 999 today and 2 messages arrived.");
  assert.equal(rejected.usedModel, false);
  assert.deepEqual(rejected.rejectedNumbers, ["999"]);
  assert.match(rejected.text, /2 messages/);
});

test("a model answer may repeat counts that came from the query", () => {
  const accepted = groundedAnswer(facts, "2 messages were stored, including 1 payment mention. See /inbox/m1.");
  assert.equal(accepted.usedModel, true);
  assert.match(accepted.text, /not verified|unverified|payment mention/i);
});

test("demo answers keep the disclaimer even when the model is used", () => {
  const accepted = groundedAnswer({ ...facts, mode: "demo" }, "2 messages were stored.");
  assert.equal(accepted.text.startsWith(DEMO_DISCLAIMER), true);
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

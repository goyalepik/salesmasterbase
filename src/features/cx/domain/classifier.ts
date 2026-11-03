import { KEYWORDS, POLICY, PRIORITY_RANK, scenario } from "./config";
import { extractEntities } from "./entities";
import { customerText, normalise, type Normalised } from "./text";
import type { Channel, Classification, Level, Sentiment } from "./types";

type Rule = { id?: string; scenario: string; level?: string; pattern: string };
const compile = (rules: Rule[]) => rules.map((r) => ({ ...r, re: new RegExp(r.pattern, "i") }));
const HARD = compile(KEYWORDS.hard);
const SOFT = compile(KEYWORDS.scenarios);
const ANGRY = KEYWORDS.sentiment.angry;
const HAPPY = KEYWORDS.sentiment.positive;

export function sentimentOf(n: Normalised, threat: boolean): Sentiment {
  const signals: string[] = [];
  let score = 0;
  for (const w of ANGRY) if (n.text.includes(w)) { score -= 2; signals.push(`angry word "${w}"`); }
  for (const w of HAPPY) if (n.text.includes(w)) { score += 1; signals.push(`positive word "${w}"`); }
  if (n.caps > 0.6) { score -= 1; signals.push("written in capitals"); }
  if (n.bangs > 0) { score -= 1; signals.push("repeated ?! marks"); }
  if (n.emoji === "sad") { score -= 1; signals.push("angry or sad emoji"); }
  if (n.emoji === "happy") { score += 1; signals.push("happy emoji"); }
  if (threat) { score -= 3; signals.push("threat"); }
  return { tone: score <= -2 ? "neg" : score >= 2 ? "pos" : "neu", score, signals };
}

/** One optional hook for a language model. Off unless CX_LLM_ENABLED=true; rules alone decide otherwise. */
export type LlmClassifier = (input: { text: string; hints: Classification }) => Promise<Partial<Pick<Classification, "scenarioId" | "confidence" | "explanation">> | null>;

/**
 * L0 classification: hard rules first (they cannot be overridden), then the ordered scenario rules.
 * Never forces a bucket: low confidence or a conflict goes to "Others / needs review".
 */
export function classify(input: { text: string; channel: Channel }): Classification {
  const raw = input.text ?? "";
  const own = customerText(raw) || raw;
  const n = normalise(own);
  const entities = extractEntities(own);
  const explanation: string[] = [];

  if (input.channel === "missed_call") {
    const s = scenario("K1");
    return { bucket: s.bucket, scenarioId: s.id, secondaryScenarioIds: [], type: s.type, basePriority: s.priority, confidence: 1, explanation: ["Missed call: a callback ticket is created for every missed call."], hardRule: "missed_call", forcedLevel: "L1", entities, sentiment: { tone: "neu", score: 0, signals: [] }, needsReview: false };
  }

  const hard = HARD.filter((r) => r.re.test(n.text));
  const soft = SOFT.filter((r) => r.re.test(n.text));
  const threat = hard.some((r) => r.id === "legal_fraud" || r.id === "public_post");
  const sentiment = sentimentOf(n, threat);
  const byPriority = <T extends { scenario: string }>(list: T[]) => [...list].sort((a, b) => PRIORITY_RANK[scenario(a.scenario).priority] - PRIORITY_RANK[scenario(b.scenario).priority]);

  if (hard.length) {
    const [primary, ...rest] = byPriority(hard);
    const s = scenario(primary.scenario);
    explanation.push(`Hard rule "${primary.id}" matched: ${s.name} (${s.id}).`);
    const secondary = [...new Set([...rest.map((r) => r.scenario), ...soft.map((r) => r.scenario)])].filter((id) => id !== s.id);
    if (secondary.length) explanation.push(`Also mentioned: ${secondary.join(", ")}.`);
    if (sentiment.signals.length) explanation.push(`Tone: ${sentiment.tone} (${sentiment.signals.join(", ")}).`);
    return { bucket: s.bucket, scenarioId: s.id, secondaryScenarioIds: secondary, type: s.type, basePriority: s.priority, confidence: 0.95, explanation, hardRule: primary.id ?? null, forcedLevel: (primary.level as Level | undefined) ?? s.level ?? null, entities, sentiment, needsReview: false };
  }

  if (!soft.length) {
    const s = scenario("K2");
    explanation.push("No rule matched, so this goes to a person to read. Nothing is guessed.");
    return { bucket: s.bucket, scenarioId: s.id, secondaryScenarioIds: [], type: s.type, basePriority: s.priority, confidence: 0.3, explanation, hardRule: null, forcedLevel: "L1", entities, sentiment, needsReview: true };
  }

  const ordered = byPriority(soft);
  const s = scenario(ordered[0].scenario);
  const secondary = [...new Set(ordered.slice(1).map((r) => r.scenario))].filter((id) => id !== s.id);
  const otherBuckets = secondary.map((id) => scenario(id)).filter((o) => o.bucket !== s.bucket);
  // Two urgent requests from different areas: a person decides which comes first.
  const conflict = otherBuckets.some((o) => PRIORITY_RANK[o.priority] <= 1 && PRIORITY_RANK[s.priority] <= 1 && o.priority === s.priority);
  let confidence = secondary.length === 0 ? 0.85 : otherBuckets.length === 0 ? 0.8 : 0.72;
  if (conflict) confidence = 0.6;
  explanation.push(`Matched "${s.name}" (${s.id}).`);
  if (secondary.length) explanation.push(`Also matched: ${secondary.join(", ")}; the most urgent one is primary.`);
  if (sentiment.signals.length) explanation.push(`Tone: ${sentiment.tone} (${sentiment.signals.join(", ")}).`);
  const needsReview = confidence < POLICY.confidenceGate;
  if (needsReview) explanation.push(`Confidence ${Math.round(confidence * 100)}% is under ${Math.round(POLICY.confidenceGate * 100)}%: sent to Others for a person to check.`);
  return { bucket: s.bucket, scenarioId: s.id, secondaryScenarioIds: secondary, type: s.type, basePriority: s.priority, confidence, explanation, hardRule: null, forcedLevel: s.level ?? null, entities, sentiment, needsReview };
}

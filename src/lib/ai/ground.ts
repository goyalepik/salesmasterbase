import { DEMO_DISCLAIMER } from "@/lib/copy";

export type SourceRef = {
  id: string;
  href: string;
  label: string;
};

export type GroundedFacts = {
  mode: "demo" | "live";
  question: string;
  rangeLabel: string;
  counts: Record<string, number>;
  notes: string[];
  sources: SourceRef[];
  brief: string;
};

export function allowedNumbers(facts: GroundedFacts): Set<string> {
  const values = new Set<string>();
  for (const value of Object.values(facts.counts)) {
    values.add(String(value));
    values.add(value.toLocaleString("en-IN"));
  }
  return values;
}

export function unsupportedNumbers(prose: string, facts: GroundedFacts): string[] {
  const allowed = allowedNumbers(facts);
  const found = prose.match(/\d[\d,]*/g) ?? [];
  return found.filter((token) => !allowed.has(token) && !allowed.has(token.replaceAll(",", "")));
}

export function fallbackSummary(facts: GroundedFacts): string {
  return facts.brief;
}

export function groundedAnswer(facts: GroundedFacts, modelText: string | null): { text: string; usedModel: boolean; rejectedNumbers: string[] } {
  if (!modelText?.trim()) {
    const text = facts.mode === "demo" ? `${DEMO_DISCLAIMER} ${facts.brief}` : facts.brief;
    return { text, usedModel: false, rejectedNumbers: [] };
  }
  const rejected = unsupportedNumbers(modelText, facts);
  if (rejected.length > 0) return { text: fallbackSummary(facts), usedModel: false, rejectedNumbers: rejected };
  const prefix = facts.mode === "demo" ? `${DEMO_DISCLAIMER} ` : "";
  return { text: `${prefix}${modelText.trim()}`, usedModel: true, rejectedNumbers: [] };
}

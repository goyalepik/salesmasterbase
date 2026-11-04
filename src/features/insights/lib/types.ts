import type { ModelLab } from "./models";

// The Customer Insights report. Built offline from the demo sheet (scripts/analyse-demos.ts) and read by the /insights page.
// It holds only totals and rates: no customer names, phones, addresses or transcript text.

/** One group's conversion: e.g. "Virtual demos: 312 of 1,704 bought (18%)". */
export type Rate = {
  key: string;
  n: number;
  won: number;
  rate: number;
  /** 95% interval for the rate. */
  lo: number;
  hi: number;
  /** rate ÷ overall rate. 1.5 means 50% better than average. */
  lift: number;
};

export type Segment = { title: string; question: string; note?: string; rows: Rate[] };

export type SegmentId =
  | "demoType" | "category" | "brand" | "source" | "hub" | "speed" | "weekday" | "hour" | "demoLength" | "callLength"
  | "age" | "decisionMaker" | "issue" | "priceResponse" | "rating" | "aiHot" | "aiIntent" | "aiResult" | "aiSentiment";

export type Headline = { tone: "good" | "bad" | "info"; metric: string; title: string; detail: string };

export type Consultant = {
  name: string;
  demos: number;
  won: number;
  rate: number;
  /** The rate pulled toward the average for small samples. */
  fair: number;
  /** What an average CDE (Customer Delight Executive) would have closed with the same products, hubs, sources and timing. */
  expected: number;
  /** (won − expected) ÷ demos: closing skill once the mix is taken out. */
  skill: number;
  rating: number | null;
  avgDemoMin: number | null;
  topCategory: string;
};

export type Theme = { id: string; label: string; n: number; share: number; won: number; rate: number; lo: number; hi: number; lift: number };

export type InsightsReport = {
  version: 1;
  generatedAt: string;
  source: { file: string; pulledAt: string; orderMatch: boolean };
  outcomeRule: string;
  base: {
    demos: number;
    /** Demos old enough to have had time to convert; all rates use these. */
    mature: number;
    won: number;
    rate: number;
    from: string;
    to: string;
    transcripts: number;
    surveyed: number;
    aiScored: number;
    matchedOrders: number;
    aovMinor: number | null;
    revenueMinor: number | null;
  };
  headlines: Headline[];
  opportunities: { title: string; detail: string; sales: number; valueMinor: number | null }[];
  trend: { month: string; demos: number; won: number; rate: number; virtualShare: number; mature: boolean; tracked: boolean }[];
  segments: Record<SegmentId, Segment>;
  heatmap: { day: number; hour: number; n: number; rate: number }[];
  model: {
    /** The model the lead score uses: the best of the lab. */
    name: string;
    auc: number;
    train: number;
    test: number;
    drivers: { group: string; level: string; odds: number; n: number }[];
    deciles: { decile: number; n: number; rate: number }[];
  };
  consultants: Consultant[];
  calibration: Rate[];
  themes: Theme[];
  competitors: Theme[];
  quality: { label: string; count: number; of: number; note: string }[];
  lab: ModelLab;
  dataset: {
    rows: number;
    trackedFrom: string;
    matureBefore: string;
    funnel: { label: string; n: number; note: string }[];
    coverage: { label: string; n: number; of: number; note: string }[];
    /** Average completeness of the core fields, out of 100. */
    healthScore: number;
    status: Slice[];
    transcriptSource: Slice[];
    category: Slice[];
    source: Slice[];
    demoType: Slice[];
  };
};

export type Slice = { label: string; n: number };

/** What Claude found reading a sample of won and lost calls. Paraphrased patterns with counts; no names or quotes. */
export type CallNoteItem = { label: string; count: number; detail: string };
export type CallNoteSide = { sample: number; readable: number; groups: { id: string; title: string; items: CallNoteItem[] }[]; surprises: string[] };
export type CallNotes = { generatedAt: string; method: string; won: CallNoteSide; lost: CallNoteSide };

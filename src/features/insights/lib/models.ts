// The model lab: six ways to predict "will this demo become a sale", trained and scored the same way,
// so the Technical page can compare them fairly (5-fold cross-validation, threshold picked on held-back data).

import { auc, fitLogit, hashUnit, predict } from "./stats";

export type Item = { id: string; feats: [string, string][]; y: 0 | 1; aiHot: boolean | null };

type Encoded = {
  items: Item[];
  /** Active feature per group, in group order. One per group: every group has a level, even "Not set". */
  rows: number[][];
  y: Uint8Array;
  f: number;
  groups: string[];
};

type Predictor = (list: number[], mask: Uint8Array) => number;
type Trainer = (enc: Encoded, train: number[], rand: () => number) => Predictor;

export type Metrics = { precision: number; recall: number; f1: number; accuracy: number; auc: number; brier: number };

export type ModelResult = {
  id: string;
  name: string;
  kind: string;
  about: string;
  n: number;
  holdout: Metrics & { threshold: number };
  cv: { f1: number; f1Sd: number; auc: number; aucSd: number };
};

export type ModelLab = {
  folds: number;
  train: number;
  test: number;
  positiveRate: number;
  best: string;
  results: ModelResult[];
  roc: { id: string; points: [number, number][] }[];
  confusion: { tp: number; fp: number; fn: number; tn: number; threshold: number };
  calibration: { p: number; actual: number; n: number }[];
  gains: [number, number][];
  deciles: { decile: number; n: number; rate: number }[];
  importance: { group: string; drop: number }[];
};

/** Small seeded random numbers, so every run gives the same answer. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function encode(items: Item[]): Encoded {
  const index = new Map<string, number>();
  const groups = items[0]?.feats.map(([g]) => g) ?? [];
  const rows = items.map((it) => it.feats.map(([g, l]) => {
    const k = `${g}\u0000${l}`;
    if (!index.has(k)) index.set(k, index.size);
    return index.get(k)!;
  }));
  return { items, rows, y: Uint8Array.from(items.map((i) => i.y)), f: index.size, groups };
}

function maskOf(list: number[], f: number): Uint8Array {
  const m = new Uint8Array(f);
  for (const j of list) m[j] = 1;
  return m;
}

// ── Trees ─────────────────────────────────────────────────────────────────────────────────────
// One builder for all three tree models, in the gradient form: classification trees use g = −y, h = 1
// (the leaf is the share that bought); boosting uses the log-loss gradient.

type TNode = { f: number; l: TNode; r: TNode } | { v: number };

type GrowOpts = { maxDepth: number; minLeaf: number; lambda: number; mtry: number; rand: () => number };

function grow(enc: Encoded, idx: number[], g: Float64Array, h: Float64Array, depth: number, o: GrowOpts): TNode {
  let G = 0;
  let H = 0;
  for (const i of idx) { G += g[i]; H += h[i]; }
  const leaf = { v: -G / (H + o.lambda) };
  if (depth >= o.maxDepth || idx.length < 2 * o.minLeaf) return leaf;
  const GL = new Float64Array(enc.f);
  const HL = new Float64Array(enc.f);
  const NL = new Int32Array(enc.f);
  for (const i of idx) for (const j of enc.rows[i]) { GL[j] += g[i]; HL[j] += h[i]; NL[j]++; }
  const parent = (G * G) / (H + o.lambda);
  let best = -1;
  let bestGain = 1e-9;
  for (let j = 0; j < enc.f; j++) {
    if (o.mtry < enc.f && o.rand() * enc.f >= o.mtry) continue;
    const nl = NL[j];
    if (nl < o.minLeaf || idx.length - nl < o.minLeaf) continue;
    const gr = G - GL[j];
    const hr = H - HL[j];
    const gain = (GL[j] * GL[j]) / (HL[j] + o.lambda) + (gr * gr) / (hr + o.lambda) - parent;
    if (gain > bestGain) { bestGain = gain; best = j; }
  }
  if (best < 0) return leaf;
  const right: number[] = [];
  const left: number[] = [];
  for (const i of idx) (enc.rows[i].includes(best) ? right : left).push(i);
  return { f: best, l: grow(enc, left, g, h, depth + 1, o), r: grow(enc, right, g, h, depth + 1, o) };
}

function walk(node: TNode, mask: Uint8Array): number {
  let n = node;
  while (!("v" in n)) n = mask[n.f] ? n.r : n.l;
  return n.v;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));

const classG = (enc: Encoded) => ({ g: Float64Array.from(enc.y, (y) => -y), h: new Float64Array(enc.y.length).fill(1) });

const decisionTree: Trainer = (enc, train, rand) => {
  const { g, h } = classG(enc);
  const tree = grow(enc, train, g, h, 0, { maxDepth: 6, minLeaf: 40, lambda: 1, mtry: enc.f, rand });
  return (_, mask) => walk(tree, mask);
};

const randomForest: Trainer = (enc, train, rand) => {
  const { g, h } = classG(enc);
  const trees: TNode[] = [];
  for (let t = 0; t < 60; t++) {
    const boot = Array.from({ length: train.length }, () => train[Math.floor(rand() * train.length)]);
    trees.push(grow(enc, boot, g, h, 0, { maxDepth: 10, minLeaf: 8, lambda: 1, mtry: Math.max(8, Math.round(enc.f / 3)), rand }));
  }
  return (_, mask) => trees.reduce((s, t) => s + walk(t, mask), 0) / trees.length;
};

const gradientBoosting: Trainer = (enc, train, rand) => {
  const base = train.reduce((s, i) => s + enc.y[i], 0) / train.length;
  const f0 = Math.log(base / (1 - base));
  const F = new Float64Array(enc.y.length).fill(f0);
  const masks = new Map(train.map((i) => [i, maskOf(enc.rows[i], enc.f)]));
  const g = new Float64Array(enc.y.length);
  const h = new Float64Array(enc.y.length);
  const trees: TNode[] = [];
  const lr = 0.08;
  for (let round = 0; round < 160; round++) {
    for (const i of train) {
      const p = sigmoid(F[i]);
      g[i] = p - enc.y[i];
      h[i] = Math.max(p * (1 - p), 1e-6);
    }
    const sample = train.filter(() => rand() < 0.8);
    const tree = grow(enc, sample, g, h, 0, { maxDepth: 3, minLeaf: 25, lambda: 2, mtry: enc.f, rand });
    trees.push(tree);
    for (const i of train) F[i] += lr * walk(tree, masks.get(i)!);
  }
  return (_, mask) => sigmoid(f0 + lr * trees.reduce((s, t) => s + walk(t, mask), 0));
};

const logistic: Trainer = (enc, train) => {
  const model = fitLogit(train.map((i) => ({ x: new Map(enc.rows[i].map((j) => [j, 1])), y: enc.y[i] as 0 | 1 })), enc.f, { l2: 4 });
  return (list) => predict(model, new Map(list.map((j) => [j, 1])));
};

/** Bernoulli naive Bayes: assumes each fact about a demo is independent. Fast, simple, often over-confident. */
const naiveBayes: Trainer = (enc, train) => {
  const pos = new Float64Array(enc.f);
  const neg = new Float64Array(enc.f);
  let np = 0;
  for (const i of train) {
    if (enc.y[i]) np++;
    for (const j of enc.rows[i]) (enc.y[i] ? pos : neg)[j]++;
  }
  const nn = train.length - np;
  const w = new Float64Array(enc.f);
  let bias = Math.log(np / nn);
  for (let j = 0; j < enc.f; j++) {
    const tp = (pos[j] + 1) / (np + 2);
    const tn = (neg[j] + 1) / (nn + 2);
    bias += Math.log(1 - tp) - Math.log(1 - tn);
    w[j] = Math.log(tp) - Math.log(1 - tp) - (Math.log(tn) - Math.log(1 - tn));
  }
  return (list) => sigmoid(bias + list.reduce((s, j) => s + w[j], 0));
};

const everyone: Trainer = (enc, train) => {
  const base = train.reduce((s, i) => s + enc.y[i], 0) / train.length;
  return () => base;
};

const MODELS: { id: string; name: string; kind: string; about: string; train: Trainer }[] = [
  { id: "gbm", name: "Gradient boosting", kind: "160 small trees, each fixing the last one's mistakes", about: "Usually the strongest on table data like this.", train: gradientBoosting },
  { id: "rf", name: "Random forest", kind: "60 deep trees on random samples, averaged", about: "Robust, hard to over-tune.", train: randomForest },
  { id: "logit", name: "Logistic regression", kind: "One weight per fact, added up", about: "Easy to explain: its weights are the 'what moves the odds' chart.", train: logistic },
  { id: "tree", name: "Decision tree", kind: "One tree, 6 questions deep", about: "Readable as a flowchart, but coarse.", train: decisionTree },
  { id: "nb", name: "Naive Bayes", kind: "Treats every fact as independent", about: "A fast classic; good at ranking, poor at probabilities.", train: naiveBayes },
  { id: "base", name: "Guess everyone buys", kind: "No model", about: "The floor any model must beat.", train: everyone },
];

// ── Scoring ───────────────────────────────────────────────────────────────────────────────────

function metricsAt(scored: { p: number; y: number }[], t: number): Metrics {
  let tp = 0, fp = 0, fn = 0, tn = 0, brier = 0;
  for (const s of scored) {
    const yes = s.p >= t;
    if (yes && s.y) tp++; else if (yes) fp++; else if (s.y) fn++; else tn++;
    brier += (s.p - s.y) ** 2;
  }
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  return {
    precision, recall,
    f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    accuracy: (tp + tn) / Math.max(1, scored.length),
    auc: auc(scored.map((s) => ({ p: s.p, y: s.y as 0 | 1 }))),
    brier: brier / Math.max(1, scored.length),
  };
}

/** The cut-off that gives the best F1 on data the model did not train on. */
function bestThreshold(scored: { p: number; y: number }[]): number {
  const ps = [...new Set(scored.map((s) => s.p))].sort((a, b) => a - b);
  if (ps.length === 1) return ps[0];
  let best = ps[0];
  let bestF1 = -1;
  const step = Math.max(1, Math.floor(ps.length / 200));
  for (let k = 0; k < ps.length; k += step) {
    const f1 = metricsAt(scored, ps[k]).f1;
    if (f1 > bestF1) { bestF1 = f1; best = ps[k]; }
  }
  return best;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sd = (xs: number[]) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)));

export function runModelLab(items: Item[], k = 5): ModelLab {
  const enc = encode(items);
  const masks = enc.rows.map((r) => maskOf(r, enc.f));
  const fold = items.map((it) => Math.min(k - 1, Math.floor(hashUnit(it.id) * k)));
  const inVal = items.map((it) => hashUnit(`${it.id}#val`) < 0.2);

  const perModel = new Map<string, { f1: number[]; auc: number[]; holdout?: Metrics & { threshold: number }; scored?: { p: number; y: number; i: number }[]; predictor?: Predictor }>();
  for (const m of MODELS) perModel.set(m.id, { f1: [], auc: [] });

  for (let f = 0; f < k; f++) {
    const test = items.map((_, i) => i).filter((i) => fold[i] === f);
    const train = items.map((_, i) => i).filter((i) => fold[i] !== f);
    const fit = train.filter((i) => !inVal[i]);
    const val = train.filter((i) => inVal[i]);
    for (const m of MODELS) {
      const predictor = m.train(enc, fit, rng(17 + f));
      const t = bestThreshold(val.map((i) => ({ p: predictor(enc.rows[i], masks[i]), y: enc.y[i] })));
      const scored = test.map((i) => ({ p: predictor(enc.rows[i], masks[i]), y: enc.y[i], i }));
      const met = metricsAt(scored, t);
      const rec = perModel.get(m.id)!;
      rec.f1.push(met.f1);
      rec.auc.push(met.auc);
      if (f === 0) { rec.holdout = { ...met, threshold: t }; rec.scored = scored; rec.predictor = predictor; }
    }
  }

  const testCount = fold.filter((f) => f === 0).length;
  const results: ModelResult[] = MODELS.map((m) => {
    const r = perModel.get(m.id)!;
    return { id: m.id, name: m.name, kind: m.kind, about: m.about, n: testCount, holdout: r.holdout!, cv: { f1: mean(r.f1), f1Sd: sd(r.f1), auc: mean(r.auc), aucSd: sd(r.auc) } };
  });

  // The AI hot-lead flag the call platform already gives, scored the same way where it exists.
  const flagged = items.map((it, i) => ({ it, i })).filter(({ it }) => it.aiHot != null);
  const flagFolds = Array.from({ length: k }, (_, f) => flagged.filter(({ i }) => fold[i] === f).map(({ it }) => ({ p: it.aiHot ? 1 : 0, y: it.y })));
  const flagF1 = flagFolds.map((s) => metricsAt(s, 1).f1);
  const flagAuc = flagFolds.map((s) => metricsAt(s, 1).auc);
  if (flagFolds[0].length) results.push({
    id: "aiflag", name: "AI 'hot lead' flag", kind: "Today's flag from the call platform", about: `Only demos with a recorded, scored call (${flagFolds[0].length} in the test set).`, n: flagFolds[0].length,
    holdout: { ...metricsAt(flagFolds[0], 1), threshold: 1 }, cv: { f1: mean(flagF1), f1Sd: sd(flagF1), auc: mean(flagAuc), aucSd: sd(flagAuc) },
  });

  const trained = results.filter((r) => r.id !== "base" && r.id !== "aiflag");
  const best = [...trained].sort((a, b) => b.cv.f1 - a.cv.f1 || b.cv.auc - a.cv.auc)[0].id;
  const bestRec = perModel.get(best)!;
  const scored = bestRec.scored!;

  const roc = MODELS.filter((m) => m.id !== "base").map((m) => {
    const s = [...perModel.get(m.id)!.scored!].sort((a, b) => b.p - a.p);
    const P = s.filter((x) => x.y).length;
    const N = s.length - P;
    const points: [number, number][] = [[0, 0]];
    let tp = 0, fp = 0;
    s.forEach((x, i) => {
      if (x.y) tp++; else fp++;
      if (i % Math.max(1, Math.floor(s.length / 60)) === 0) points.push([+(fp / N).toFixed(4), +(tp / P).toFixed(4)]);
    });
    points.push([1, 1]);
    return { id: m.id, points };
  });

  const t = bestRec.holdout!.threshold;
  const confusion = { tp: 0, fp: 0, fn: 0, tn: 0, threshold: t };
  for (const s of scored) {
    const yes = s.p >= t;
    if (yes && s.y) confusion.tp++; else if (yes) confusion.fp++; else if (s.y) confusion.fn++; else confusion.tn++;
  }

  const ranked = [...scored].sort((a, b) => b.p - a.p);
  const tenth = (d: number) => ranked.slice(Math.floor((d * ranked.length) / 10), Math.floor(((d + 1) * ranked.length) / 10));
  const deciles = Array.from({ length: 10 }, (_, d) => { const s = tenth(d); return { decile: d + 1, n: s.length, rate: mean(s.map((x) => x.y)) }; });
  const calibration = Array.from({ length: 10 }, (_, d) => { const s = tenth(9 - d); return { p: +mean(s.map((x) => x.p)).toFixed(4), actual: +mean(s.map((x) => x.y)).toFixed(4), n: s.length }; });
  const totalPos = ranked.filter((x) => x.y).length;
  const gains: [number, number][] = [[0, 0]];
  let found = 0;
  ranked.forEach((x, i) => {
    found += x.y;
    if ((i + 1) % Math.max(1, Math.floor(ranked.length / 40)) === 0 || i === ranked.length - 1) gains.push([+((i + 1) / ranked.length).toFixed(4), +(found / Math.max(1, totalPos)).toFixed(4)]);
  });

  // Permutation importance: shuffle one fact across the test demos and see how much ranking quality (AUC) drops.
  const baseAuc = bestRec.holdout!.auc;
  const predictor = bestRec.predictor!;
  const testIdx = scored.map((s) => s.i);
  const importance = enc.groups.map((group, gi) => {
    const drops = [1, 2].map((rep) => {
      const r = rng(100 + gi * 7 + rep);
      const perm = [...testIdx].sort(() => r() - 0.5);
      const s = testIdx.map((i, k2) => {
        const list = [...enc.rows[i]];
        list[gi] = enc.rows[perm[k2]][gi];
        return { p: predictor(list, maskOf(list, enc.f)), y: enc.y[i] as 0 | 1 };
      });
      return baseAuc - auc(s);
    });
    return { group, drop: +mean(drops).toFixed(4) };
  }).sort((a, b) => b.drop - a.drop);

  return {
    folds: k,
    train: items.length - testCount,
    test: testCount,
    positiveRate: mean(items.map((i) => i.y)),
    best,
    results,
    roc,
    confusion,
    calibration,
    gains,
    deciles,
    importance,
  };
}

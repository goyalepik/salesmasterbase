// Small, dependency-free statistics for the insights report: rates with honest error bars,
// shrinkage for small samples, and a regularised logistic regression with a hold-out AUC.

/** 95% Wilson interval for k successes out of n. Stays sensible for small n and rates near 0 or 1. */
export function wilson(k: number, n: number, z = 1.96): { lo: number; hi: number } {
  if (n === 0) return { lo: 0, hi: 0 };
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

/**
 * Empirical-Bayes rate: pulls small samples toward the overall rate.
 * A CDE with 2 wins from 3 demos is not a 67% closer; with `strength` 40 they read close to the average until volume proves otherwise.
 */
export function shrunkRate(k: number, n: number, prior: number, strength = 40): number {
  return (k + prior * strength) / (n + strength);
}

/** Deterministic 0..1 from a string, so the train / test split is the same on every run. */
export function hashUnit(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

export type Sample = { x: Map<number, number>; y: 0 | 1 };

export type LogitModel = { weights: Float64Array; bias: number };

const sigmoid = (z: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));

export function predict(model: LogitModel, x: Map<number, number>): number {
  let z = model.bias;
  for (const [i, v] of x) z += model.weights[i] * v;
  return sigmoid(z);
}

/** L2-regularised logistic regression on sparse features, fitted by full-batch gradient descent with Adam. */
export function fitLogit(samples: Sample[], features: number, { l2 = 1, epochs = 400, rate = 0.08 } = {}): LogitModel {
  const w = new Float64Array(features);
  const m = new Float64Array(features + 1);
  const v = new Float64Array(features + 1);
  const n = samples.length;
  const base = samples.reduce((s, x) => s + x.y, 0) / Math.max(1, n);
  let bias = Math.log(Math.max(1e-6, base) / Math.max(1e-6, 1 - base));
  const g = new Float64Array(features + 1);
  for (let epoch = 1; epoch <= epochs; epoch++) {
    g.fill(0);
    for (const s of samples) {
      let z = bias;
      for (const [i, val] of s.x) z += w[i] * val;
      const err = sigmoid(z) - s.y;
      for (const [i, val] of s.x) g[i] += err * val;
      g[features] += err;
    }
    for (let i = 0; i <= features; i++) {
      const grad = g[i] / n + (i < features ? (l2 * w[i]) / n : 0);
      m[i] = 0.9 * m[i] + 0.1 * grad;
      v[i] = 0.999 * v[i] + 0.001 * grad * grad;
      const step = (rate * (m[i] / (1 - 0.9 ** epoch))) / (Math.sqrt(v[i] / (1 - 0.999 ** epoch)) + 1e-8);
      if (i < features) w[i] -= step;
      else bias -= step;
    }
  }
  return { weights: w, bias };
}

/** Area under the ROC curve: the chance a random win scores above a random loss. 0.5 is a coin toss. */
export function auc(scored: { p: number; y: 0 | 1 }[]): number {
  const sorted = [...scored].sort((a, b) => a.p - b.p);
  let pos = 0;
  let neg = 0;
  let rankSum = 0;
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j < sorted.length && sorted[j].p === sorted[i].p) j++;
    const avgRank = (i + j + 1) / 2;
    for (let k = i; k < j; k++) if (sorted[k].y) { rankSum += avgRank; pos++; } else neg++;
    i = j;
  }
  if (!pos || !neg) return 0.5;
  return (rankSum - (pos * (pos + 1)) / 2) / (pos * neg);
}

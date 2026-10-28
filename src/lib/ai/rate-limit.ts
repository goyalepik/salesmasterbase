const hits = new Map<string, number[]>();

export function allowAsk(key: string, now = Date.now(), limit = 12, windowMs = 60_000): boolean {
  const recent = (hits.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

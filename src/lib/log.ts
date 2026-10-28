type Level = "info" | "error";

const REDACTED = new Set(["text", "token", "signingSecret", "serviceRoleKey", "authorization", "rawBody"]);

export function log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (REDACTED.has(key)) continue;
    safe[key] = value;
  }
  const line = JSON.stringify({ level, event, ts: new Date().toISOString(), ...safe });
  if (level === "error") console.error(line);
  else console.log(line);
}

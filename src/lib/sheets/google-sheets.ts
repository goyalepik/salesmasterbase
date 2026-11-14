import "server-only";

import { createSign } from "node:crypto";
import type { SheetsClient } from "./sales-sheet";

// Google Sheets with a service account (a robot Google user the sheet is shared with as Editor). The key is the
// JSON file Google gives you, pasted whole into GOOGLE_SERVICE_ACCOUNT_JSON (or base64 of it). Never logged.

type Credentials = { email: string; key: string };

export function credentialsFromEnv(env: Record<string, string | undefined> = process.env): Credentials | null {
  const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const text = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const json = JSON.parse(text) as { client_email?: string; private_key?: string };
    const key = json.private_key?.replace(/\\n/g, "\n");
    return json.client_email && key?.includes("PRIVATE KEY") ? { email: json.client_email, key } : null;
  } catch {
    return null;
  }
}

/** The robot's email address, to share the sheet with (safe to show: it is not a secret). */
export function serviceAccountEmail(env: Record<string, string | undefined> = process.env): string | null {
  return credentialsFromEnv(env)?.email ?? null;
}

let cached: { token: string; until: number; email: string } | null = null;

async function accessToken(creds: Credentials): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.email === creds.email && cached.until > now + 60) return cached.token;
  const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const body = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: creds.email, scope: "https://www.googleapis.com/auth/spreadsheets", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const signature = createSign("RSA-SHA256").update(body).sign(creds.key).toString("base64url");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${body}.${signature}` }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!response.ok || !json.access_token) throw new Error(`Google sign-in failed: ${json.error_description ?? response.status}`);
  cached = { token: json.access_token, until: now + (json.expires_in ?? 3600), email: creds.email };
  return json.access_token;
}

function explain(status: number, message: string): string {
  if (status === 403) return "The sheet is not shared with the app's Google robot yet (Share it as Editor).";
  if (status === 404) return "The sheet was not found. Check SALES_SHEET_ID.";
  if (status === 400 && /Unable to parse range/i.test(message)) return "The sheet tab was not found. Check SALES_SHEET_TAB.";
  return `Google Sheets answered ${status}: ${message.slice(0, 160)}`;
}

/** A Sheets client for one spreadsheet. */
export function googleSheetsClient(creds: Credentials, spreadsheetId: string): SheetsClient & { firstTab(): Promise<string> } {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`;
  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${await accessToken(creds)}`, "content-type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!response.ok) throw new Error(explain(response.status, json.error?.message ?? ""));
    return json;
  }
  return {
    async firstTab() {
      const meta = await call<{ sheets?: Array<{ properties?: { title?: string; index?: number } }> }>("?fields=sheets.properties(title,index)");
      const first = (meta.sheets ?? []).map((s) => s.properties).sort((a, b) => (a?.index ?? 0) - (b?.index ?? 0))[0];
      if (!first?.title) throw new Error("The sheet has no tabs.");
      return first.title;
    },
    async batchGet(ranges) {
      const qs = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join("&");
      const json = await call<{ valueRanges?: Array<{ values?: string[][] }> }>(`/values:batchGet?${qs}&majorDimension=ROWS`);
      return ranges.map((_, i) => json.valueRanges?.[i]?.values ?? []);
    },
    async batchUpdate(data) {
      if (!data.length) return;
      await call("/values:batchUpdate", { method: "POST", body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }) });
    },
    async append(range, rows) {
      if (!rows.length) return;
      await call(`/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { method: "POST", body: JSON.stringify({ values: rows }) });
    },
  };
}

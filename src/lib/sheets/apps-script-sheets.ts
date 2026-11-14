import "server-only";

import type { SheetsClient } from "./sales-sheet";

// The sales sheet through a small Apps Script inside the sheet (docs/sales-sheet-apps-script.gs), deployed as a
// web app that runs as the sheet owner. No Google Cloud project and no key file. The web app link
// (SALES_SHEET_SCRIPT_URL) is the secret: never logged or shown.

export function scriptUrlFromEnv(env: Record<string, string | undefined> = process.env): string | null {
  const url = env.SALES_SHEET_SCRIPT_URL?.trim() ?? "";
  return /^https:\/\/script\.google\.com\/(a\/[\w.-]+\/)?macros\/s\/[\w-]{20,}\/exec$/.test(url) ? url : null;
}

export function appsScriptClient(url: string): SheetsClient & { info(): Promise<{ tab: string; url: string }> } {
  async function call<T>(op: string, body: Record<string, unknown> = {}): Promise<T> {
    // Apps Script answers a POST with a redirect to the result; fetch follows it.
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ op, ...body }),
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    let json: { ok?: boolean; result?: T; error?: string };
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(
        /accounts\.google\.com|ServiceLogin/i.test(text)
          ? "The sheet script asks for a sign-in. Redeploy it with Who has access: Anyone."
          : `The sheet script did not answer properly (${response.status}). Check SALES_SHEET_SCRIPT_URL.`,
      );
    }
    if (!json.ok) throw new Error(`The sheet said: ${(json.error ?? "unknown error").slice(0, 160)}`);
    return json.result as T;
  }
  return {
    info: () => call<{ tab: string; url: string }>("info"),
    batchGet: async (ranges) => (await call<{ values: string[][][] }>("batchGet", { ranges })).values,
    batchUpdate: async (data) => {
      if (data.length) await call("batchUpdate", { data });
    },
    append: async (range, rows) => {
      if (rows.length) await call("append", { range, rows });
    },
  };
}

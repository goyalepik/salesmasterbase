// The only door to Shopify. It can read, create draft orders and complete them. Nothing else:
// any other change to the store is refused here, before a request is sent.

export type ShopifyAuth =
  /** Apps made in the Dev Dashboard (2026 onward): a fresh 24-hour token is fetched with the client ID and secret. */
  | { kind: "client"; clientId: string; clientSecret: string }
  /** Legacy custom apps made in the admin before 2026: a fixed Admin API access token. */
  | { kind: "token"; token: string };

/** What a CDE's Slack sale becomes in Shopify: a real order (payment pending), a draft to complete by hand, or nothing. */
export type SlackSalesMode = "order" | "draft" | "off";

export type ShopifyConfig = {
  /** e.g. main-homified.myshopify.com */
  domain: string;
  auth: ShopifyAuth;
  apiVersion: string;
  /** SHOPIFY_PAYMENT_SYNC=on: the payment status of orders EPIK made goes to Shopify. Off unless set. */
  paymentSync?: boolean;
  /** SHOPIFY_SLACK_SALES. Falls back to SHOPIFY_AUTO_DRAFTS=true → "draft" for older settings. */
  slackSales: SlackSalesMode;
  /** Bring website orders created on or after this date (YYYY-MM-DD) into the dashboard. Null: off. */
  importFrom: string | null;
};

export function shopifyConfigFromEnv(env: Record<string, string | undefined> = process.env): ShopifyConfig | null {
  const raw = env.SHOPIFY_STORE_DOMAIN?.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!raw) return null;
  // Accept the store handle from the admin URL (admin.shopify.com/store/<handle>) as well as the full domain.
  const domain = raw.includes(".") ? raw : `${raw}.myshopify.com`;
  const clientId = env.SHOPIFY_CLIENT_ID?.trim();
  const clientSecret = env.SHOPIFY_CLIENT_SECRET?.trim();
  const token = env.SHOPIFY_ADMIN_TOKEN?.trim();
  const auth: ShopifyAuth | null = clientId && clientSecret ? { kind: "client", clientId, clientSecret } : token ? { kind: "token", token } : null;
  if (!auth) return null;
  const importFrom = env.SHOPIFY_IMPORT_FROM?.trim() ?? "";
  const mode = env.SHOPIFY_SLACK_SALES?.trim().toLowerCase();
  const slackSales: SlackSalesMode = mode === "order" || mode === "draft" || mode === "off" ? mode : env.SHOPIFY_AUTO_DRAFTS === "true" ? "draft" : "off";
  return {
    domain,
    auth,
    apiVersion: env.SHOPIFY_API_VERSION?.trim() || "2026-10",
    slackSales,
    importFrom: /^\d{4}-\d{2}-\d{2}$/.test(importFrom) ? importFrom : null,
    paymentSync: env.SHOPIFY_PAYMENT_SYNC?.trim().toLowerCase() === "on",
  };
}

/** Link to a page in the Shopify admin, e.g. adminUrl(domain, "draft_orders/123"). */
export function adminUrl(domain: string, path: string): string {
  return `https://admin.shopify.com/store/${domain.replace(/\.myshopify\.com$/, "")}/${path}`;
}

export class ShopifyError extends Error {}

export type Graphql = <T>(query: string, variables?: Record<string, unknown>) => Promise<T>;

// Creating a draft, and completing a draft the app just made into an order with payment pending.
// Writes: making and completing draft orders, and (SHOPIFY_PAYMENT_SYNC=on) payment status on orders EPIK made.
// orderCreate and orderCreateManualPayment: the #PIK order with the payment the CDE declared (needs write_orders).
const ALLOWED_MUTATIONS = ["draftOrderCreate", "draftOrderComplete", "draftOrderDelete", "orderCreate", "orderCreateManualPayment", "orderMarkAsPaid", "tagsAdd", "tagsRemove"];

// Tokens from the client credentials grant last about 24 hours; keep one per store and renew a minute early.
const tokens = new Map<string, { token: string; expiresAt: number }>();

async function accessToken(cfg: ShopifyConfig, fetchImpl: typeof fetch, now: () => number): Promise<string> {
  if (cfg.auth.kind === "token") return cfg.auth.token;
  const cached = tokens.get(cfg.domain);
  if (cached && cached.expiresAt > now()) return cached.token;
  const res = await fetchImpl(`https://${cfg.domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: cfg.auth.clientId, client_secret: cfg.auth.clientSecret }).toString(),
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    if (/shop_not_permitted/.test(detail)) throw new ShopifyError("Shopify refused: the app and the store must be in the same Shopify organization.");
    throw new ShopifyError(`Shopify refused the client ID and secret (${res.status}). Check them and that the app is installed on the store.`);
  }
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new ShopifyError("Shopify did not return an access token.");
  tokens.set(cfg.domain, { token: body.access_token, expiresAt: now() + Math.max(60, (body.expires_in ?? 86_399) - 60) * 1000 });
  return body.access_token;
}

export function shopifyGraphql(cfg: ShopifyConfig, fetchImpl: typeof fetch = fetch, now: () => number = Date.now): Graphql {
  return async <T>(query: string, variables: Record<string, unknown> = {}): Promise<T> => {
    if (/\bmutation\b/.test(query) && !ALLOWED_MUTATIONS.some((m) => query.includes(m))) {
      throw new ShopifyError("Only reading, draft orders and payment status are allowed.");
    }
    const send = async () => fetchImpl(`https://${cfg.domain}/admin/api/${cfg.apiVersion}/graphql.json`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-shopify-access-token": await accessToken(cfg, fetchImpl, now) },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    });
    let res = await send();
    if (res.status === 401 && cfg.auth.kind === "client") {
      // The token may have been revoked early: fetch a fresh one and try once more.
      tokens.delete(cfg.domain);
      res = await send();
    }
    if (res.status === 401 || res.status === 403) throw new ShopifyError("Shopify refused access. Check the app's permissions (read_orders, write_orders, read_products, write_draft_orders, write_payment_terms) and that it is installed.");
    if (!res.ok) throw new ShopifyError(`Shopify answered ${res.status}.`);
    const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (body.errors?.length) throw new ShopifyError(`Shopify: ${body.errors.map((e) => e.message).join("; ").slice(0, 300)}`);
    if (!body.data) throw new ShopifyError("Shopify sent an empty answer.");
    return body.data;
  };
}

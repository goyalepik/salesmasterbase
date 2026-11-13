// Server code only (reads the key from the environment); no browser file imports this.
import { guardRequest, SagepilotError } from "./guard";

export { guardRequest, POST_READ_ALLOWLIST, SagepilotError } from "./guard";

// Read-only Sagepilot client (v5 section 1.1). Server-side only: the key never reaches the browser.
// Sagepilot is never written to: no create, update, assign, tag, reply, close or delete, and no webhook subscriptions.
// Every request goes through guardRequest(): GET is allowed; POST only for the read endpoints below, which take their
// filters in a POST body. Anything else throws before a request is made. Create the key with read scopes only
// (tickets:read, customers:read) for a second lock.

type ReadPath = "/platform-api/v1/chats/list" | "/platform-api/v1/messages/list" | "/platform-api/v1/customers/recent_calls";

export type SagepilotConfig = { token: string; baseUrl: string; workspaceId: string | null };

export function sagepilotConfig(env: Record<string, string | undefined> = process.env): SagepilotConfig | null {
  if (env.CX_SAGEPILOT_ENABLED !== "true") return null;
  const token = env.SAGEPILOT_API_TOKEN?.trim();
  if (!token) return null;
  const baseUrl = (env.SAGEPILOT_BASE_URL?.trim() || "https://app.sagepilot.ai").replace(/\/+$/, "");
  return { token, baseUrl, workspaceId: env.SAGEPILOT_WORKSPACE_ID?.trim() || null };
}

async function post<T>(config: SagepilotConfig, path: ReadPath, body: Record<string, unknown>, fetcher: typeof fetch): Promise<T> {
  guardRequest("POST", path);
  const headers: Record<string, string> = { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json", Accept: "application/json" };
  if (config.workspaceId) headers["X-Workspace-Id"] = config.workspaceId;
  const response = await fetcher(`${config.baseUrl}${path}`, { method: "POST", headers, body: JSON.stringify(body), cache: "no-store" });
  if (!response.ok) {
    const hint =
      response.status === 401 ? "The Sagepilot key was refused. Check SAGEPILOT_API_TOKEN." :
      response.status === 403 ? "The Sagepilot key is missing a scope or dataset grant (needs tickets:read, with tickets and messages datasets)." :
      response.status === 429 ? "Sagepilot rate limit hit. Try again in a minute." :
      `Sagepilot answered ${response.status}.`;
    throw new SagepilotError(hint, response.status);
  }
  return (await response.json()) as T;
}

export type SpChat = {
  id: string;
  code: string | null;
  status: string | null;
  sub_status: string | null;
  priority: string | null;
  created_at: string;
  updated_at?: string | null;
  last_message_created_at?: string | null;
  closed_at: string | null;
  chat_escalated_at: string | null;
  first_agent_response_at: string | null;
  assignee_type: string | null;
  subject: string | null;
  summary: string | null;
  is_spam: boolean | null;
  user_csat_score: number | null;
  inferred_csat_score: number | null;
  team_name?: string | null;
  agent_profile?: { name?: string | null } | null;
  has_outbound_human_reply_after_last_user?: boolean | null;
  chat_tags: unknown[] | null;
  chat_custom_fields?: unknown[] | null;
  customers: { id: string; name: string | null; email: string | null; phone: string | null; instagram_username: string | null } | null;
  channels: { kind: string | null; name: string | null } | null;
  messages: { content: string | null; role: string | null; created_at: string } | null;
};

export type SpMessage = { id: string; role: string | null; content: string | null; created_at: string; type: string | null; chat_id: string };

type Page<T> = { records: T[]; cursor: string | null };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One read, retried with growing waits when Sagepilot says "too many requests" (429) or is briefly down (5xx). */
async function read<T>(config: SagepilotConfig, path: ReadPath, body: Record<string, unknown>, fetcher: typeof fetch, tries = 4): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await post<T>(config, path, body, fetcher);
    } catch (error) {
      const status = error instanceof SagepilotError ? error.status : 0;
      if (attempt + 1 >= tries || !(status === 429 || status >= 500)) throw error;
      await sleep(500 * 2 ** attempt);
    }
  }
}

/**
 * One page of tickets ordered by last activity (newest first): Sagepilot's last_message_created_at. A ticket created
 * weeks ago that got a new message today is on the first page. `range` is one of Sagepilot's presets.
 */
export async function listChatsByActivity(config: SagepilotConfig, opts: { range: string; cursor?: string | null; pageSize?: number }, fetcher: typeof fetch = fetch): Promise<Page<SpChat>> {
  return read<Page<SpChat>>(config, "/platform-api/v1/chats/list", {
    page_size: opts.pageSize ?? 100,
    include_total: false,
    status: "all",
    date_range: opts.range,
    date_filter_field: "last_message_created_at",
    sort_by_field: "last_message_created_at",
    sort_order: "desc",
    ...(opts.cursor ? { cursor: opts.cursor } : {}),
  }, fetcher);
}

/** Every message of one ticket, oldest first, following the cursor (at most `maxPages` pages of 100). */
export async function listAllMessages(config: SagepilotConfig, chatId: string, fetcher: typeof fetch = fetch, maxPages = 20): Promise<SpMessage[]> {
  const out: SpMessage[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const res: Page<SpMessage> = await read<Page<SpMessage>>(config, "/platform-api/v1/messages/list", { chat_id: chatId, page_size: 100, ...(cursor ? { cursor } : {}) }, fetcher);
    out.push(...(res.records ?? []));
    cursor = res.cursor ?? null;
    if (!cursor) break;
  }
  return out.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Kept for the old import path and tests: the first messages of one ticket, oldest first. */
export async function listMessages(config: SagepilotConfig, chatId: string, fetcher: typeof fetch = fetch): Promise<SpMessage[]> {
  return listAllMessages(config, chatId, fetcher, 1);
}

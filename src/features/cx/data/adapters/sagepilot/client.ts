import "server-only";

// Read-only Sagepilot client. Server-side only: the key never reaches the browser.
// Only the three listing paths below can be called, so nothing in Sagepilot can be changed from here.
// Create the key with read scopes only (tickets:read, customers:read) for a second lock.

const READ_PATHS = ["/platform-api/v1/chats/list", "/platform-api/v1/messages/list", "/platform-api/v1/customers/recent_calls"] as const;
type ReadPath = (typeof READ_PATHS)[number];

export type SagepilotConfig = { token: string; baseUrl: string; workspaceId: string | null };

export class SagepilotError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function sagepilotConfig(env: Record<string, string | undefined> = process.env): SagepilotConfig | null {
  if (env.CX_SAGEPILOT_ENABLED !== "true") return null;
  const token = env.SAGEPILOT_API_TOKEN?.trim();
  if (!token) return null;
  const baseUrl = (env.SAGEPILOT_BASE_URL?.trim() || "https://app.sagepilot.ai").replace(/\/+$/, "");
  return { token, baseUrl, workspaceId: env.SAGEPILOT_WORKSPACE_ID?.trim() || null };
}

async function post<T>(config: SagepilotConfig, path: ReadPath, body: Record<string, unknown>, fetcher: typeof fetch): Promise<T> {
  if (!READ_PATHS.includes(path)) throw new SagepilotError("Only read endpoints are allowed.", 400);
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
  closed_at: string | null;
  chat_escalated_at: string | null;
  first_agent_response_at: string | null;
  assignee_type: string | null;
  subject: string | null;
  summary: string | null;
  is_spam: boolean | null;
  user_csat_score: number | null;
  inferred_csat_score: number | null;
  chat_tags: unknown[] | null;
  customers: { id: string; name: string | null; email: string | null; phone: string | null; instagram_username: string | null } | null;
  channels: { kind: string | null; name: string | null } | null;
  messages: { content: string | null; role: string | null; created_at: string } | null;
};

export type SpMessage = { id: string; role: string | null; content: string | null; created_at: string; type: string | null; chat_id: string };

type Page<T> = { records: T[]; cursor: string | null };

/** Tickets created in a date range, newest first, following the cursor up to `max`. */
export async function listChats(config: SagepilotConfig, opts: { dateRange: string; max: number }, fetcher: typeof fetch = fetch): Promise<SpChat[]> {
  const out: SpChat[] = [];
  let cursor: string | null = null;
  do {
    const page: Page<SpChat> = await post<Page<SpChat>>(config, "/platform-api/v1/chats/list", {
      page_size: Math.min(100, opts.max - out.length),
      include_total: false,
      status: "all",
      date_range: opts.dateRange,
      date_filter_field: "created_at",
      sort_by_field: "created_at",
      sort_order: "desc",
      ...(cursor ? { cursor } : {}),
    }, fetcher);
    out.push(...(page.records ?? []));
    cursor = page.cursor ?? null;
  } while (cursor && out.length < opts.max);
  return out.slice(0, opts.max);
}

/** The first messages of one ticket, oldest first. Enough to read what the customer asked. */
export async function listMessages(config: SagepilotConfig, chatId: string, fetcher: typeof fetch = fetch): Promise<SpMessage[]> {
  const page = await post<Page<SpMessage>>(config, "/platform-api/v1/messages/list", { chat_id: chatId, page_size: 50 }, fetcher);
  return [...(page.records ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

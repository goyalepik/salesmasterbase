/** The few Slack Web API calls the operations flow needs. Tests pass a fake. */
export type SlackResult = { ok: boolean; error?: string; ts?: string; permalink?: string };
/** A message in a thread (conversations.replies). */
export type SlackThreadMessage = { ts: string; user?: string; bot_id?: string; text?: string };

export interface SlackClient {
  postMessage(args: { channel: string; text: string; blocks?: unknown[]; thread_ts?: string }): Promise<SlackResult>;
  update(args: { channel: string; ts: string; text: string; blocks: unknown[] }): Promise<SlackResult>;
  postEphemeral(args: { channel: string; user: string; text: string; thread_ts?: string }): Promise<SlackResult>;
  viewsOpen(args: { trigger_id: string; view: unknown }): Promise<SlackResult>;
  viewsUpdate?(args: { view_id: string; hash?: string; view: unknown }): Promise<SlackResult>;
  viewsPublish?(args: { user_id: string; view: unknown }): Promise<SlackResult>;
  deleteMessage?(args: { channel: string; ts: string }): Promise<SlackResult>;
  getPermalink(args: { channel: string; message_ts: string }): Promise<SlackResult>;
  /** The thread's messages, first message first (needs channels:history). */
  replies?(args: { channel: string; ts: string }): Promise<SlackResult & { messages?: SlackThreadMessage[] }>;
}

async function callJson(token: string, method: string, body: unknown): Promise<SlackResult> {
  try {
    const response = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    return (await response.json()) as SlackResult;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "request_failed" };
  }
}

async function callForm(token: string, method: string, params: Record<string, string>): Promise<SlackResult> {
  try {
    const response = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(8000),
    });
    return (await response.json()) as SlackResult;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "request_failed" };
  }
}

export function webSlackClient(token: string): SlackClient {
  return {
    postMessage: (args) => callJson(token, "chat.postMessage", { ...args, unfurl_links: false, unfurl_media: false }),
    update: (args) => callJson(token, "chat.update", args),
    postEphemeral: (args) => callJson(token, "chat.postEphemeral", args),
    viewsOpen: (args) => callJson(token, "views.open", args),
    viewsUpdate: (args) => callJson(token, "views.update", args),
    viewsPublish: (args) => callJson(token, "views.publish", args),
    deleteMessage: (args) => callJson(token, "chat.delete", args),
    // chat.getPermalink does not accept JSON bodies.
    getPermalink: (args) => callForm(token, "chat.getPermalink", args),
    replies: (args) => callForm(token, "conversations.replies", { channel: args.channel, ts: args.ts, limit: "50" }),
  };
}

const roots = new Map<string, string>();

/**
 * The thread to post an order's notes in. A card that sits inside a salesperson's thread (sales the AI read) is a
 * reply itself, and Slack wants the first message's ts, not a reply's. Asks Slack once per card, then remembers.
 */
export async function threadRoot(slack: SlackClient, channel: string, ts: string): Promise<string> {
  const key = `${channel}:${ts}`;
  const known = roots.get(key);
  if (known) return known;
  if (!slack.replies) return ts;
  const thread = await slack.replies({ channel, ts }).catch(() => null);
  const first = thread?.ok ? thread.messages?.[0]?.ts : undefined;
  if (!first) return ts;
  if (roots.size > 2000) roots.clear();
  roots.set(key, first);
  return first;
}

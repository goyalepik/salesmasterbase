/** The few Slack Web API calls the operations flow needs. Tests pass a fake. */
export type SlackResult = { ok: boolean; error?: string; ts?: string; permalink?: string };

export interface SlackClient {
  postMessage(args: { channel: string; text: string; blocks?: unknown[]; thread_ts?: string }): Promise<SlackResult>;
  update(args: { channel: string; ts: string; text: string; blocks: unknown[] }): Promise<SlackResult>;
  postEphemeral(args: { channel: string; user: string; text: string; thread_ts?: string }): Promise<SlackResult>;
  viewsOpen(args: { trigger_id: string; view: unknown }): Promise<SlackResult>;
  getPermalink(args: { channel: string; message_ts: string }): Promise<SlackResult>;
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
    // chat.getPermalink does not accept JSON bodies.
    getPermalink: (args) => callForm(token, "chat.getPermalink", args),
  };
}

import { createClient } from "@supabase/supabase-js";
import { readEnv, liveRequirementsMet } from "../src/lib/env";
import { getLiveRepository } from "../src/lib/db/supabase-repository";
import { processStoredMessage } from "../src/lib/process-message";
import { slackDisplayName } from "../src/lib/slack/profiles";
import { slackPermalink } from "../src/lib/slack/schema";

type HistoryMessage = {
  ts?: string;
  text?: string;
  user?: string;
  subtype?: string;
  bot_id?: string;
  thread_ts?: string;
  reply_count?: number;
};

type HistoryPage = {
  ok: boolean;
  error?: string;
  messages?: HistoryMessage[];
  response_metadata?: { next_cursor?: string };
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function slackPage(token: string, method: string, params: Record<string, string>): Promise<HistoryPage> {
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
  if (response.status === 429) {
    const wait = Number(response.headers.get("retry-after") ?? "2");
    await sleep((Number.isFinite(wait) ? wait : 2) * 1000 + 500);
    return slackPage(token, method, params);
  }
  const body = (await response.json()) as HistoryPage;
  if (!body.ok) throw new Error(body.error || `${method} failed.`);
  return body;
}

async function history(token: string, channel: string, cursor?: string): Promise<HistoryPage> {
  return slackPage(token, "conversations.history", { channel, limit: "200", ...(cursor ? { cursor } : {}) });
}

async function replies(token: string, channel: string, ts: string): Promise<HistoryMessage[]> {
  const page = await slackPage(token, "conversations.replies", { channel, ts, limit: "200" });
  return (page.messages ?? []).filter((message) => message.ts && message.ts !== ts);
}

function log(value: unknown) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function main() {
  const env = readEnv();
  if (!liveRequirementsMet(env) || !env.slackBotToken || !env.slackChannelId) {
    console.error("Backfill needs APP_MODE=live, Supabase, the signing secret, the access code, SLACK_BOT_TOKEN, and SLACK_CHANNEL_ID.");
    process.exit(1);
  }
  const repo = getLiveRepository();
  const db = createClient(env.supabaseUrl!, env.serviceRoleKey!, { auth: { persistSession: false } });
  const refs: Array<{ id: string; ts: string; threadTs: string | null }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("slack_messages").select("id, slack_message_ts, thread_ts").range(from, from + 999);
    if (error) throw new Error("Could not list stored messages.");
    if (!data?.length) break;
    for (const row of data) refs.push({ id: row.id, ts: row.slack_message_ts, threadTs: row.thread_ts });
    if (data.length < 1000) break;
  }
  const knownTs = new Set(refs.map((row) => row.ts));
  const storedReplyCount = new Map<string, number>();
  for (const row of refs) {
    if (row.threadTs && row.threadTs !== row.ts) storedReplyCount.set(row.threadTs, (storedReplyCount.get(row.threadTs) ?? 0) + 1);
  }
  log({ storedAlready: refs.length });
  const probe = await fetch("https://slack.com/api/users.info", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.slackBotToken}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ user: "U00000000" }),
    signal: AbortSignal.timeout(15000),
  }).then((response) => response.json() as Promise<{ ok?: boolean; error?: string }>);
  const profilesAvailable = probe.error !== "missing_scope";
  log({ profiles: profilesAvailable ? "available" : "missing_scope" });
  const names = new Map<string, string | null>();
  async function senderName(userId: string | null): Promise<string | null> {
    if (!userId || !profilesAvailable) return null;
    if (!names.has(userId)) {
      const name = await slackDisplayName(env.slackBotToken!, userId).catch(() => null);
      names.set(userId, name);
      if (name) await repo.rememberSender(userId, name);
    }
    return names.get(userId) ?? null;
  }
  async function store(message: HistoryMessage, source: string, followReplies: boolean) {
    if (!message.ts) return;
    if (knownTs.has(message.ts)) {
      duplicates += 1;
    } else {
      const inserted = await repo.insertInbound({
        slackTeamId: null,
        slackChannelId: env.slackChannelId!,
        slackChannelName: env.slackChannelName,
        slackMessageTs: message.ts,
        slackEventId: null,
        senderId: message.user ?? null,
        senderName: await senderName(message.user ?? null),
        text: message.text ?? "",
        threadTs: message.thread_ts ?? null,
        permalink: slackPermalink(env.slackChannelId!, message.ts),
        subtype: message.subtype ?? null,
        botId: message.bot_id ?? null,
        eventReceivedAt: new Date(Number(message.ts.split(".")[0]) * 1000).toISOString(),
        sourceMetadata: { source, subtype: message.subtype ?? null },
      });
      if (!inserted.ok) throw new Error(inserted.error);
      if (inserted.duplicate) duplicates += 1;
      else stored += 1;
      knownTs.add(message.ts);
      refs.push({ id: inserted.message.id, ts: message.ts, threadTs: message.thread_ts ?? null });
      if (message.thread_ts && message.thread_ts !== message.ts) {
        storedReplyCount.set(message.thread_ts, (storedReplyCount.get(message.thread_ts) ?? 0) + 1);
      }
    }
    if (followReplies && (message.reply_count ?? 0) > (storedReplyCount.get(message.ts) ?? 0)) {
      const thread = await replies(env.slackBotToken!, env.slackChannelId!, message.ts);
      for (const reply of thread) await store(reply, "conversations.replies", false);
      storedReplyCount.set(message.ts, Math.max(storedReplyCount.get(message.ts) ?? 0, thread.length));
    }
  }
  let cursor: string | undefined;
  let stored = 0;
  let duplicates = 0;
  let pages = 0;
  do {
    const page = await history(env.slackBotToken, env.slackChannelId, cursor);
    pages += 1;
    for (const message of page.messages ?? []) await store(message, "conversations.history", true);
    log({ page: pages, stored, duplicates, known: knownTs.size });
    cursor = page.response_metadata?.next_cursor || undefined;
  } while (cursor);
  const parents = refs.filter((row) => !row.threadTs || row.threadTs === row.ts);
  const threadReplies = refs.filter((row) => row.threadTs && row.threadTs !== row.ts);
  let reprocessed = 0;
  for (const row of [...parents, ...threadReplies]) {
    const opened = await repo.reopen(row.id);
    if (!opened) continue;
    await processStoredMessage(repo, row.id, { monitoredChannelId: env.slackChannelId });
    reprocessed += 1;
    if (reprocessed % 25 === 0) log({ reprocessed });
  }
  log({ pages, stored, duplicates, reprocessed, names: [...names.values()].filter(Boolean).length });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Backfill failed.");
  process.exit(1);
});

import { readEnv, liveRequirementsMet } from "../src/lib/env";
import { getLiveRepository } from "../src/lib/db/supabase-repository";
import { processStoredMessage } from "../src/lib/process-message";
import { slackPermalink } from "../src/lib/slack/schema";

type HistoryMessage = {
  ts?: string;
  text?: string;
  user?: string;
  subtype?: string;
  bot_id?: string;
  thread_ts?: string;
};

type HistoryPage = {
  ok: boolean;
  error?: string;
  messages?: HistoryMessage[];
  response_metadata?: { next_cursor?: string };
};

async function history(token: string, channel: string, cursor?: string): Promise<HistoryPage> {
  const url = new URL("https://slack.com/api/conversations.history");
  url.searchParams.set("channel", channel);
  url.searchParams.set("limit", "200");
  if (cursor) url.searchParams.set("cursor", cursor);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = (await response.json()) as HistoryPage;
  if (!body.ok) throw new Error(body.error || "Slack history request failed.");
  return body;
}

async function main() {
  const env = readEnv();
  if (!liveRequirementsMet(env) || !env.slackBotToken || !env.slackChannelId) {
    console.error("Backfill needs APP_MODE=live, Supabase, the signing secret, the access code, SLACK_BOT_TOKEN, and SLACK_CHANNEL_ID.");
    process.exit(1);
  }
  const repo = getLiveRepository();
  let cursor: string | undefined;
  let stored = 0;
  let duplicates = 0;
  let pages = 0;
  do {
    const page = await history(env.slackBotToken, env.slackChannelId, cursor);
    pages += 1;
    for (const message of page.messages ?? []) {
      if (!message.ts) continue;
      const inserted = await repo.insertInbound({
        slackTeamId: null,
        slackChannelId: env.slackChannelId,
        slackChannelName: env.slackChannelName,
        slackMessageTs: message.ts,
        slackEventId: null,
        senderId: message.user ?? null,
        senderName: null,
        text: message.text ?? "",
        threadTs: message.thread_ts ?? null,
        permalink: slackPermalink(env.slackChannelId, message.ts),
        subtype: message.subtype ?? null,
        botId: message.bot_id ?? null,
        eventReceivedAt: new Date(Number(message.ts.split(".")[0]) * 1000).toISOString(),
        sourceMetadata: { source: "conversations.history", subtype: message.subtype ?? null },
      });
      if (!inserted.ok) throw new Error(inserted.error);
      const shouldProcess = !inserted.duplicate || inserted.message.processingStatus === "received" || inserted.message.processingStatus === "failed";
      if (inserted.duplicate) duplicates += 1;
      else stored += 1;
      if (shouldProcess) {
        await processStoredMessage(repo, inserted.message.id, { monitoredChannelId: env.slackChannelId });
      }
    }
    cursor = page.response_metadata?.next_cursor || undefined;
  } while (cursor);
  console.log(JSON.stringify({ pages, stored, duplicates }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Backfill failed.");
  process.exit(1);
});

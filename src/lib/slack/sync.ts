import "server-only";

import { chooseDataSource, readEnv } from "@/lib/env";
import { log } from "@/lib/log";
import type { OpsStore } from "@/lib/ops/store";
import type { OrderStage } from "@/lib/ops/types";
import { appBaseUrlFromEnv, pingTeam, refreshCard, teamChannelsFromEnv, type OpsDeps } from "@/lib/slack/ops-actions";
import { webSlackClient } from "@/lib/slack/slack-client";

function deps(store: OpsStore): OpsDeps | null {
  const env = readEnv();
  if (chooseDataSource(env) !== "live" || !env.slackBotToken) return null;
  return { store, slack: webSlackClient(env.slackBotToken), appBaseUrl: appBaseUrlFromEnv(process.env), teamChannels: teamChannelsFromEnv(process.env) };
}

/**
 * Keeps the order's Slack card in step after a change made outside Slack (dashboard, desk form).
 * Pings the next team when the stage moved. Never throws: Slack being down must not undo the change.
 */
export async function syncOrderToSlack(store: OpsStore, orderId: string, previous: OrderStage | null): Promise<void> {
  const wiring = deps(store);
  if (!wiring) return;
  try {
    const order = await refreshCard(wiring, orderId);
    if (order && order.stage !== previous) await pingTeam(wiring, order, previous);
  } catch (error) {
    log("error", "slack_sync_failed", { orderId, message: error instanceof Error ? error.message : "unknown" });
  }
}

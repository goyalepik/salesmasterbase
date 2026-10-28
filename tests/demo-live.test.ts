import assert from "node:assert/strict";
import test from "node:test";
import { buildDemoState } from "../src/lib/demo/dataset";
import { chooseDataSource, readEnv } from "../src/lib/env";
import { MemoryRepository } from "../src/lib/memory-repository";

const live = {
  APP_MODE: "live",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
  SLACK_SIGNING_SECRET: "signing-secret",
  DASHBOARD_ACCESS_CODE: "long-enough-code",
};

test("demo mode stays on demo data even if live credentials are present", () => {
  const choice = chooseDataSource(readEnv({ ...live, APP_MODE: "demo" }));
  assert.equal(choice, "demo");
  const demo = new MemoryRepository(buildDemoState(new Date("2026-10-28T15:00:00+05:30")));
  assert.equal(demo.snapshot().messages.every((message) => message.sourceMetadata.demo === true), true);
});

test("live mode without configuration does not select demo data", () => {
  assert.equal(chooseDataSource(readEnv({ APP_MODE: "live" })), "misconfigured");
  assert.equal(chooseDataSource(readEnv({ APP_MODE: "production" })), "misconfigured");
  assert.equal(chooseDataSource(readEnv(live)), "live");
});

test("demo and live stores are separate objects", async () => {
  const demo = new MemoryRepository(buildDemoState(new Date("2026-10-28T15:00:00+05:30")));
  const liveStore = new MemoryRepository({ messages: [], extractions: [], exceptions: [], attempts: [], audit: [], channels: [] });
  const before = demo.snapshot().messages.length;
  await liveStore.insertInbound({
    slackTeamId: "T",
    slackChannelId: "C",
    slackChannelName: null,
    slackMessageTs: "1",
    slackEventId: "E",
    senderId: null,
    senderName: null,
    text: "live only",
    threadTs: null,
    permalink: null,
    subtype: null,
    botId: null,
    eventReceivedAt: new Date().toISOString(),
    sourceMetadata: {},
  });
  assert.equal(demo.snapshot().messages.length, before);
  assert.equal(liveStore.snapshot().messages.length, 1);
  assert.equal(demo.snapshot().messages.some((message) => message.text === "live only"), false);
});

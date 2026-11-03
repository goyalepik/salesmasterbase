import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFromSagepilot } from "../src/features/cx/data/adapters/sagepilot/import";
import { channelOf, customerWords, mapChat } from "../src/features/cx/data/adapters/sagepilot/map";

const chat = (over: Record<string, unknown> = {}) => ({
  id: "9b7110ad-0000-0000-0000-000000000001",
  code: "1141",
  status: "open",
  created_at: "2026-11-03T04:00:00.000Z",
  closed_at: null,
  chat_escalated_at: null,
  first_agent_response_at: "2026-11-03T04:03:00.000Z",
  subject: null,
  summary: "Aliya confirmed the order. Customer says product arrived damaged.",
  is_spam: false,
  user_csat_score: null,
  inferred_csat_score: 2,
  customers: { name: "Sample Person", email: null, phone: "+91 90000 77777", instagram_username: null },
  channels: { kind: "whatsapp" },
  ...over,
});

test("channel kinds map to our channels", () => {
  assert.equal(channelOf("whatsapp"), "whatsapp");
  assert.equal(channelOf("instagram_dm"), "instagram");
  assert.equal(channelOf("facebook_messenger"), "facebook");
  assert.equal(channelOf("voice"), "call");
  assert.equal(channelOf("playground"), "web_chat");
});

test("the customer's own messages are used; the AI's replies are not", () => {
  const words = customerWords(chat(), [
    { role: "pilot", content: "Hi! How can I help?", type: "message", created_at: "1" },
    { role: "user", content: "paisa kat gaya but order nahi aaya", type: "message", created_at: "2" },
    { role: "system", content: "Chat assigned", type: "event", created_at: "3" },
  ]);
  assert.equal(words, "paisa kat gaya but order nahi aaya");
  assert.match(customerWords(chat(), []), /damaged/, "falls back to the Sagepilot summary");
});

test("spam is skipped and Instagram handles are kept", () => {
  assert.equal(mapChat(chat({ is_spam: true }), []), null);
  const ig = mapChat(chat({ channels: { kind: "instagram" }, customers: { name: "R", email: null, phone: null, instagram_username: "riya.decor" } }), [{ role: "user", content: "Is the Dreame L50 in stock?", type: "message", created_at: "1" }]);
  assert.equal(ig?.msg.handle, "@riya.decor");
  assert.equal(ig?.msg.phone, undefined);
});

test("imported tickets go through our classifier and keep Sagepilot's reply and close", async () => {
  const open = mapChat(chat(), [{ role: "user", content: "paisa kat gaya but order nahi aaya", type: "message", created_at: "1" }])!;
  const closed = mapChat(chat({ id: "x2", code: "1142", status: "closed", closed_at: "2026-11-03T05:00:00.000Z", customers: { name: "B", email: null, phone: "9000088888", instagram_username: null } }), [{ role: "user", content: "hi", type: "message", created_at: "1" }])!;
  const snap = await buildFromSagepilot([open, closed], new Date("2026-11-03T06:00:00.000Z"));
  const payment = snap.tickets.find((t) => t.customerUid === "+919000077777")!;
  assert.equal(payment.scenarioId, "D5");
  assert.equal(payment.priority, "P0");
  assert.equal(payment.firstResponseAt, "2026-11-03T04:03:00.000Z");
  assert.match(payment.explanation.join(" "), /Sagepilot ticket #1141/);
  assert.equal(snap.customers.find((c) => c.uid === "+919000077777")?.csat, 2);
  assert.equal(snap.tickets.find((t) => t.customerUid === "+919000088888")?.status, "closed");
});

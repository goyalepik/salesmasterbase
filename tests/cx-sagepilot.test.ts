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

test("WhatsApp customer messages (type text) are read", () => {
  assert.equal(customerWords(chat(), [
    { role: "pilot", content: "How can I help?", type: "ai_generated", created_at: "1" },
    { role: "user", content: "Where is my order PIK4123", type: "text", created_at: "2" },
  ]), "Where is my order PIK4123");
});

test("Facebook public comments: only the customer's comment is read, and a negative one is P0", async () => {
  const content = "<hr /><p>Channel Context<br /> Representing: Facebook Messenger</p><hr /><p>Post Details<br /> Caption: Still confused about which robot vacuum to buy? Damaged boxes never ship.</p> Type: Unknown<hr />Customer Comment on the Post<br /> Rubbish product, worst after sales support<hr />Public Reply Sent to the Comment<br /> We're sorry to hear that";
  const m = mapChat(chat({ channels: { kind: "facebook" } }), [{ role: "user", content, type: "text", created_at: "1" }])!;
  assert.equal(m.msg.text, "Rubbish product, worst after sales support");
  assert.equal(m.msg.publicComment, true);
  const snap = await buildFromSagepilot([m], new Date("2026-11-03T06:00:00.000Z"));
  assert.deepEqual([snap.tickets[0].scenarioId, snap.tickets[0].priority], ["I3", "P0"]);
  const happy = mapChat(chat({ id: "h", channels: { kind: "facebook" }, customers: { name: "H", email: null, phone: "9000099999", instagram_username: null } }), [{ role: "user", content: content.replace("Rubbish product, worst after sales support", "Price?"), type: "text", created_at: "1" }])!;
  assert.equal((await buildFromSagepilot([happy], new Date("2026-11-03T06:00:00.000Z"))).tickets[0].scenarioId, "C2");
});

test("the AI's first reply in Sagepilot counts as the first response", () => {
  const m = mapChat(chat({ first_agent_response_at: null }), [
    { role: "user", content: "price of iphone 15?", type: "text", created_at: "2026-11-03T04:00:05.000Z" },
    { role: "pilot", content: "It is ₹59,900", type: "ai_generated", created_at: "2026-11-03T04:00:20.000Z" },
  ])!;
  assert.equal(m.sagepilot.firstResponseAt, "2026-11-03T04:00:20.000Z");
  assert.equal(m.sagepilot.firstReplyBy, "ai");
});

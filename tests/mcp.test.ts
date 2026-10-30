import assert from "node:assert/strict";
import { test } from "node:test";
import { bearerMatches, handleMcpPost, mcpMethodNotAllowed, type McpDeps } from "../src/lib/ai/mcp";
import type { ToolContext } from "../src/lib/ai/tools";
import { accessGate } from "../src/lib/access";
import { buildDemoSeed } from "../src/lib/ops/demo-seed";
import { MemoryOpsStore } from "../src/lib/ops/memory-store";
import { loadSeed } from "../src/lib/ops/snapshot";

const TOKEN = "mcp-test-token-0123456789";
const NOW = new Date("2026-10-30T06:30:00Z");

async function deps(token: string | null = TOKEN): Promise<McpDeps> {
  const store = new MemoryOpsStore();
  await loadSeed(store, buildDemoSeed(NOW));
  const ctx: ToolContext = { store, repo: null, now: () => NOW };
  return { token, context: async () => ctx };
}

function post(body: unknown, auth: string | null = `Bearer ${TOKEN}`): Request {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (auth) headers.authorization = auth;
  return new Request("https://ops.example.com/api/mcp", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
}

test("auth: no MCP_TOKEN is 503, missing or wrong bearer is 401", async () => {
  const off = await handleMcpPost(post({ jsonrpc: "2.0", id: 1, method: "ping" }), await deps(null));
  assert.equal(off.status, 503);
  const d = await deps();
  const missing = await handleMcpPost(post({ jsonrpc: "2.0", id: 1, method: "ping" }, null), d);
  assert.equal(missing.status, 401);
  assert.match(missing.headers.get("www-authenticate") ?? "", /Bearer/);
  const wrong = await handleMcpPost(post({ jsonrpc: "2.0", id: 1, method: "ping" }, "Bearer nope"), d);
  assert.equal(wrong.status, 401);
  assert.equal(bearerMatches(`Bearer ${TOKEN}`, TOKEN), true);
  assert.equal(bearerMatches(`bearer ${TOKEN}`, TOKEN), true);
  assert.equal(bearerMatches(TOKEN, TOKEN), false);
  assert.equal(bearerMatches("Bearer ", TOKEN), false);
});

test("initialize negotiates the protocol version and announces tools", async () => {
  const d = await deps();
  const res = await handleMcpPost(post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } }), d);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  const body = (await res.json()) as { jsonrpc: string; id: number; result: { protocolVersion: string; capabilities: unknown; serverInfo: { name: string; version: string } } };
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.id, 1);
  assert.equal(body.result.protocolVersion, "2025-03-26");
  assert.deepEqual(body.result.capabilities, { tools: {} });
  assert.equal(body.result.serverInfo.name, "epik-ops");

  const future = await handleMcpPost(post({ jsonrpc: "2.0", id: "a", method: "initialize", params: { protocolVersion: "2099-01-01" } }), d);
  assert.equal(((await future.json()) as { result: { protocolVersion: string } }).result.protocolVersion, "2025-06-18");
  const old = await handleMcpPost(post({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2024-11-05" } }), d);
  assert.equal(((await old.json()) as { result: { protocolVersion: string } }).result.protocolVersion, "2024-11-05");
});

test("notifications get 202 with no body; ping returns an empty result", async () => {
  const d = await deps();
  const note = await handleMcpPost(post({ jsonrpc: "2.0", method: "notifications/initialized" }), d);
  assert.equal(note.status, 202);
  assert.equal(await note.text(), "");
  const ping = await handleMcpPost(post({ jsonrpc: "2.0", id: 7, method: "ping" }), d);
  assert.deepEqual(await ping.json(), { jsonrpc: "2.0", id: 7, result: {} });
});

test("tools/list exposes every tool with an input schema", async () => {
  const res = await handleMcpPost(post({ jsonrpc: "2.0", id: 2, method: "tools/list" }), await deps());
  const body = (await res.json()) as { result: { tools: Array<{ name: string; description: string; inputSchema: { type: string } }> } };
  const names = body.result.tools.map((t) => t.name);
  assert.equal(names.length, 13);
  for (const name of ["search_orders", "get_order", "pipeline_summary", "sales_summary", "stock_lookup", "stuck_orders", "search_slack_messages"]) assert.ok(names.includes(name), name);
  assert.ok(body.result.tools.every((t) => t.inputSchema.type === "object" && t.description));
});

test("tools/call returns JSON text content, and tool failures set isError", async () => {
  const d = await deps();
  const res = await handleMcpPost(post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_orders", arguments: { stage: "awaiting_payment" } } }), d);
  const body = (await res.json()) as { result: { content: Array<{ type: string; text: string }>; isError: boolean } };
  assert.equal(body.result.isError, false);
  assert.equal(body.result.content[0].type, "text");
  const data = JSON.parse(body.result.content[0].text) as { total: number; today_ist: string };
  assert.equal(data.total, 3);
  assert.equal(data.today_ist, "2026-10-30");
  assert.doesNotMatch(body.result.content[0].text, /\b\d{10}\b/);

  const bad = await handleMcpPost(post({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "sales_summary", arguments: { from: "last week" } } }), d);
  const badBody = (await bad.json()) as { result: { isError: boolean; content: Array<{ text: string }> } };
  assert.equal(badBody.result.isError, true);
  assert.match(badBody.result.content[0].text, /IST calendar date/);

  const slack = await handleMcpPost(post({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "search_slack_messages", arguments: { q: "x" } } }), d);
  assert.equal(((await slack.json()) as { result: { isError: boolean } }).result.isError, true);

  const noStore = await handleMcpPost(post({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "pipeline_summary" } }), { token: TOKEN, context: async () => null });
  assert.equal(((await noStore.json()) as { result: { isError: boolean } }).result.isError, true);
});

test("protocol errors: unknown method, unknown tool, parse error, invalid request", async () => {
  const d = await deps();
  const unknown = (await (await handleMcpPost(post({ jsonrpc: "2.0", id: 9, method: "resources/list" }), d)).json()) as { error: { code: number } };
  assert.equal(unknown.error.code, -32601);
  const tool = (await (await handleMcpPost(post({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "delete_everything" } }), d)).json()) as { error: { code: number } };
  assert.equal(tool.error.code, -32602);
  const parse = await handleMcpPost(post("{not json"), d);
  assert.equal(parse.status, 400);
  assert.equal(((await parse.json()) as { error: { code: number } }).error.code, -32700);
  const invalid = (await (await handleMcpPost(post({ id: 11, method: "ping" }), d)).json()) as { error: { code: number } };
  assert.equal(invalid.error.code, -32600);
});

test("batches answer each request and skip notifications", async () => {
  const d = await deps();
  const res = await handleMcpPost(
    post([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "ping" },
    ]),
    d,
  );
  const body = (await res.json()) as Array<{ id: number }>;
  assert.deepEqual(body.map((r) => r.id), [1, 2]);
  const onlyNotes = await handleMcpPost(post([{ jsonrpc: "2.0", method: "notifications/initialized" }]), d);
  assert.equal(onlyNotes.status, 202);
});

test("GET/DELETE are 405, and /api/mcp skips the dashboard cookie gate", () => {
  const res = mcpMethodNotAllowed();
  assert.equal(res.status, 405);
  assert.equal(res.headers.get("allow"), "POST");
  assert.equal(accessGate({ mode: "live", pathname: "/api/mcp", accessCode: "correct-horse", cookie: undefined }), "allow");
  assert.equal(accessGate({ mode: "live", pathname: "/api/mcp", accessCode: "", cookie: undefined }), "allow");
  assert.equal(accessGate({ mode: "live", pathname: "/api/mcpx", accessCode: "correct-horse", cookie: undefined }), "challenge");
});

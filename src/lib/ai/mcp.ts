import { createHash, timingSafeEqual } from "node:crypto";
import { log } from "@/lib/log";
import { runTool, serialiseResult, ToolError, TOOLS, type ToolContext } from "@/lib/ai/tools";

/**
 * MCP server over Streamable HTTP, stateless, JSON responses only (no SSE, no sessions).
 * Read-only: it exposes the same tools as the in-app assistant.
 */

export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const MCP_LATEST = MCP_PROTOCOL_VERSIONS[0];
export const MCP_SERVER_INFO = { name: "epik-ops", version: "1.0.0" } as const;
const MAX_BODY_BYTES = 1_000_000;

export type McpDeps = {
  /** MCP_TOKEN. Null means the server is not enabled. */
  token: string | null;
  /** Resolved only when a tool runs. Null when the operations store is not configured. */
  context: () => Promise<ToolContext | null>;
};

const INSTRUCTIONS =
  "EPIK operations data (Bengaluru consumer-durables retailer). Read-only. Dates are IST. Money is in whole rupees (fields ending _inr). " +
  "'Offered' is the deal price, not money collected; 'paid' is RevOps-verified payments plus COD recorded on delivery (imported orders carry sheet values). " +
  "Orders flagged price_is_list_estimate use list price because the deal price was not in the imported sheet. " +
  "The incentive/POC window is today plus the previous 4 IST days. Phones are masked to the last 4 digits. Cite order IDs (EPK-…, #PIK…).";

type JsonRpcId = string | number;
type JsonRpcResponse = { jsonrpc: "2.0"; id: JsonRpcId | null; result?: unknown; error?: { code: number; message: string; data?: unknown } };

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
}

function rpcError(id: JsonRpcId | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** Constant-time comparison of a bearer header against the configured token. */
export function bearerMatches(header: string | null, token: string): boolean {
  const match = /^Bearer\s+(.+)$/i.exec(header?.trim() ?? "");
  const given = match?.[1]?.trim() ?? "";
  const left = createHash("sha256").update(given).digest();
  const right = createHash("sha256").update(token).digest();
  return timingSafeEqual(left, right) && given.length > 0;
}

export function mcpToolList() {
  return TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }));
}

async function callTool(params: Record<string, unknown>, deps: McpDeps, id: JsonRpcId): Promise<JsonRpcResponse> {
  const name = params.name;
  if (typeof name !== "string" || !name) return rpcError(id, -32602, "params.name is required.");
  if (!TOOLS.some((tool) => tool.name === name)) return rpcError(id, -32602, `Unknown tool: ${name}`);
  const args = params.arguments ?? {};
  if (typeof args !== "object" || Array.isArray(args) || args === null) return rpcError(id, -32602, "params.arguments must be an object.");
  const failure = (text: string): JsonRpcResponse => ({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }], isError: true } });
  let ctx: ToolContext | null;
  try {
    ctx = await deps.context();
  } catch {
    ctx = null;
  }
  if (!ctx) return failure("The operations data is not configured on this server.");
  try {
    const output = await runTool(ctx, name, args);
    return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: serialiseResult(output) }], isError: false } };
  } catch (error) {
    if (error instanceof ToolError) return failure(error.message);
    log("error", "mcp_tool_failed", { tool: name, message: error instanceof Error ? error.message.slice(0, 200) : "unknown" });
    return failure("The tool could not read the data. Try again or narrow the query.");
  }
}

/** One JSON-RPC message. Null means nothing to send back (notification or client response). */
async function handleMessage(message: unknown, deps: McpDeps): Promise<JsonRpcResponse | null> {
  if (!message || typeof message !== "object" || Array.isArray(message)) return rpcError(null, -32600, "Invalid request.");
  const msg = message as Record<string, unknown>;
  const hasId = Object.prototype.hasOwnProperty.call(msg, "id");
  const id = msg.id;
  const validId = typeof id === "string" || (typeof id === "number" && Number.isFinite(id));
  if (msg.jsonrpc !== "2.0") return rpcError(validId ? (id as JsonRpcId) : null, -32600, "jsonrpc must be \"2.0\".");
  if (typeof msg.method !== "string") {
    // A response to a server request (we never send any) or garbage.
    if (hasId && ("result" in msg || "error" in msg)) return null;
    return rpcError(validId ? (id as JsonRpcId) : null, -32600, "method is required.");
  }
  if (!hasId) return null; // notification, including notifications/initialized and notifications/cancelled
  if (!validId) return rpcError(null, -32600, "id must be a string or number.");
  const rid = id as JsonRpcId;
  const params = msg.params && typeof msg.params === "object" && !Array.isArray(msg.params) ? (msg.params as Record<string, unknown>) : {};

  switch (msg.method) {
    case "initialize": {
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : MCP_LATEST;
      return { jsonrpc: "2.0", id: rid, result: { protocolVersion, capabilities: { tools: {} }, serverInfo: MCP_SERVER_INFO, instructions: INSTRUCTIONS } };
    }
    case "ping":
      return { jsonrpc: "2.0", id: rid, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id: rid, result: { tools: mcpToolList() } };
    case "tools/call":
      return callTool(params, deps, rid);
    default:
      return rpcError(rid, -32601, `Method not found: ${msg.method}`);
  }
}

export async function handleMcpPost(request: Request, deps: McpDeps): Promise<Response> {
  if (!deps.token) return json({ error: "The MCP server is not enabled. Set MCP_TOKEN." }, 503);
  if (!bearerMatches(request.headers.get("authorization"), deps.token)) {
    return json({ error: "A valid bearer token is required." }, 401, { "www-authenticate": 'Bearer realm="epik-ops"' });
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return json(rpcError(null, -32600, "Request too large."), 413);
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return json(rpcError(null, -32700, "Body could not be read."), 400);
  }
  if (raw.length > MAX_BODY_BYTES) return json(rpcError(null, -32600, "Request too large."), 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(rpcError(null, -32700, "Parse error."), 400);
  }
  if (Array.isArray(body)) {
    if (!body.length) return json(rpcError(null, -32600, "Empty batch."), 400);
    if (body.length > 50) return json(rpcError(null, -32600, "Batch too large."), 400);
    const replies = (await Promise.all(body.map((m) => handleMessage(m, deps)))).filter((r): r is JsonRpcResponse => r !== null);
    return replies.length ? json(replies) : new Response(null, { status: 202 });
  }
  const reply = await handleMessage(body, deps);
  return reply ? json(reply) : new Response(null, { status: 202 });
}

export function mcpMethodNotAllowed(): Response {
  return json({ error: "This MCP server is stateless: use POST with JSON-RPC. Server-sent event streams are not offered." }, 405, { allow: "POST" });
}

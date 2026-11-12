import { createHash, timingSafeEqual } from "node:crypto";
import { readEnv } from "@/lib/env";
import { handleMcpPost, mcpMethodNotAllowed } from "@/lib/ai/mcp";
import { allowAsk } from "@/lib/ai/rate-limit";
import { toolContext } from "@/lib/ai/runtime";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const digest = (text: string) => createHash("sha256").update(text).digest();

/**
 * The same read-only MCP server, for Claude's "Add custom connector" box, which takes only a URL:
 * https://<host>/api/mcp/<MCP_TOKEN>. Treat the whole link like a password. Changing MCP_TOKEN cuts every old link.
 */
export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const token = readEnv().mcpToken;
  const { key } = await params;
  if (!token) return Response.json({ error: "The MCP server is not enabled. Set MCP_TOKEN." }, { status: 503 });
  if (!timingSafeEqual(digest(decodeURIComponent(key)), digest(token))) return Response.json({ error: "Not allowed." }, { status: 401 });
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowAsk(`mcp:${forwarded}`, Date.now(), 240)) return Response.json({ error: "Too many requests. Wait a minute." }, { status: 429 });
  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${token}`);
  return handleMcpPost(new Request(request.url, { method: "POST", headers, body: await request.text() }), { token, context: toolContext });
}

export function GET() {
  return mcpMethodNotAllowed();
}

export function DELETE() {
  return mcpMethodNotAllowed();
}

import { readEnv } from "@/lib/env";
import { handleMcpPost, mcpMethodNotAllowed } from "@/lib/ai/mcp";
import { allowAsk } from "@/lib/ai/rate-limit";
import { toolContext } from "@/lib/ai/runtime";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * MCP server (Streamable HTTP, stateless JSON). Connect with the URL https://<host>/api/mcp and
 * the header `Authorization: Bearer <MCP_TOKEN>`. Read-only. Exempt from the dashboard cookie gate.
 */
export async function POST(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowAsk(`mcp:${forwarded}`, Date.now(), 240)) {
    return Response.json({ error: "Too many requests. Wait a minute." }, { status: 429 });
  }
  return handleMcpPost(request, { token: readEnv().mcpToken, context: toolContext });
}

export function GET() {
  return mcpMethodNotAllowed();
}

export function DELETE() {
  return mcpMethodNotAllowed();
}

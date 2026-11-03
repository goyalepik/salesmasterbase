import { NextResponse } from "next/server";
import { listChats, listMessages, sagepilotConfig, SagepilotError, type SpChat } from "@/features/cx/data/adapters/sagepilot/client";
import { mapChat, type ImportedChat } from "@/features/cx/data/adapters/sagepilot/map";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RANGES = new Set(["today", "yesterday", "last_7_days", "last_30_days"]);

/**
 * Read-only import for the EPIK Support pilot: recent Sagepilot tickets with what the customer said.
 * Behind the dashboard access code (src/proxy.ts) and the pilot flag. Never writes to Sagepilot.
 */
export async function GET(request: Request) {
  if (process.env.NEXT_PUBLIC_CX_PILOT !== "true") return NextResponse.json({ error: "Not found." }, { status: 404 });
  const config = sagepilotConfig();
  if (!config) {
    return NextResponse.json({ error: "Sagepilot is not connected. Set CX_SAGEPILOT_ENABLED=true and SAGEPILOT_API_TOKEN in the environment." }, { status: 503 });
  }
  const url = new URL(request.url);
  const range = url.searchParams.get("range") ?? "last_7_days";
  const max = Math.min(300, Math.max(1, Number(url.searchParams.get("max")) || 150));
  if (!RANGES.has(range)) return NextResponse.json({ error: "Unknown range." }, { status: 400 });

  try {
    const chats = await listChats(config, { dateRange: range, max });
    const items: ImportedChat[] = [];
    // Counts only, so a skipped ticket is explained without showing any customer data.
    const stats = { fetched: chats.length, spam: 0, noCustomerText: 0, messagesFailed: 0, messagesFailedStatus: null as number | null };
    /** Message role/type pairs seen, e.g. "user/message": 40. Labels only, never content. */
    const labels: Record<string, number> = {};
    // A few at a time, to stay polite with Sagepilot's rate limits.
    for (let i = 0; i < chats.length; i += 5) {
      const batch = chats.slice(i, i + 5);
      const results = await Promise.all(
        batch.map(async (chat: SpChat) => {
          const messages = await listMessages(config, chat.id).catch((error: unknown) => {
            stats.messagesFailed += 1;
            stats.messagesFailedStatus = error instanceof SagepilotError ? error.status : 0;
            return [];
          });
          if (chat.is_spam) stats.spam += 1;
          for (const m of messages) {
            const key = `${m.role ?? "?"}/${m.type ?? "?"}`;
            labels[key] = (labels[key] ?? 0) + 1;
          }
          return mapChat(chat, messages);
        }),
      );
      for (const r of results) {
        if (!r) continue;
        if (r.msg.text?.trim()) items.push(r);
        else stats.noCustomerText += 1;
      }
    }
    return NextResponse.json({ fetchedAt: new Date().toISOString(), range, count: items.length, stats: { ...stats, labels }, items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // No customer data in logs: only the status.
    const status = error instanceof SagepilotError ? error.status : 500;
    console.error(JSON.stringify({ event: "cx_sagepilot_import_failed", status }));
    return NextResponse.json({ error: error instanceof SagepilotError ? error.message : "Could not reach Sagepilot." }, { status: status === 401 || status === 403 || status === 429 ? status : 502 });
  }
}

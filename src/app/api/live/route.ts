import { createClient } from "@supabase/supabase-js";
import { readEnv } from "@/lib/env";
import { log } from "@/lib/log";
import { getLiveRepository } from "@/lib/db/supabase-repository";
import { loadWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const workspace = await loadWorkspace();
  if (workspace.kind !== "ready" || workspace.mode !== "live") {
    return Response.json({ error: "Live updates are available only when live mode is configured." }, { status: 503 });
  }
  const env = readEnv();
  if (!env.supabaseUrl || !env.serviceRoleKey) {
    return Response.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const supabase = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const repo = getLiveRepository();
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      send("status", { status: "CONNECTING" });
      const channel = supabase
        .channel(`epik-live-${crypto.randomUUID()}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "slack_messages" }, async (payload) => {
          const record = (payload.new ?? payload.old) as { id?: string };
          const id = record?.id;
          if (!id) return;
          try {
            const row = payload.eventType === "DELETE" ? undefined : await repo.getInboxRow(id);
            send("change", { table: "slack_messages", action: payload.eventType, id, row: row ?? undefined });
          } catch (error) {
            log("error", "live_row_failed", { message: error instanceof Error ? error.message : "unknown" });
          }
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "exceptions" }, (payload) => {
          const record = (payload.new ?? payload.old) as { id?: string };
          if (!record?.id) return;
          send("change", { table: "exceptions", action: payload.eventType, id: record.id });
        })
        .subscribe((status) => {
          send("status", { status });
        });
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }, 15000);
      cleanup = () => {
        clearInterval(heartbeat);
        void supabase.removeChannel(channel);
      };
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

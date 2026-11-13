import { after } from "next/server";
import { sagepilotConfig } from "@/features/cx/data/adapters/sagepilot/client";
import { verifyWebhook } from "@/features/cx/server/webhook";
import { syncStep } from "@/features/cx/server/sagepilot-sync";
import { getCxStore } from "@/features/cx/server/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Receives Sagepilot webhooks (v5 5.2), off unless CX_SAGEPILOT_WEBHOOK_ENABLED=true. Verifies
 * HMAC-SHA256(secret, timestamp + "." + rawBody) against X-Sagepilot-Signature within 5 minutes, ignores repeats by
 * X-Sagepilot-Event-Id, then runs a sync step. Never creates or changes a subscription in Sagepilot.
 */
export async function POST(request: Request) {
  if (process.env.CX_SAGEPILOT_WEBHOOK_ENABLED !== "true") return Response.json({ error: "Webhook is off." }, { status: 404 });
  const raw = await request.text();
  const store = getCxStore();
  const check = verifyWebhook({
    secret: process.env.CX_SAGEPILOT_WEBHOOK_SECRET ?? "",
    timestamp: request.headers.get("x-sagepilot-timestamp") ?? "",
    signature: request.headers.get("x-sagepilot-signature") ?? "",
    body: raw,
  });
  if (!check.ok) return Response.json({ error: check.reason }, { status: 401 });
  const eventId = request.headers.get("x-sagepilot-event-id") ?? "";
  if (eventId) {
    const [first] = await store.kv.run([["SET", `cx:wh:${eventId}`, "1", "NX", "PX", 86_400_000]]);
    if (first !== "OK") return Response.json({ duplicate: true });
  }
  const config = sagepilotConfig();
  if (config) after(() => syncStep(store, config, { budgetMs: 30_000 }).then(() => undefined).catch(() => undefined));
  return Response.json({ ok: true });
}

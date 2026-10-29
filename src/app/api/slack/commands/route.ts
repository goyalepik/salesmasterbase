import { readSignedSlackForm } from "@/lib/slack/signed-form";
import { saleModal } from "@/lib/slack/sale-form";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const signed = await readSignedSlackForm(request);
  if (!signed.ok) return signed.response;
  const triggerId = signed.params.get("trigger_id");
  const invokedChannel = signed.params.get("channel_id");
  const channelId = signed.channelId || invokedChannel;
  if (!triggerId || !channelId) return new Response("Open /sale from the sales channel.", { status: 200 });

  const opened = await fetch("https://slack.com/api/views.open", {
    method: "POST",
    headers: { Authorization: `Bearer ${signed.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ trigger_id: triggerId, view: saleModal(channelId) }),
    signal: AbortSignal.timeout(8000),
  });
  const body = (await opened.json()) as { ok?: boolean; error?: string };
  if (!body.ok) {
    const hint = body.error === "missing_scope"
      ? "Add the chat:write bot scope, reinstall the app, then try /sale again."
      : "The sale form could not open. Check the slash command URL and try again.";
    return new Response(hint, { status: 200 });
  }
  return new Response(null, { status: 200 });
}

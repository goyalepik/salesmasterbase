import { runAction, simulate } from "@/features/cx/server/actions";
import { handle, json } from "@/features/cx/server/http";

export const dynamic = "force-dynamic";

/** Every ticket change. The signed-in person is the actor; the role is checked on the server. */
export async function POST(request: Request) {
  return handle(async ({ user, store }) => {
    const body = (await request.json().catch(() => ({}))) as { action?: string; ticketId?: string; payload?: unknown; expect?: number };
    const actor = { id: user.id, role: user.role };
    if (body.action === "simulate") return json(await simulate(store, body.payload, actor));
    if (!body.action || !body.ticketId) return json({ error: "Which ticket and which action?" }, 400);
    return json(await runAction(store, { action: body.action, ticketId: body.ticketId, payload: body.payload, expect: body.expect }, actor));
  });
}

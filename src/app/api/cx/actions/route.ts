import { runAction, simulate } from "@/features/cx/server/actions";
import { handle, json } from "@/features/cx/server/http";

export const dynamic = "force-dynamic";

/**
 * Every ticket change: { action, ticketKey, expectedVersion, payload }. The signed-in person is the actor; their
 * level's rights are checked on the server; on a clash (someone changed it first) the answer is 409.
 */
export async function POST(request: Request) {
  return handle(async ({ user, store }) => {
    const body = (await request.json().catch(() => ({}))) as { action?: string; ticketKey?: string; ticketId?: string; payload?: unknown; expectedVersion?: number };
    const actor = { id: user.id, role: user.role, queueIds: user.queueIds, dept: user.department || undefined };
    if (body.action === "simulate") return json(await simulate(store, body.payload, actor));
    const ticketId = body.ticketKey ?? body.ticketId;
    if (!body.action || !ticketId) return json({ error: "Which ticket and which action?" }, 400);
    return json(await runAction(store, { action: body.action, ticketId, payload: body.payload, expectedVersion: typeof body.expectedVersion === "number" ? body.expectedVersion : undefined }, actor));
  });
}

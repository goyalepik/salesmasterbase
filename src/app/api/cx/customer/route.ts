import { can } from "@/features/cx/domain/rights";
import { sessionSecret } from "@/features/cx/server/auth";
import { handle, json } from "@/features/cx/server/http";
import { customerRef } from "@/features/cx/server/redact";
import { mutate, ticketIndex } from "@/features/cx/server/workspace";

export const dynamic = "force-dynamic";

/**
 * One customer's full phone number, from an opened ticket, for levels allowed to see it. Never in lists, never logged.
 * Every reveal is written to the ticket's history and the audit log (who, when; not the number).
 */
export async function GET(request: Request) {
  return handle(async ({ user, store }) => {
    const params = new URL(request.url).searchParams;
    const ref = params.get("ref") ?? "";
    const ticketId = params.get("ticket") ?? "";
    const { tickets } = await ticketIndex(store);
    const ticket = tickets.get(ticketId) ?? (await store.getTicket(ticketId));
    if (!ticket || customerRef(ticket.customerUid, sessionSecret() ?? "") !== ref) return json({ error: "Open the ticket first." }, 404);
    if (!can(user, "reveal_phone", ticket)) return json({ error: "Your level cannot see full numbers." }, 403);
    if (!ticket.customerUid.startsWith("+91")) return json({ error: "No phone number for this customer." }, 404);
    const now = new Date();
    await mutate(store, `t:${ticket.id}`, async (repo) => {
      await repo.appendEvent({ id: `pr${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`, ticketId: ticket.id, at: now.toISOString(), actorId: user.id, actorLevel: user.role, actorDept: user.department || undefined, kind: "phone_revealed", payload: {} });
    });
    await store.audit([{ at: now.toISOString(), actorId: user.id, kind: "phone_revealed", ticketId: ticket.id }]);
    const d = ticket.customerUid.slice(3);
    return json({ phone: `+91 ${d.slice(0, 5)} ${d.slice(5)}` });
  });
}

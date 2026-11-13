import { customer360 } from "@/features/cx/domain/customer360";
import { sessionSecret } from "@/features/cx/server/auth";
import { handle, json } from "@/features/cx/server/http";
import { customerRef, maskDigits, maskPhonesInText } from "@/features/cx/server/redact";
import { StoreRepository } from "@/features/cx/server/store-repo";
import { redactTicket } from "@/features/cx/server/views";
import { ticketIndex } from "@/features/cx/server/workspace";

export const dynamic = "force-dynamic";

const scrub = <T,>(value: T): T => {
  if (typeof value === "string") return maskPhonesInText(value) as T;
  if (Array.isArray(value)) return value.map(scrub) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v)])) as T;
  return value;
};

/** One opened ticket: the ticket, every event, and the customer's history (phones masked). */
export async function GET(request: Request) {
  return handle(async ({ store }) => {
    const id = new URL(request.url).searchParams.get("id") ?? "";
    const { tickets } = await ticketIndex(store);
    const repo = new StoreRepository(store, tickets);
    const ticket = await repo.getTicket(id);
    if (!ticket) return json({ error: "Ticket not found." }, 404);
    const secret = sessionSecret() ?? "";
    const events = (await repo.listEvents(id)).map(scrub);
    const c360 = await customer360(repo, ticket.customerUid, new Date());
    const ref = (uid: string) => customerRef(uid, secret);
    const customer = c360
      ? {
          ...scrub(c360),
          customer: { ...scrub(c360.customer), uid: ref(c360.customer.uid), display: c360.customer.uid.startsWith("+91") ? maskDigits(c360.customer.uid.slice(3)) : c360.customer.uid.startsWith("unidentified") ? "Unidentified" : c360.customer.uid },
        }
      : null;
    return json({ ticket: redactTicket(ticket, secret, 4000), events, customer });
  });
}

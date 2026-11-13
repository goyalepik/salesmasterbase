import { sessionSecret } from "@/features/cx/server/auth";
import { handle, json } from "@/features/cx/server/http";
import { counters, filterTickets, PAGE_SIZE, readListQuery, redactTicket, sortTickets } from "@/features/cx/server/views";
import { ticketIndex } from "@/features/cx/server/workspace";

export const dynamic = "force-dynamic";

/** One page of the ticket list (50 rows), filtered and sorted on the server, plus the counters. Phones masked. */
export async function GET(request: Request) {
  return handle(async ({ user, store }) => {
    const now = new Date();
    const query = readListQuery(new URL(request.url).searchParams);
    const { version, tickets } = await ticketIndex(store);
    const matched = sortTickets(filterTickets(tickets.values(), query, user, now), query.view, now);
    const page = query.page ?? 0;
    const secret = sessionSecret() ?? "";
    return json({
      version,
      total: matched.length,
      page,
      pageSize: PAGE_SIZE,
      rows: matched.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((t) => redactTicket(t, secret, 160)),
      counters: counters(tickets.values(), now),
    });
  });
}

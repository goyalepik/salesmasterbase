# Supabase adapter (not built yet)

The pilot keeps data in the browser. After approval, add one file here, `supabase-repo.ts`, that implements `CxRepository` from `../../repository.ts`, and set `CX_DATA_ADAPTER=supabase`. No SQL has been written or run.

## Tables (one per type, names match the TypeScript fields)

| Table | Type | Notes |
| --- | --- | --- |
| `cx_customers` | `Customer` | `uid` primary key (E.164 phone or `unidentified:<channel>:<handle>`), `handles jsonb`, `flags text[]` |
| `cx_tickets` | `Ticket` | `id` primary key, `entities jsonb`, `explanation text[]`, `warnings text[]`, `sentiment jsonb` |
| `cx_ticket_events` | `TicketEvent` | **append-only**: no update or delete grants. Every metric (AHT, ART, FRT, holds, reopens) is computed from it |
| `cx_interactions` | `Interaction` | raw inbound and outbound messages and calls |
| `cx_calls` | `CallRecord` | missed and outbound calls |
| `cx_orders`, `cx_demos` | `Order`, `Demo` | read from the ops tables later instead of copies |

## Indexes

`cx_tickets(customer_uid)`, `cx_tickets(status)`, `cx_tickets(queue_id)`, `cx_tickets(level)`, `cx_tickets(sla_resolution_due_at)`, `cx_tickets(sla_first_response_due_at)`, `cx_ticket_events(ticket_id, at)`, `cx_interactions(customer_uid, at)`.

## Security

Row-level security per role is required before real data goes in: L2 sees its own queues, viewers see masked phones only, nobody can edit `cx_ticket_events`. Reads and writes go through the server, never with keys in the browser.

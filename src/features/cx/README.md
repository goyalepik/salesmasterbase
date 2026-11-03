# EPIK Support (CX ticketing pilot)

Every customer message becomes a ticket, classified by rules (not guesswork), prioritised, routed to a queue, and timed against an SLA. Hidden unless `NEXT_PUBLIC_CX_PILOT=true`.

## Where things are

| Folder | What |
| --- | --- |
| `config/` | `taxonomy.json` (buckets → scenarios → type, priority, queue), `keywords.json` (Hinglish normalisation, hard rules, scenario rules, sentiment words), `sla.json`, `queues.json`, `policy.json` (COD zone, VIP and L3 placeholders) |
| `domain/` | Pure functions: `classifier.ts` (L0), `routing.ts` (priority, label, level, queue, COD guard), `sla.ts`, `metrics.ts` (AHT/ART/FRT from events), `reopen.ts`, `customer360.ts`, `service.ts` (every action, each writing an event) |
| `data/` | `repository.ts` (the interface), `adapters/mock` (in memory, saved in the browser), `adapters/supabase/README.md` (later), `seed/synthetic.ts` (a fake week, no real customer data) |
| `ui/` | Console (list, ticket, Customer 360), Simulator, shell with the pilot role switcher |

Tests: `tests/cx-domain.test.ts` (`npm test`).

## How to change things

- **Add a scenario:** add it to `taxonomy.json`, add its rule to `keywords.json` (`scenarios`, in order; the most urgent match wins), add a test.
- **Change an SLA:** edit `sla.json` (minutes). VIP halves every target.
- **Owners:** edit `queues.json`. Only N Khadija (L1) is real; the rest are placeholders.

## Known limits (pilot)

- The scenario list is v0 from the brief. Check it against the Call-Center Scenario Specification (B–K) and the real ticket CSV once they are shared; then run the agreement report.
- Data lives in each browser. Reset with "Reset sample data".
- Nothing is sent to customers: replies and AI answers are only recorded.
- Queues view, Insights, Floor TV and Settings are the next phase.

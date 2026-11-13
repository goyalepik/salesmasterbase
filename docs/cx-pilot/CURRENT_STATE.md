# EPIK Support (CX) – current state (Phase 0, 13 Nov 2026)

Branch: `cx-v5`, cut from `c6c1f60` (same as `main`). Read-only audit of the code; no data was changed.

## Where the module lives

The prompt says `app/cx/**`, `lib/cx/**`, `config/cx/**`. In this repo the module is:

| Area | Path |
| --- | --- |
| Pages | `src/app/cx/` (`layout.tsx` hides it unless `NEXT_PUBLIC_CX_PILOT=true`; `page.tsx` console; `simulator/page.tsx`) |
| API | `src/app/api/cx/` (`state`, `actions`, `sync`, `customer`, `reset`, `auth/{google,callback,dev,signout,cookie}`) |
| Domain (pure) | `src/features/cx/domain/` (`classifier`, `routing`, `sla`, `metrics`, `reopen`, `customer360`, `entities`, `text`, `service`, `config`, `types`) |
| Config | `src/features/cx/config/` (`taxonomy.json` 51 scenarios, `keywords.json` 17 normalise / 10 hard / 39 scenario rules, `sla.json`, `queues.json`, `policy.json`, `users.json`) |
| Data | `src/features/cx/data/` (`repository.ts` interface, `adapters/mock/memory-repo.ts`, `adapters/sagepilot/{client,map,import}.ts`, `adapters/supabase/README.md`, `seed/synthetic.ts`) |
| Server | `src/features/cx/server/` (`store.ts` KV + memory, `workspace.ts` load/mutate/diff, `actions.ts`, `auth.ts`, `http.ts`, `redact.ts`, `sagepilot-sync.ts`) |
| UI | `src/features/cx/ui/` (`shell`, `console`, `ticket-detail`, `customer-panel`, `simulator`, `cx-store`, `bits`, `theme`) + `cx.css` |
| Tests | `tests/cx-domain.test.ts` (20), `tests/cx-sagepilot.test.ts` (7), `tests/cx-shared.test.ts` (14); node:test via `npm test` |

Paths stay where they are (moving them would touch shared files for no gain). "CX module" in this work means the paths above, plus `docs/cx-pilot/**` and the `tests/cx-*` files.

## Architecture today

- **Store** (`server/store.ts`): `CxStoreAdapter` with `MemoryStore` (one copy per server process) and `KvStore` (Upstash REST pipeline, no package). KV layout: one hash `cx:t` for all tickets, one list `cx:ev` for all events, `cx:c` customers, `cx:i` interactions, `cx:calls`, `cx:meta`, `cx:ver`. Every read loads **everything**; every write is a diff of the whole snapshot under a lock (`workspace.ts mutate`). `CX_DATA_ADAPTER=kv` falls back to memory when `KV_REST_API_URL`/`KV_REST_API_TOKEN` are missing, which is what the live site does today (banner "Actions may reset").
- **Actions**: `POST /api/cx/actions` → `runAction` (zod per action) → `service.ts`. Concurrency check is `expect` = number of events the browser saw for that ticket. 15 actions: take, start, stop, assign (queue only), back_to_l1, escalate, override, hold, resume, reply, note, resolve, reopen, call, lead.
- **Identity** (`server/auth.ts`): signed cookie `cx_session` (7 days). Google sign-in (if `CX_GOOGLE_*`) or a dev "pick a person" sign-in, which is on in production until Google is set up. The dashboard access code (`src/proxy.ts`) is the outer gate. Everyone who uses the dev sign-in as "admin" is the same Admin.
- **Roles**: `l1 | l2 | l3 | admin | viewer`. Checks today are only "viewer cannot change" (service.ts) and `sync` = l1/admin. No per-level rights matrix.
- **Privacy** (`server/redact.ts`): the browser never gets full phone numbers: customer keys become HMAC refs, numbers in text are masked. `/api/cx/customer` gives L1/Admin one full number.
- **Sagepilot** (`data/adapters/sagepilot/client.ts`): POST-only read endpoints on an allow-list: `chats/list`, `messages/list`, `customers/recent_calls`. `listChats` filters and sorts by **created_at** and stops at `max` (200). `listMessages` reads one page of 50. Sync replaces sample data, runs every chat through `ingest`, replays the first reply (AI or agent counts as first response) and the close.
- **Classifier** (`domain/classifier.ts`): ad-click opener (one phrase), missed call → K1, hard rules (most urgent wins), brand-only → C1, nothing → K2, then scenario rules sorted by priority. Uses `customerText()`, which drops sentences starting "Agent said…/Aliya…" (bug: removes customer words).
- **Routing** (`domain/routing.ts`): priority bumps (missed calls, 3rd contact), label, VIP, COD guard, L0 when informative + P2/P3 + `l0`, else L1. Owner is set in `service.ingest`: L1 → `khadija` always, L3 → `ceo`.
- **L0**: `ingest` auto-closes L0 tickets with a simulated "Information given" reply.
- **Ticket ids**: `CX-10001+` (`nextTicketId`); the Sagepilot number is kept in `external.code`.
- **SLA** (`domain/sla.ts`): due dates by priority only (`sla.json`), VIP × 0.5, at risk at 80%, brand hold pauses.
- **Metrics** (`domain/metrics.ts`): FRT counts AI replies; AHT per person from take/start/reply to stop/assign/hold/resolve; ART created → last close.
- **UI**: Console (list tabs Open / At risk / Mine / All, filters Level/Queue/Bucket/Channel/Type/Label), ticket detail (ladder, classification card, why, buttons, conversation, activity log, Customer 360), Simulator. No Queues/Insights/Settings.

## Gaps against the v5 prompt (section 3 confirmed in code)

1. `CX-` ids: confirmed (`service.ts nextTicketId`).
2. Store is memory on live: confirmed (no KV env); also the KV layout loads the whole data set on every request, which will not scale to ~8–19k tickets. Phase 1 changes the layout to per-ticket keys with indexes.
3. Single Admin identity: confirmed (dev sign-in "admin").
4. 200 cap and created-date filter: confirmed (`listChats`, `syncSagepilot max = 200`).
5. Owner always Khadija at L1: confirmed (`ingest`).
6. Corrections v1 not applied: confirmed (B1 P2, D1 P1, B12 P1 in `taxonomy.json`; no J4/J5/C9/H3/X5/X6/X7).
7. FRT 0 because AI reply counts: confirmed (`mapChat firstReplyBy`, `frtMs`).
8. AHT: per-person AHT exists in `metrics.ts`; the ticket screen shows time since creation.
9. Raw HTML in subjects: `stripHtml` exists but `subjectFor` runs on text that can still carry `<br />` from summaries.
10. Only Console and Simulator: confirmed.
11. Assign has no note, no sideways move, no send-down: confirmed.
12. Missing filters (owner, status, priority, date, category, department): confirmed.
13. L0 auto-close: confirmed.

## Baseline numbers

From the 9 Nov audit in the prompt (the live store is per server memory, so it cannot be re-read reliably today): 195 tickets for "last 7 days", 181 owned by Khadija, 13 L0 with no owner, 1 L3 owned by "ceo", 38 Unclear (19%), 92 ad leads (47%), FRT 0m on all. Phase 2 re-measures with the full sync.

## Reference files

Present: `docs/cx-pilot/Classifier_Corrections_v1.md`. Missing: the prompt itself as `PROMPT_v5.md`, the voice spec, `Customer_Service_Ticket_Tracker.xlsx`, `gold_set_to_label.csv` (see BLOCKERS.md).

## Screenshots

"Before" screenshots of the live console need the CX sign-in on the live site; to be taken in Phase 1 with the demo sign-in on a preview (synthetic data only).

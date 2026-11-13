# EPIK Support v5 – progress

Branch `cx-v5` (from `c6c1f60`). Commits per phase: `cx(v5): phase N – …`. Never merged to `main` from here.

## Plan

- [x] **Phase 0 – discovery:** CURRENT_STATE.md, BLOCKERS.md, this file.
- [x] **Phase 1 – foundations:** per-ticket KV layout with indexes and versioned events; migration from the single-hash layout; per-level access codes + "who am I" roster cookie; rights matrix (`config/rights.json`) enforced in `POST /api/cx/actions`; audit fields on every event; server-side masking per level; Sagepilot write-guard with allow-listed POST reads + test.
- [x] **Phase 2 – Sagepilot sync and identity:** `sp:<uuid>` keys, `#<code>` display, `W-` numbers, sub-tickets, search; sync by last activity with full pagination, cron, webhook behind flag; authorship (customer/ai/agent/system), HTML clean-up, FRT = human; Sagepilot fields line; L0 "AI answered" only when verified, 24 h auto-close.
- [ ] **Phase 3 – taxonomy, classifier, routing:** case categories + overview buckets, scenario → category map, spec ids, corrections v1 (new scenarios, normalise, hard and scenario rules, primary-pick rules, P0 for B1/D1/B12, complaint ≥ P1), rulesVersion + sticky overrides, routing modes, owner follows queue, Revenue Ops queue, leads view, merge/duplicate hints; 92-message regression tests.
- [ ] **Phase 4 – movement:** Move dialog, movement matrix, `moved` event, acknowledge, return-to-sender / part done, CEO decision, journey strip, hops/ping-pong; handoff notes.
- [ ] **Phase 5 – case management:** case fields, case log + promises, views (Urgent, Due soon, Action needed, …), filters in URL, saved views, actions, shortcuts.
- [ ] **Phase 6 – metrics and SLA:** FRT/AHT/ART definitions, SLA per category with admin page, escalation timeline, SLA timeline.
- [ ] **Phase 7 – Insights and screens:** Insights, Queues, Floor TV, Settings, Simulator test suite, Help.
- [ ] **Phase 8 – Customer 360 and history import.**
- [ ] **Phase 9 – learning loop and notifications.**
- [ ] **Phase 10 – showcase and go-live readiness.**
- [ ] **Final report.**

## Notes and conflicts

- Module paths differ from the prompt (`src/features/cx/**`, `src/app/cx/**`, `src/app/api/cx/**`); kept as they are.
- The current KV layout loads all data on every request; Phase 1 replaces it (per-ticket keys) because 30 days is ~8,000+ tickets.

## Phase reports

### Phase 0 (13 Nov 2026)
- Wrote `CURRENT_STATE.md`, `BLOCKERS.md`, `PROGRESS.md`. No code changed.
- Tests before work: 41 CX tests (20 + 7 + 14) in a suite of 264, all passing.
- Open: blockers B1–B7.

### Phase 1 (13 Nov 2026) – foundations
**What changed**
- Store rebuilt (`server/kv.ts`, `server/store.ts`): per-ticket keys `cx:t:<key>` + `cx:t:<key>:ev`, indexes (`cx:idx:activity`, `cx:idx:open`, `cx:idx:phone:<uid>`, `cx:idx:code:<code>`), change log `cx:chg`, `cx:cfg:*`, `cx:seq:*`, `cx:audit`, locks. One Redis-style interface with an Upstash (REST pipeline) and an in-memory implementation, so tests run the production code path. Ticket snapshots carry `rev` (bumped on every write) and `lastActivityAt`.
- Legacy layout (`cx:t` hash, `cx:ev` list…) is migrated once on first use; old keys are renamed to `cx:legacy:<stamp>:*`, never deleted.
- Each server keeps all ticket snapshots in memory and refreshes only changed keys from `cx:chg` (`server/workspace.ts ticketIndex`); events are read per ticket on demand. Domain code runs on a write-buffered `StoreRepository`; one commit per action.
- Browser: list paged on the server (50 rows, `GET /api/cx/tickets`), opened ticket with events and Customer 360 from `GET /api/cx/ticket`, poll of a version number every 10 s (`/api/cx/state`). Actions send `{action, ticketKey, expectedVersion, payload}`; a stale revision answers 409 "Updated by X just now".
- Access by level: codes `CX_ACCESS_CODE_L1/L2/L3/ADMIN/VIEWER` (constant-time compare), legacy dashboard code as `CX_LEGACY_CODE_AS` (default admin, `off` to stop), 5 tries per 10 minutes per connection (`cx:rl:*`), refused tries audited without the code. Then "who am I" from the roster (`config/users.json` + `cx:cfg:users`); signed httpOnly session, 12 h; Switch user in the avatar menu. Google sign-in kept behind `CX_AUTH_MODE=google`.
- Rights matrix `config/rights.json` + `domain/rights.ts` (`can`, `assertCan`, `ForbiddenError` → 403, nothing written). L2 rights are limited to own-department tickets or ones they hold. Buttons hidden by the same table.
- Every event carries `actorId`, `actorLevel`, `actorDept`. Full-number reveal needs `reveal_phone`, writes `phone_revealed` on the ticket and in `cx:audit`.
- Sagepilot write guard: `data/adapters/sagepilot/guard.ts` — GET allowed, POST only to an explicit, commented allow-list; anything else throws before a request.
- SLA brand-hold pause kept on the ticket (`slaPausedMs`, `slaPausedSince`) so lists need no events.
- Revenue Ops queue added (`revops`, owner placeholder `revops_owner`).

**Shared files touched:** `.env.example` (new CX variable names, no values), `.claude/launch.json` (local only, untracked: a `cx-local` launcher with local test codes).

**Tests:** `tests/cx-shared.test.ts` rewritten (20 tests): shared visibility with actor level/department, versioning and incremental refresh, stale-revision conflict, rights per level (allowed and forbidden, nothing written), rights table, append-only events, locks, idempotent import + code index, no full phones in list rows for any level, masking, level codes incl. legacy/off, sessions and level passes, roster "who am I", store choice, KV layout over the Upstash pipeline, legacy migration, write-buffer, Sagepilot guard, rate-limit counter. Full suite 270/270; `tsc` and lint clean.

**Checked in the browser (localhost, synthetic sample only):** code → name sign-in, console unchanged in look, counters/list/detail from the server; L2 Sales refused on a Finance ticket (403), allowed on its own; stale screen 409; list carries no full phone numbers.

**Open:** B1 (KV on Vercel) — until then the live site uses per-server memory. Concurrency: two different tickets are written independently; an ingest that reopens a ticket while someone acts on it can, rarely, overwrite one change (both writers hold different locks). To close in Phase 2 by taking the ticket lock inside ingest.

### Phase 2 (13 Nov 2026) – Sagepilot sync and ticket identity
**Found in Sagepilot (read-only probe, field names and counts only):** `chats/list` filters and sorts by `last_message_created_at` (7 days: 1,066 tickets with activity vs 960 created; 30 days created: 8,691). No custom date range: incremental reads go newest-first and stop at the last high-water mark. Message roles: `user` (customer), `pilot` (Aliya, type `ai_generated`), `agent`, `system`, `private` (internal note); both lists page with a cursor.

**What changed**
- Ticket key `sp:<uuid>`, shown `#<code>`; sub-ticket `sp:<uuid>~N` shown `#<code>-N` (different issue = different scenario bucket and no shared order number; greetings/unclear follow-ups stay on the same issue); website-only `W-<n>` from `cx:seq:W`. `CX-` numbering removed; a one-off code migration moves existing `CX-` records (events copied, old records renamed `cx:legacy:t:*`), and moves an AI reply out of `firstResponseAt`.
- Sync by last activity, pages of 100, no cap, back-off on 429/5xx, in steps of ~40 s that remember where they stopped (`meta.syncState`); only tickets whose last activity or status changed are re-read; messages read with the cursor (up to 2,000 per ticket). Idempotent: messages matched by Sagepilot id.
- Triggers: L1/Admin "Sync" button (one step), background step after a page poll when the last one is older than 2 min (or 15 s while the first full read is incomplete), `GET /api/cx/cron/sync` with `CRON_SECRET` for a scheduler, webhook `POST /api/cx/webhooks/sagepilot` (off unless `CX_SAGEPILOT_WEBHOOK_ENABLED=true`; HMAC-SHA256 of `timestamp.body`, 5-minute tolerance, idempotent by event id). No subscription is created in Sagepilot.
- Every message kept as a `message` event with its author; HTML stripped; only customer text is classified (the "Agent said…" stripping is gone).
- FRT = first human reply (Sagepilot agent message, our reply, or a connected call); AI first reply shown separately. Ticket fields `firstResponseAt` (human), `firstAiReplyAt`, `lastCustomerAt`.
- Sagepilot fields kept read-only on `ticket.sp` (team, assignee, normalised tags, priority, status, sub-status, Demo Missed, escalated time, CSAT, last message, human reply after last customer message) and shown as a grey line, amber when Sagepilot's priority disagrees.
- L0: never closed at intake for Sagepilot tickets. "AI answered" only when Aliya replied after the customer's last message, the scenario is L0-eligible, informative, confident, and no human-needed warning; otherwise L1. "AI answered" tickets close after 24 h without a customer message (`auto_closed_no_response`, nothing sent). Simulator close stays, labelled "(simulated)".
- Closed in Sagepilot (and nothing newer from the customer) mirrors the close.
- Sync status: "Synced N min ago · X tickets · range complete ✓", amber when failed, incomplete or older than 10 minutes; "Sagepilot sync failed at HH:MM, showing saved data".
- "Open in Sagepilot" link appears when `SAGEPILOT_CHAT_URL` (template with `{id}`) is set.

**Tests:** `tests/cx-sync.test.ts` (10): no-cap paging by last activity with only allow-listed reads, idempotent re-sync and skipped re-reads, old ticket with a new message, sub-ticket and same-issue reopen, W- numbering, search by number/#number/W-/order/phone (phones L1/Admin only), FRT human-only vs AI reply, HTML and authorship and tags, L0 verified + 24 h auto-close, webhook HMAC, CX- migration. Full suite 280/280; tsc and lint clean.

**Open:** baseline "30-day count matches Sagepilot ±1%" needs the live store (B1) to run against; the code reads the whole range with no cap. `SAGEPILOT_CHAT_URL` format unknown (B8). Cron every 2 minutes needs Vercel Pro (B9).

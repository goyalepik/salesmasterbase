# EPIK Support v5 – progress

Branch `cx-v5` (from `c6c1f60`). Commits per phase: `cx(v5): phase N – …`. Never merged to `main` from here.

## Plan

- [x] **Phase 0 – discovery:** CURRENT_STATE.md, BLOCKERS.md, this file.
- [x] **Phase 1 – foundations:** per-ticket KV layout with indexes and versioned events; migration from the single-hash layout; per-level access codes + "who am I" roster cookie; rights matrix (`config/rights.json`) enforced in `POST /api/cx/actions`; audit fields on every event; server-side masking per level; Sagepilot write-guard with allow-listed POST reads + test.
- [ ] **Phase 2 – Sagepilot sync and identity:** `sp:<uuid>` keys, `#<code>` display, `W-` numbers, sub-tickets, search; sync by last activity with full pagination, cron, webhook behind flag; authorship (customer/ai/agent/system), HTML clean-up, FRT = human; Sagepilot fields line; L0 "AI answered" only when verified, 24 h auto-close.
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

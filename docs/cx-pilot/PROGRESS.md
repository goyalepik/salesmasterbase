# EPIK Support v5 – progress

Branch `cx-v5` (from `c6c1f60`). Commits per phase: `cx(v5): phase N – …`. Never merged to `main` from here.

## Plan

- [x] **Phase 0 – discovery:** CURRENT_STATE.md, BLOCKERS.md, this file.
- [ ] **Phase 1 – foundations:** per-ticket KV layout with indexes and versioned events; migration from the single-hash layout; per-level access codes + "who am I" roster cookie; rights matrix (`config/rights.json`) enforced in `POST /api/cx/actions`; audit fields on every event; server-side masking per level; Sagepilot write-guard with allow-listed POST reads + test.
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

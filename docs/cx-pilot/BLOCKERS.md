# Blockers and decisions needed

## Blockers (work continues around them)

| # | What | Needed from | Workaround meanwhile |
| --- | --- | --- | --- |
| B1 | **Shared store not connected on Vercel.** No `KV_REST_API_URL` / `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_*`). Without it the live site keeps tickets in each server's memory. | Bhavya: Vercel → Storage → Create → Upstash (Redis) → connect to the project (Production and Preview). | `mock` adapter locally and in tests. |
| B2 | Per-level access codes not set: `CX_ACCESS_CODE_L1`, `CX_ACCESS_CODE_L2`, `CX_ACCESS_CODE_L3`, `CX_ACCESS_CODE_ADMIN`, optional `CX_ACCESS_CODE_VIEWER`. | Bhavya: pick codes, add in Vercel. | Legacy code works as admin (`CX_LEGACY_CODE_AS=admin`). |
| B3 | `CX_SESSION_SECRET` (≥ 16 chars) not set. | Bhavya, in Vercel. | Derived from the dashboard code on the live site. |
| B4 | Reference files missing in `docs/cx-pilot/`: `PROMPT_v5.md`, voice spec PDF/XLSX, `Customer_Service_Ticket_Tracker.xlsx`. `gold_set_to_label.csv` must stay outside git (it has phone numbers): put it in `data/private/` (git-ignored). | Bhavya. | Spec ids and tracker columns taken from the prompt text. |
| B5 | Sagepilot read endpoint for a contact's Shopify orders (Customer 360) not confirmed. | Check Sagepilot API docs in Phase 8. | "Orders not connected". |
| B6 | Webhook subscription to use, and its signing secret (`CX_SAGEPILOT_WEBHOOK_SECRET`). | Business. | Webhook route off (`CX_SAGEPILOT_WEBHOOK_ENABLED=false`); cron sync. |
| B7 | `CRON_SECRET` for the 2-minute sync cron (already needed for backups). | Bhavya, in Vercel. | Sync on page load with a lock. |

## Decisions needed (defaults in use)

| # | Decision | Default used |
| --- | --- | --- |
| D1 | Routing mode | `triage` (Khadija first) |
| D2 | Department heads and backups, CEO list, Revenue Ops categories | Placeholders; only N Khadija is real |
| D3 | Final SLA per Case Category, business hours | Section 6.2 table; 24×7 |
| D4 | VIP definition, ₹ threshold for VIP and for L3 | Repeat buyer (2+ orders); ₹ thresholds null (off) |
| D5 | Shared store | Vercel KV (Upstash) |
| D6 | Codes per level and who holds them; roster names | Placeholders |
| D7 | Demo data source | None ("Demo data not connected") |
| D8 | Notifications provider, digest recipients | Off |
| D9 | LLM fallback and budget | Off |

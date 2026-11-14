# EPIK Operations: project brief for Claude Code

Read this whole file before doing anything. It is the hand-off from the planning session: what the business needs, what is already built, how to run it, how to ship it to Vercel, and what to build next.

The owner is Bhavya Goyal. He wants a production-ready system he can see on localhost and on the live Vercel site. Explain things in plain language, one step at a time. Whenever something needs a website click (Supabase, Vercel, Slack, GitHub), say exactly where to click and what to paste.

---

## 1. The business

EPIK (VIVAVILLA RETAIL PVT LTD) is a consumer-durables retailer in Bengaluru: robot vacuums (Dreame, Ecovacs, Narwal), phones (Apple, Samsung), TVs, kitchen and large appliances.

- Salespeople sell from hubs: Hebbal, HQ, HSR HQ, Jayanagar, Kengeri, Mahadevpura. Old sheets also mention Hosa Road and Gurgaon.
- There is one central warehouse. "Hub" on an order means the seller's hub, not where the stock is.
- The team is not technical. They tap buttons and pick from lists, and they do not type commands. Keep all wording short and plain.
- Slack workspace: Epik HQ. Sales channel: `#epik_cd-payment-updates`. Bot: SalesMasterbase.
- Live site: https://salesmasterbase.vercel.app (Vercel). Database: Supabase. Code: https://github.com/goyalepik/salesmasterbase
- Every order also gets a Shopify order number (`#PIK3918`). Today someone types it into Shopify by hand. The goal is to create it automatically later (section 9).

## 2. The flow this system runs

Every order moves through these steps:

```
Sale → RevOps → Inventory → Logistics → Installation
```

1. **Sale.** The seller taps the pinned **New sale** button in Slack, or uses New order on the website. Required fields: customer, phone (10 digits), product picked from the SKU list (up to 3 products), offered price, hub, POC and the other existing fields.
2. **RevOps** checks the payment against the bank. They enter the amount, mode and UTR, then **send to inventory**. They can also **clear without payment** with a reason, for example approved finance or a trusted repeat customer.
3. **Inventory.** One person decides each product line:
   - **Reserve from stock**: books a unit so nobody else can take it.
   - **Hold on PO**: wait for a purchase order already on its way. It is reserved automatically when the goods arrive.
   - **Procure for this customer**: buy it from a vendor (for example Devi International, Croma, Vijay Sales), with vendor, cost and ETA. Reserved automatically when received.
   - **Brand ships direct**: the brand delivers to the customer. Sheet code `BRAND_DEL_CX`.
   - **Reject** with a reason: goes back to the seller (stage On hold).
4. **Logistics.** Out for delivery (driver name, serial number per unit), then Delivered (cash collected on delivery). The driver has no login; the hub or logistics person taps the buttons.
5. **Installation.** Created automatically for robot vacuums, or when the Installation add-on was chosen. Due the day after delivery.

**Cancel** works at any step before out-for-delivery and frees reserved stock.

Order stages (stored): `awaiting_payment`, `awaiting_inventory`, `awaiting_stock`, `ready_to_dispatch`, `out_for_delivery`, `delivered`, `on_hold`, `cancelled`. They map to the sheet codes the team already knows: CONFIRMED, EPIK_OFD, EPIK_DELIVERED, EPIK_CANCELLED.

### Rules already decided (do not change without asking Bhavya)

- **Offered price** is the deal price. It is **not** money collected. "Paid" counts only RevOps-verified payments plus cash recorded on delivery.
- All days and times are **IST**. Money is shown in ₹ and stored in paise.
- "Last 5 days" (POC page, incentive) means today plus the previous 4 IST days.
- The POC typed on the form is the seller for that order. It is not saved as the Slack user's name.
- A reply in a Slack thread is not a second sale.
- A price above ₹10 crore is not a sale (guards against old free-text Slack lines).
- **Stock is a ledger:** on hand = sum of stock movements (opening, inward, dispatch, return…). Nobody types a stock count.
- **The last unit can never go to two orders.** The `ops_reserve_line()` database function enforces this. Do not bypass it.
- **Every change goes through `src/lib/ops/service.ts`.** It checks roles, moves stages and writes the history. Pages and Slack handlers must not write to tables directly.
- **Roles:** while the Team roles list in Settings is empty, everyone can press every button. Once anyone is added, Slack buttons check roles (sales, revops, inventory, procurement, logistics, installation, admin).

## 3. What is already built (in this folder)

| Area | Files |
| --- | --- |
| Data model | `src/lib/ops/types.ts`, `supabase/migrations/0002_operations.sql` (orders, order_lines, payments, stock_movements, reservations, purchase_orders, procurement_requests, installations, order_events (append-only), ops_people, action_claims, stock_levels view) |
| Rules | `src/lib/ops/service.ts` (createOrder, recordPayment, clearForFulfilment, decideLine, setLineSku, markProcurementOrdered, receiveProcurement, receivePurchaseOrder, outForDelivery, markDelivered, completeInstallation, cancelOrder, setShopifyId, addNote, nextStep) |
| Storage | `src/lib/ops/store.ts` (interface), `memory-store.ts` (demo and tests), `supabase-store.ts` (live), `index.ts` (`getOpsStore()` picks one) |
| Numbers | `src/lib/ops/metrics.ts` |
| Sheet import | `scripts/import-sheets.ts`, `src/lib/ops/snapshot.ts` |
| Dashboard | `/` overview, `/orders`, `/orders/[id]` (all actions), `/revops`, `/inventory`, `/procurement`, `/dispatch`, `/installations`, `/orders/new`, Settings → Team roles. Server actions in `src/app/actions/ops.ts`. "Acting as" name cookie in the top bar. |
| Slack | `src/lib/slack/ops-cards.ts` (the live order card), `ops-modals.ts`, `ops-actions.ts`, `sale-form.ts` (phone, SKU search, products 2 and 3), `sync.ts` (dashboard changes refresh the Slack card and ping the next team), route `/api/slack/interactivity` |
| AI | `src/lib/ai/agent.ts`: Claude tool use over the read-only tools in `src/lib/ai/tools.ts`. Falls back to OpenAI, then to fixed reports. `/assistant` is a chat, `/briefing` gives a daily briefing. |
| MCP | `/api/mcp` (same read-only tools, needs `Authorization: Bearer <MCP_TOKEN>`) |
| Inventory screens | `/inventory` New orders (one card per order, Allocate all ready), `/inventory/backorders`, `/inventory/stock`, `/procurement` (Purchase orders), `/inventory/view` (by category or brand, team sheet status), `/inventory/sheet` (sheet sync: what came in, what needs a look, sheet vs app). Rules in `service.ts` (`allocateOrder`, `allocateReadyOrders`, `applySheetRows`). |
| Team sheet sync | No scripts. The app reads Inventory Masterbase (Ritika's sheet, readable by link) as CSV every 5 min (`src/lib/sheets/run.ts` `pullTeamSheet`, on page visits, cron and `/inventory/sheet`) and applies rows dated on/after `SHEET_SYNC_FROM` through `applySheetRows` (new stock, dispatches, returns; unknown SKUs added as products). Bhavya's copy mirrors Ritika's with `=IMPORTRANGE` and pulls the app's stock with `=IMPORTDATA(/api/sheet/live-stock?key=SHEET_SYNC_TOKEN)`. No sheet is written by the app. |
| Logins and roles | `src/lib/team-login.ts`: each person in Settings → Team roles signs in with a personal code (made from `DASHBOARD_ACCESS_CODE` + their Slack ID; shown to admins). They see only their areas, their dashboard buttons check their roles in `service.ts`, and history shows their name. The main access code is admin and never locks anyone out. `src/lib/ops-ui/actor.ts` `currentSession()`. |
| Backups | `src/lib/backup.ts`: daily (Vercel Cron in `vercel.json`, 2 am IST, needs `CRON_SECRET`) gzip JSON of every table into the private Supabase Storage bucket `backups`, last 30 kept. System page: Back up now, Download latest. |
| MIS dashboard | `/mis` (home card "MIS Dashboard", admins only): the October-26 investor MIS as 7 one-screen tabs (Overview, P&L, Category & brand, Sales team, Operations, Products, Demos); every number opens its source. Snapshot, not live. The numbers never go in git (public repo): localhost reads `data/mis-oct26.local.json`, the live site reads the private Supabase Storage bucket `mis` (upload with `npx tsx --env-file=.env.local scripts/push-mis.ts`). Code in `src/features/mis/`. |
| Simple dashboard and roles | `src/components/simple-shell.tsx`: top bar, menu button, role switch Sales / Inventory / Admin (`src/lib/app-roles.ts`: signed `epik_role` cookie, `pathAllowed`, `menuFor`). A personal code fixes the role. `currentActor()` carries the role's service roles and `canAct` checks them. Everyone can open every post-sales area (`/post-sales` cards: Sales and payment, Order view, Inventory view, Logistics and installation, plus the salespeople's link with By salesperson); the role decides what they can change. Settings, System, Payment review and Overview stay Admin only (More). Order card `/orders/[id]`; old detailed page `/orders/[id]/full` (Admin). Statuses show as team sheet codes: NEW, WAITING_STOCK, CONFIRMED, EPIK_OFD, EPIK_DELIVERED, EPIK_CANCELLED. |
| Order status (simple flow) | From `ORDER_STATUS_FROM` (default 2026-11-14) every sale goes straight to logistics. `/logistics` (Delivery → Order status): logistics picks New sale, Waiting for stock, Ready to dispatch, Out for delivery, Delivered, On hold or Cancelled (`setDeliveryStatus` in `service.ts`; moves the stage only, never stock, and refuses orders with stock booked in the app). Status words in `src/lib/ops/delivery-status.ts`. |
| Salespeople's status page | `/status/<token>`: no login, full order details, read only. The token comes from `PUBLIC_STATUS_TOKEN` (set a new one to cut off a leaked link) or is made from `DASHBOARD_ACCESS_CODE`. Allowed in `src/lib/access.ts`; page in `src/app/status/[token]`. Copy the link on `/logistics`. |
| Sales sheet (salesmasterbase) | `src/lib/sheets/sales-sheet*.ts`, `google-sheets.ts`: each sale becomes a row, then status, #PIK, driver and dates follow. Columns are matched by heading name (`sales-sheet-map.ts`); an `EPIK order` column is added at the end if missing; the team's own columns are never touched. Connected by the small Apps Script in the sheet (`docs/sales-sheet-apps-script.gs`, deployed as a web app; its link in `SALES_SHEET_SCRIPT_URL`, which is a secret), or by a service account (`SALES_SHEET_ID` + `GOOGLE_SERVICE_ACCOUNT_JSON`). Off until one is set. Writes at once after each change, plus a sweep on `/logistics` visits and the 10-minute cron. |
| AI sale reader (Slack) | Off until `SLACK_AI_SALES=on` (plus `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`). A salesperson writes a sale in plain words in the sales channel, no /sale. The AI (`src/lib/ai/sale-reader.ts`) fills the long form's fields and the form's own checks (`readOrderFields`) decide what's missing. The bot asks in the thread only when a must-have is missing (customer, phone, product, offered price, payment status) or a product could be several items (buttons); it re-reads the whole thread on each reply. Otherwise the order is made at once, same card, Shopify, dashboard, SMB sheet and Sales Records as the form, and the "Done" note lists any small things still missing (hub, address, sale source…); replies to it go into the order's notes. "Generate/send payment link" always means To be collected by Payment link; a warranty sold on its own is a warranty line, not the product. Payment updates and chat are left to the old rules. Slack flow in `src/lib/slack/ai-sale.ts`, live wiring and the shared after-sale steps in `src/lib/slack/sale-finish.ts`. Needs `channels:history` for thread replies. |
| System page | `/system` (Command → System): the notebook flow Sales → RevOps → Inventory → Logistics and the notes (backup, AI/MCP, logins, health), each green/amber/red with the one thing to fix. |
| Speed fixes | No database health check on every page (`quickHealth`), faster Slack thread lookup, lighter blur in CSS, loading skeletons |

The older Slack-text system (Slack inbox, Sales Records, Salespeople, Exceptions, Activity Log) still works. It is under "More" in the sidebar.

**Tests:** `npm test` should report 296 passing. `npx tsc --noEmit` and `npm run lint` should be clean.

### The imported data

`data/ops-seed.local.json` was built from the three company sheets: Inventory Tracker, Installation Tracker and Procurement sheet. It holds customer names, phones and costs, so **it must never be committed** (`.gitignore` already excludes `data/*.local.json`). It contains:

- 2,752 products
- 1,595 units in stock across 344 SKUs (about ₹2.07 crore at cost)
- 131 open PO lines (612 units incoming)
- 1,228 orders, 173 of them still open
- 454 installations

Problems found in the data (show them; don't hide them):

- 39 booked order lines use a SKU with no stock in Current Stock. They land in "Inventory check" for a decision.
- 132 order lines have no SKU. Inventory has to map them.
- Orders that came only from "Booked Orders" have no customer name or deal price, because the sales sheet (SMB) wasn't shared. They show "Customer on #PIK…" and the list price, with a note.

## 4. Run it on localhost

```bash
npm install
APP_MODE=demo npm run dev
```

Open http://localhost:3000.

- `APP_MODE=demo` uses the imported sheet data in memory. It doesn't touch Supabase, so it is safe to click everything. Changes are lost when the server restarts.
- Without `APP_MODE=demo`, the app reads `.env.local`. If that says live, it uses the real Supabase, which needs step 5.2 first.

## 5. Ship to Vercel (do this in order)

Vercel is connected to GitHub. **Pushing to `main` updates the live site.** Pushing any other branch creates a separate preview link with the same settings. Use a preview first: the new code has only been tested on demo data, not on the real Supabase.

1. **Clean up and push a preview** (Claude Code does this):
   ```bash
   git checkout -b ops-platform
   git rm src/components/overview-screen.tsx src/lib/ai/ground.ts src/lib/ai/openai.ts src/lib/ai/queries.ts
   npm install && npm test && npx tsc --noEmit && npm run lint
   git add -A   # check data/ and .env* are NOT staged
   git commit -m "Add order flow from sale to installation, stock ledger, Slack order cards, Claude assistant and MCP server"
   git push -u origin ops-platform
   ```
2. **Database** (Bhavya does this on the website):
   - Open Supabase → SQL Editor → New query.
   - Paste the whole of `supabase/migrations/0002_operations.sql` and click Run. It only adds tables, so existing data is safe.
   - If `0001_init.sql` was never applied, run that first.
3. **Load the sheet data into Supabase** (Claude Code does this, once):
   ```bash
   set -a; source .env.local; set +a
   npx tsx scripts/import-sheets.ts --seed data/ops-seed.local.json --push
   ```
   `.env.local` must hold the live `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Running it again is safe: orders already present and existing stock are skipped.
4. **Vercel settings** (Bhavya does this on the website): Project → Settings → Environment Variables, for Production and Preview. Add:
   - `ANTHROPIC_API_KEY`: turns on the Claude assistant.
   - `ANTHROPIC_MODEL`: optional, default `claude-sonnet-4-5`.
   - `APP_BASE_URL`: `https://salesmasterbase.vercel.app`
   - `MCP_TOKEN`: optional; a long random string.
   - `SLACK_REVOPS_CHANNEL_ID`, `SLACK_INVENTORY_CHANNEL_ID`, `SLACK_LOGISTICS_CHANNEL_ID`: optional; team pings.
   - `SALES_SHEET_SCRIPT_URL` (the sheet script's web app link, ends in /exec), `SALES_SHEET_TAB` (optional; first tab if empty), `SALES_SHEET_ID` (optional; the sheet link, for the Open sheet button): sales into the sheet.
   - `PUBLIC_STATUS_TOKEN`: optional; a long random string for the salespeople's status link. `ORDER_STATUS_FROM`: optional start day (YYYY-MM-DD).

   Existing variables stay as they are: `APP_MODE=live`, Supabase keys, Slack keys, `DASHBOARD_ACCESS_CODE`.

   Also set Project → Settings → Functions → Region to the same region as the Supabase project (Mumbai → `bom1`). This is the biggest speed win when live.
5. **Check the preview link** (Vercel → Deployments → the `ops-platform` one):
   - Overview loads with real numbers.
   - Orders lists orders, and an order page opens.
   - Inventory shows stock.
   - Create one test order on New order and take it through every step.
   - Cancel the test order at the end.
6. **Go live:** on GitHub, open a pull request from `ops-platform` to `main` and merge it. Vercel deploys production automatically in about 2 minutes.
7. **Slack app** (Bhavya, at api.slack.com/apps → SalesMasterbase):
   - Interactivity & Shortcuts: set both the Request URL and the Select Menus **Options Load URL** to `https://salesmasterbase.vercel.app/api/slack/interactivity`.
   - Bot scopes: `chat:write`, `commands`, `users:read`, `channels:history`, `groups:history`. Reinstall the app if Slack asks.
   - Post a fresh New sale button from Settings, then try one sale in Slack.
8. **Roles:** in Settings → Team roles, add each person's Slack user ID and role. Until then, everyone can press everything.

After this, the normal loop is: change code → `git push` to `main` → Vercel updates the site by itself.

## 6. Before calling it production-ready (checklist)

- [ ] `npm test`, `npx tsc --noEmit`, `npm run lint` and `npm run build` all pass.
- [ ] The preview works against real Supabase: list, detail, every action, stock numbers correct after reserve, dispatch and cancel.
- [ ] Two people pressing Reserve on the last unit: one wins and the other gets a clear message.
- [ ] Slack: sale → card appears; each button works; the card updates; the thread gets a one-line note.
- [ ] A change on the dashboard updates the Slack card.
- [ ] No customer data in git (`git log --stat` shows no `data/` files).
- [ ] **The GitHub repo is private.** It is currently public, and anyone can read the code.
- [ ] Pages load in under about a second on the live site.

## 7. How to work in this repo

- Next.js 16 has breaking changes. Read `AGENTS.md` and the guides in `node_modules/next/dist/docs/` before using an API you're unsure of. Middleware is `src/proxy.ts`.
- All order, stock and payment changes go through `service.ts`. Add new rules there, with a test in `tests/ops-service.test.ts`.
- Tests use `MemoryOpsStore` with `buildDemoSeed()`, never the private seed file.
- Keep wording plain and short, and keep the dark glass style already in `globals.css`.
- Never commit `.env*` or `data/*.local.json`.
- When changing the database, add a new migration file (`0003_…sql`). Never edit one that has already been applied.

## 8. Known gaps (fix soon)

- Shopify order is not created automatically. RevOps can paste the `#PIK` number with "Link Shopify".
- No button in Slack for receiving a whole brand PO. This is on the Procurement page.
- The orders list stage counts ignore the search, hub and POC filters.
- The stock table loads up to 5,000 rows, then pages on the server.
- Login is one shared dashboard code. Individual logins (Supabase Auth) are needed before many people use the website. The "Acting as" name is only a label.
- Returns, replacements and demo units are not handled yet.
- The claude.ai web connector cannot use the MCP server, because it needs OAuth. Claude Code works: `claude mcp add --transport http epik-ops https://salesmasterbase.vercel.app/api/mcp --header "Authorization: Bearer <MCP_TOKEN>"`.

## 9. Next things to build (in order)

1. **Shopify auto-create:** when an order is created, create the `#PIK` order through the Shopify Admin API and store it. Needs a Shopify custom app token with order write access.
2. **Individual logins and roles on the website**, so the history shows real names.
3. **Goods received in the app:** the Telegram invoice bot that writes the Inward sheet should call the app instead. Then the app owns stock fully and the sheets become read-only exports.
4. **Excel export** of orders, stock and dispatch for finance.
5. **Returns and replacements** (`EPIK_RTV`, Replacement).
6. **WhatsApp or SMS updates** to customers on dispatch and delivery.

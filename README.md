# EPIK Sales Intelligence

Internal workspace for Slack message intake, review, and operational questions. The first source is `#epik_cd-payment-updates`. A message that mentions a payment is stored and parsed. It is not treated as a verified payment.

Slack, Supabase, and OpenAI are implemented in the server. They have not been confirmed against a live workspace from this repository. Unit tests use fixtures and do not call those services.

## Run it

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). With no `.env.local`, the app starts in **Demo**. The banner reads: “This is not live. This will become live after we receive this data.”

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

## Demo and live

| Mode | What you see | Slack endpoint |
| --- | --- | --- |
| `APP_MODE=demo` (default) | Fixed sample messages, with the demo sentence above | Returns 503. Nothing is stored. |
| `APP_MODE=live` with every required value | Rows from Supabase only, after the access code | Verifies the Slack signature, stores the event, then processes it. |
| `APP_MODE=live` with something missing, or any other value | A configuration error. If the access code is missing, the proxy returns 503 and does not render the workspace. | Returns 503. Demo rows are not substituted. |

Demo edits, such as resolving an exception, last until the dev server restarts or the India Standard Time date changes. They are not written to Supabase. A failed live database check does not fall back to sample rows.

## Environment

Copy `.env.example` to `.env.local`. Leave values blank for demo. Never commit `.env.local`.

Required before live mode:

- `APP_MODE=live`
- `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL` on the server)
- `SUPABASE_SERVICE_ROLE_KEY`
- `SLACK_SIGNING_SECRET`
- `DASHBOARD_ACCESS_CODE` of at least 8 characters

Optional:

- `SLACK_BOT_TOKEN` for history backfill only. Events already contain the message text.
- `SLACK_CHANNEL_ID` limits parsing to one channel. Other channels are still stored and marked skipped.
- `SLACK_CHANNEL_NAME` is a display label.
- `OPENAI_API_KEY` enables the assistant. Without it, pages still load and questions return database counts only.
- `OPENAI_MODEL` defaults to `gpt-4o-mini`.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` is unused. The browser does not query Supabase.

Do not prefix the service-role key, signing secret, bot token, access code, or OpenAI key with `NEXT_PUBLIC_`.

## Pages

- **Overview** — the question box, operational counts, 14-day message activity, classification donut, recent messages, open exceptions, contributor snapshot, and health states.
- **Slack inbox** and **message detail** — search, filters, original text, extract, exceptions, attempts, audit, and retry when a message has failed fewer than 5 times.
- **Sales records** — extracted fields. Amounts are not summed.
- **Contributors** — most active Slack senders by distinct non-skipped messages. This is not sales performance.
- **Exceptions** — resolving needs a note and does not verify a payment.
- **Activity log** — append-only.
- **Assistant** — server-side questions over approved read-only queries.
- **Briefing** — today’s counts versus yesterday, on demand. Nothing is emailed.
- **Settings** — which names are present, whether the database read succeeded, and whether any event is stored. Secret values are not shown.

Times are India Standard Time. A message still `received` or `processing` after two minutes counts as delayed.

## Background photograph

The team photograph is `public/epik-team.jpg`. It is drawn full-screen, blurred, and covered by a heavy black overlay so it stays behind the panels. If that file is removed, the matte-black background remains.

## How a Slack event is handled

1. `POST /api/slack/events` reads the raw body.
2. The signing secret and `X-Slack-Signature` are compared. Invalid or stale signatures return 401.
3. A URL verification challenge returns `{ "challenge": "..." }`.
4. A message is inserted with a unique pair of channel id and timestamp, and a unique event id when Slack sends one.
5. The route returns 200. Processing runs after the response, claims the row, and is safe to repeat.
6. A duplicate delivery does not create a second row. A duplicate of a message that already finished asks Slack not to retry. A duplicate of a failed message can be processed again until 5 failed attempts.
7. If the insert fails, the route returns 500 so Slack retries.
8. Connected dashboards receive Supabase Realtime changes through `/api/live`. The service-role key stays on the server. If the stream drops, the header says reconnecting and the browser opens the stream again.

Bot messages, joins, edits, deletes, and empty text are stored and marked skipped. They are not turned into sales records.

The rules parser looks for a labelled customer, an order reference, an INR amount, and payment words. There is no model call during ingestion. `src/lib/ai/intelligence.ts` remains the seam for a later extractor.

## Supabase

Create a project, then run `supabase/migrations/0001_init.sql` in the SQL editor. Do not run it from this repository against an unknown project. Row Level Security is on and there are no anon policies. Realtime is added to the `supabase_realtime` publication when that publication exists. Confirm `slack_messages` and `exceptions` are in that publication in the dashboard if the SQL step did not apply.

The commented reset at the bottom of the migration is only for a disposable database. No second migration was added in the redesign. The existing views already expose the fields the charts use.

## Slack app

This was not verified against a Slack workspace.

For a public channel, the usual minimum is:

- Bot event: `message.channels`
- Bot scope for history backfill: `channels:history`
- Signing secret from Basic Information
- Request URL: `https://<host>/api/slack/events`
- Invite the bot to `#epik_cd-payment-updates`
- Put that channel's id in `SLACK_CHANNEL_ID`

The app does not post messages or call `users.info`. Sender names are the Slack user id unless the event includes a display name.

```bash
npm run backfill
```

The script pages through `conversations.history`, skips rows that are already stored, and does not overwrite a finished message.

### First real message

1. Apply the migration. Set the live environment variables, including `DASHBOARD_ACCESS_CODE`, then `APP_MODE=live`. Restart the server.
2. Open the app, enter the access code, and confirm Settings shows the database as reachable. It should not say Slack is connected until a row exists.
3. Invite the bot and post a clearly fake line, for example: `Customer: Sample Person. Order DEMO-1006. UPI ₹22,000.`
4. The inbox should show that text. Status should become Processed or Needs review. The original sentence stays on the detail page.
5. `npm run slack:fixture` prints a signed curl. Sending it twice should still leave one row for that timestamp.

If a message stays in Processing for more than two minutes, the next pass marks it failed. Retry is on the detail page, up to five failures.

## Assistant

`POST /api/ai/ask` accepts a short question, classifies it, runs a bounded read through the existing repository, and asks OpenAI to summarise that JSON. If the model adds a number that was not in the query result, the model wording is discarded and the database summary is shown instead. The model cannot send SQL or update rows.

Questions are limited to 500 characters and 12 requests a minute per forwarded address, in memory for that process. Transcripts are not stored.

If `OPENAI_API_KEY` is missing or the call fails, the rest of the app keeps working. The assistant shows the error and the database counts, with a retry.

## Access and hosting

The access code is a shared passphrase, not a user account. The cookie is httpOnly, SameSite lax, and Secure when `NODE_ENV` is production. Live mode without a code of at least 8 characters returns 503 for pages and APIs, except the Slack events route, which still refuses to store anything until the full live configuration is present.

Someone who knows the code can read every stored message. Do not put a live deployment on the public internet without the host’s own access protection in front of it. The next authentication step is per-person accounts, not a longer shared code.

The live update stream is a Node route with `maxDuration` of 60 seconds. On a long-running `next start` process it can stay open. On a serverless host the function will end and the browser reconnects. That is expected. Supabase free projects can pause, and Realtime connection counts are limited.

This project was not deployed, and the migration was not applied to a hosted database.

## Layout

- `src/app/api/slack/events` — signature, challenge, persist, schedule processing
- `src/app/api/ai/ask` — read-only question route
- `src/lib/parse` — rules and exception decisions
- `src/lib/analytics.ts` — charts and contributor ranking
- `src/lib/db/supabase-repository.ts` — live database
- `src/lib/demo` — sample data
- `supabase/migrations/0001_init.sql` — schema
- `scripts/backfill.ts` — history recovery
- `scripts/slack-fixture.ts` — signed local request

## Later

A model extractor can implement `MessageIntelligence`. Human-confirmed values belong in the `verified_*` columns, which this release does not write. Contributor ranking can later use confirmed orders once EPIK defines the attribution. Payment verification, financial changes, customer messages, and merges need a person to approve them.

## Known limits

- The parser only understands labelled customers, simple order refs, and INR amounts.
- There is no revenue, margin, or verified-payment number.
- Classification charts use payment mention, order update, and unclassified. They do not invent payment-confirmation categories the parser does not produce.
- Message edits are skipped. The original row is kept.
- Sender display names are not looked up.
- The access code is not per-person authorization.
- Live Slack, Supabase, and OpenAI were not exercised in this environment.

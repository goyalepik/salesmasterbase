-- EPIK Sales Intelligence, initial schema.
-- Apply this file in the Supabase SQL editor, or with the Supabase CLI:
--   supabase db push
-- The statements are forward-only. A commented reset is at the bottom.

create extension if not exists pg_trgm;

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists integration_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into integration_settings (key, value)
values ('schema_version', '{"version":1}'::jsonb)
on conflict (key) do nothing;

create table if not exists slack_channels (
  slack_channel_id text primary key,
  display_name text,
  first_seen_at timestamptz not null default now()
);

create table if not exists slack_messages (
  id uuid primary key default gen_random_uuid(),
  slack_team_id text,
  slack_channel_id text not null references slack_channels (slack_channel_id),
  slack_channel_name text,
  slack_message_ts text not null,
  slack_event_id text,
  sender_id text,
  sender_name text,
  text text not null,
  thread_ts text,
  permalink text,
  subtype text,
  bot_id text,
  event_received_at timestamptz not null,
  processing_status text not null default 'received'
    check (processing_status in ('received', 'processing', 'processed', 'needs_review', 'failed', 'skipped')),
  retry_count integer not null default 0 check (retry_count >= 0 and retry_count <= 20),
  processing_error text,
  skip_reason text,
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slack_channel_id, slack_message_ts),
  unique (slack_event_id)
);

create index if not exists slack_messages_received_idx
  on slack_messages (event_received_at desc);
create index if not exists slack_messages_status_idx
  on slack_messages (processing_status, event_received_at desc);
create index if not exists slack_messages_channel_received_idx
  on slack_messages (slack_channel_id, event_received_at desc);
create index if not exists slack_messages_text_trgm
  on slack_messages using gin (text gin_trgm_ops);

drop trigger if exists slack_messages_updated_at on slack_messages;
create trigger slack_messages_updated_at
before update on slack_messages
for each row execute function set_updated_at();

-- Extracted values are unverified readings of Slack text.
-- verified_* columns are reserved for a later human check and are not written by this release.
create table if not exists message_extractions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null unique references slack_messages (id) on delete cascade,
  customer_name text,
  order_reference text,
  amount_text text,
  amount_minor bigint,
  currency text not null default 'INR',
  payment_mode_mention text,
  intent text not null check (intent in ('payment_mention', 'order_update', 'unclassified')),
  preview text not null,
  missing_fields text[] not null default '{}',
  extract_source text not null default 'rules' check (extract_source in ('rules', 'model')),
  verification text not null default 'unverified' check (verification = 'unverified'),
  verified_customer_name text,
  verified_order_reference text,
  verified_amount_minor bigint,
  verified_at timestamptz,
  verified_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists message_extractions_order_idx
  on message_extractions (order_reference);

drop trigger if exists message_extractions_updated_at on message_extractions;
create trigger message_extractions_updated_at
before update on message_extractions
for each row execute function set_updated_at();

create table if not exists exceptions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references slack_messages (id) on delete cascade,
  type text not null check (type in (
    'missing_info', 'ambiguous_amount', 'ambiguous_order',
    'potential_duplicate', 'parse_failure', 'conflicting_info'
  )),
  severity text not null check (severity in ('low', 'medium', 'high')),
  reason text not null,
  relevant_fields jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'resolved', 'superseded')),
  resolution_note text,
  resolved_at timestamptz,
  resolver text,
  created_at timestamptz not null default now()
);

create index if not exists exceptions_status_idx
  on exceptions (status, created_at desc);
create index if not exists exceptions_message_idx
  on exceptions (message_id);

create table if not exists processing_attempts (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references slack_messages (id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  started_at timestamptz not null,
  finished_at timestamptz,
  outcome text not null check (outcome in ('success', 'failure', 'skipped')),
  error_summary text
);

create index if not exists processing_attempts_message_idx
  on processing_attempts (message_id, attempt_number);

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  action text not null,
  entity_type text not null,
  entity_id text not null,
  outcome text not null check (outcome in ('success', 'failure')),
  actor text not null,
  summary text not null
);

create index if not exists audit_log_created_idx
  on audit_log (created_at desc);
create index if not exists audit_log_action_idx
  on audit_log (action, created_at desc);
create index if not exists audit_log_entity_idx
  on audit_log (entity_id);

create or replace function prevent_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

drop trigger if exists audit_log_no_update on audit_log;
create trigger audit_log_no_update
before update or delete on audit_log
for each row execute function prevent_audit_mutation();

create or replace function claim_slack_message(target uuid, max_attempts integer)
returns setof slack_messages
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update slack_messages
  set processing_status = 'processing'
  where id = target
    and retry_count < max_attempts
    and processing_status in ('received', 'failed')
  returning *;
end;
$$;

create or replace function reclaim_stuck_messages(max_age_seconds integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update slack_messages
  set processing_status = 'failed',
      processing_error = 'Processing was interrupted before completion.',
      retry_count = retry_count + 1
  where processing_status = 'processing'
    and updated_at < now() - make_interval(secs => max_age_seconds);
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function claim_slack_message(uuid, integer) from public, anon, authenticated;
revoke all on function reclaim_stuck_messages(integer) from public, anon, authenticated;
grant execute on function claim_slack_message(uuid, integer) to service_role;
grant execute on function reclaim_stuck_messages(integer) to service_role;

create or replace view inbox_rows
with (security_invoker = true) as
select
  m.id,
  m.event_received_at,
  m.slack_channel_id,
  m.sender_id,
  m.sender_name,
  m.text,
  m.processing_status,
  coalesce(c.display_name, m.slack_channel_name) as slack_channel_name,
  m.retry_count,
  m.processing_error,
  m.skip_reason,
  m.updated_at,
  e.customer_name,
  e.order_reference,
  coalesce(e.preview, left(regexp_replace(m.text, '\s+', ' ', 'g'), 180)) as preview,
  e.amount_text,
  e.amount_minor,
  e.payment_mode_mention,
  e.intent,
  e.extract_source,
  e.verification,
  exists (
    select 1 from exceptions x
    where x.message_id = m.id and x.status = 'open'
  ) as review_required
from slack_messages m
left join slack_channels c on c.slack_channel_id = m.slack_channel_id
left join message_extractions e on e.message_id = m.id;

-- The channel display name lives on slack_channels. Keep the message column in sync for the inbox.
create or replace view record_rows
with (security_invoker = true) as
select *
from inbox_rows
where intent in ('payment_mention', 'order_update');

grant select, insert, update, delete on integration_settings, slack_channels, slack_messages, message_extractions, exceptions, processing_attempts, audit_log to service_role;
grant select on inbox_rows, record_rows to service_role;

alter table integration_settings enable row level security;
alter table slack_channels enable row level security;
alter table slack_messages enable row level security;
alter table message_extractions enable row level security;
alter table exceptions enable row level security;
alter table processing_attempts enable row level security;
alter table audit_log enable row level security;

-- No policies for anon or authenticated. The browser does not query these tables.
-- The server uses the service role, which bypasses RLS, and only after the dashboard access check.
revoke all on table integration_settings from anon, authenticated;
revoke all on table slack_channels from anon, authenticated;
revoke all on table slack_messages from anon, authenticated;
revoke all on table message_extractions from anon, authenticated;
revoke all on table exceptions from anon, authenticated;
revoke all on table processing_attempts from anon, authenticated;
revoke all on table audit_log from anon, authenticated;
revoke all on table inbox_rows from anon, authenticated;
revoke all on table record_rows from anon, authenticated;

alter table slack_messages replica identity full;
alter table exceptions replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'slack_messages'
    ) then
      alter publication supabase_realtime add table public.slack_messages;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'exceptions'
    ) then
      alter publication supabase_realtime add table public.exceptions;
    end if;
  end if;
end $$;

-- Reset for a disposable development database only:
-- drop view if exists record_rows;
-- drop view if exists inbox_rows;
-- drop table if exists audit_log, processing_attempts, exceptions, message_extractions, slack_messages, slack_channels, integration_settings cascade;
-- drop function if exists claim_slack_message(uuid, integer);
-- drop function if exists reclaim_stuck_messages(integer);
-- drop function if exists prevent_audit_mutation();
-- drop function if exists set_updated_at();

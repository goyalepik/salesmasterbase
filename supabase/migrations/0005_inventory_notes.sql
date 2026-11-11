-- Notes on the Inventory view: a shared notes block (Piyush's notes) the whole team can read.
-- Only adds a new table: existing data is untouched. Safe to run more than once.

create table if not exists inventory_notes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  body text not null check (char_length(body) between 1 and 1000),
  author text not null,
  done boolean not null default false,
  done_at timestamptz,
  done_by text
);

create index if not exists inventory_notes_recent on inventory_notes (done, created_at desc);

alter table inventory_notes enable row level security;

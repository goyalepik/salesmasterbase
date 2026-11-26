-- Inventory Management System (/ims): what editors enter in the app itself. Additive only: run once in
-- Supabase → SQL Editor → New query → paste → Run. The sheets stay untouched; these rows merge with them by serial
-- or invoice. Bills (photos/PDFs) go in the private Storage bucket "ims-bills", created by the app on first upload.

create table if not exists ims_receipts (
  id text primary key,                       -- IMS-IN-00001
  created_at timestamptz not null default now(),
  created_by text not null,
  vendor text not null,
  invoice text not null,
  invoice_date date,
  po text,
  billed_to text,
  terms text not null default 'Cash and Carry',
  lines jsonb not null,                      -- [{sku, name, qty, unitCost, serials[], condition}]
  bill_path text,
  bill_name text,
  note text,
  voided boolean not null default false,
  voided_by text,
  voided_at timestamptz
);
create index if not exists ims_receipts_created_idx on ims_receipts (created_at desc);

create table if not exists ims_status (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  created_by text not null,
  kind text not null check (kind in ('po', 'dispatch')),
  ref text not null,                         -- PO line: 'PO|sku'; dispatched unit: serial or order id
  status text not null,
  eta date,
  note text
);
create index if not exists ims_status_ref_idx on ims_status (kind, ref, created_at desc);

-- History is append-only: nobody edits or deletes an update, a newer one replaces it on screen.
create or replace function ims_status_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'ims_status is append-only';
end $$;
drop trigger if exists ims_status_no_change on ims_status;
create trigger ims_status_no_change before update or delete on ims_status for each row execute function ims_status_append_only();

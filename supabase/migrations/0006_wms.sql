-- Warehouse (WMS): managed lists, PO headers, units with serials, unit history, goods receipts, shipments,
-- unit-to-order links, returns (RMA) and stock counts.
-- Additive only: no existing table, column, function or policy is changed. The stock ledger stays `stock_movements`;
-- purchase order lines stay `purchase_orders`. The app uses these only when WMS=on (or in demo mode).
-- Safe to run twice.

create table if not exists wms_masters (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('hub', 'vendor', 'billing_entity', 'logistics_partner', 'payment_term', 'delay_reason')),
  name text not null check (char_length(name) between 1 and 80),
  active boolean not null default true,
  sort integer not null default 0,
  -- 3PL partners: the tracking link with {awb} in it.
  note text,
  created_at timestamptz not null default now()
);
create unique index if not exists wms_masters_kind_name on wms_masters (kind, lower(name));

-- The PO's header. Its product lines are the purchase_orders rows with the same po_number.
create table if not exists wms_po_headers (
  po_number text primary key,
  vendor text not null,
  hub text,
  billed_to text,
  payment_terms text,
  priority text not null default 'normal' check (priority in ('normal', 'high', 'urgent')),
  eta date,
  notes text,
  -- [{ sku, unitCostMinor (incl. GST, paise), gstRate, ownership }]
  lines jsonb not null default '[]'::jsonb,
  created_by text not null,
  created_at timestamptz not null default now()
);

-- One row per physical unit.
create table if not exists wms_units (
  id uuid primary key,
  sku text not null references products (sku),
  serial text not null,
  serial_norm text not null,
  serial_source text not null check (serial_source in ('scan', 'manual', 'internal', 'opening')),
  alt_ids text[] not null default '{}',
  status text not null check (status in (
    'received', 'available', 'quarantine', 'reserved', 'picked', 'packed', 'dispatched', 'delivered',
    'return_initiated', 'return_in_transit', 'return_received', 'open_box_available', 'defective', 'rtv_pending',
    'returned_to_vendor', 'demo_deployed', 'transfer_in_transit', 'damaged', 'lost', 'written_off')),
  condition text not null check (condition in ('new_sealed', 'good', 'box_damaged', 'open_box', 'refurbished', 'defective', 'damaged', 'rto_returned')),
  hub text,
  ownership text check (ownership in ('CnC', 'SOR')),
  billed_to text,
  unit_cost_minor bigint check (unit_cost_minor is null or unit_cost_minor >= 0),
  gst_rate numeric,
  po_number text,
  grn_number text,
  vendor text,
  invoice_no text,
  remark text,
  photos text[] not null default '{}',
  received_at timestamptz not null default now(),
  received_by text not null,
  updated_at timestamptz not null default now()
);
-- A serial can be in stock only once per product. Units gone for good (returned to vendor, written off) free it.
create unique index if not exists wms_units_serial_live on wms_units (sku, serial_norm) where status not in ('returned_to_vendor', 'written_off');
create index if not exists wms_units_serial on wms_units (serial_norm);
create index if not exists wms_units_alt_ids on wms_units using gin (alt_ids);
create index if not exists wms_units_po on wms_units (po_number);
create index if not exists wms_units_sku_status on wms_units (sku, status);

-- Every change to a unit, oldest first. Append-only.
create table if not exists wms_unit_events (
  id bigserial primary key,
  unit_id uuid not null references wms_units (id) on delete cascade,
  at timestamptz not null default now(),
  by text not null,
  kind text not null check (kind in ('received', 'status', 'condition', 'note')),
  from_status text,
  to_status text,
  ref_type text,
  ref_id text,
  text text not null
);
create index if not exists wms_unit_events_unit on wms_unit_events (unit_id, at);

create or replace function wms_events_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'wms_unit_events is append-only';
end;
$$;
drop trigger if exists wms_unit_events_no_update on wms_unit_events;
create trigger wms_unit_events_no_update before update on wms_unit_events
for each row execute function wms_events_append_only();

-- Goods receipts.
create table if not exists wms_grns (
  number text primary key,
  po_number text not null,
  vendor text,
  hub text,
  invoice_no text,
  invoice_pending boolean not null default false,
  notes text,
  -- [{ sku, productName, pendingBefore, received, onHold, countOnly }]
  lines jsonb not null,
  unit_ids uuid[] not null default '{}',
  received_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists wms_grns_po on wms_grns (po_number, created_at desc);

-- Shipments (dispatch with AWB and tracking link), unit-to-order links, returns (RMA) and stock counts.
-- One table: the record is kept whole in `data`; the columns are what it is found by.
create table if not exists wms_records (
  kind text not null check (kind in ('shipment', 'link', 'rma', 'count')),
  id text not null,
  order_id text,
  unit_ids uuid[] not null default '{}',
  status text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (kind, id)
);
create index if not exists wms_records_order on wms_records (kind, order_id);
create index if not exists wms_records_units on wms_records using gin (unit_ids);
create index if not exists wms_records_status on wms_records (kind, status, created_at desc);

-- Counters for GRN, shipment, RMA and count numbers, and EPIK serials (EPK-U-000123).
create table if not exists wms_counters (
  name text primary key,
  value bigint not null default 0
);

-- Reserves `how_many` numbers in one step and returns the first.
create or replace function wms_next_number(counter text, how_many integer default 1)
returns bigint
language sql
as $$
  insert into wms_counters as c (name, value) values (counter, how_many)
  on conflict (name) do update set value = c.value + how_many
  returning value - how_many + 1;
$$;

-- Only the server (service role) reads and writes, like every other table.
alter table wms_masters enable row level security;
alter table wms_po_headers enable row level security;
alter table wms_units enable row level security;
alter table wms_unit_events enable row level security;
alter table wms_grns enable row level security;
alter table wms_counters enable row level security;
alter table wms_records enable row level security;

-- EPIK Operations: orders, stock ledger, procurement, dispatch, installation.
-- Forward-only. Apply after 0001_init.sql.
-- Stock is a ledger: on hand = sum(stock_movements.qty). Nothing stores a running count.

create sequence if not exists order_number_seq start 1;

create table if not exists ops_people (
  slack_user_id text primary key,
  name text not null,
  roles text[] not null default '{}',
  hub text,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  check (roles <@ array['sales','revops','inventory','procurement','logistics','installation','admin']::text[])
);

create table if not exists products (
  sku text primary key,
  name text not null,
  brand text,
  category text,
  channel text check (channel in ('SOR', 'CnC')),
  list_price_minor bigint,
  gst_rate numeric,
  hsn text,
  eol boolean not null default false,
  needs_installation boolean not null default false,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
create index if not exists products_name_trgm on products using gin (name gin_trgm_ops);
create index if not exists products_sku_trgm on products using gin (sku gin_trgm_ops);

create table if not exists orders (
  id text primary key default ('EPK-' || lpad(nextval('order_number_seq')::text, 6, '0')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  source text not null check (source in ('slack', 'desk', 'import')),
  stage text not null default 'awaiting_payment' check (stage in (
    'awaiting_payment','awaiting_inventory','awaiting_stock','ready_to_dispatch',
    'out_for_delivery','delivered','on_hold','cancelled')),
  stage_changed_at timestamptz not null default now(),
  customer_name text not null,
  phone text,
  email text,
  shipping_address text,
  pincode text,
  billing_address text,
  gst text,
  hub text,
  cx_type text,
  poc text,
  sale_source text,
  sale_type text,
  declared_payment_status text,
  declared_payment_mode text,
  notes text,
  shopify_order_id text,
  slack_channel_id text,
  slack_message_ts text,
  created_by text,
  offered_total_minor bigint not null default 0,
  paid_minor bigint not null default 0,
  cod_due_minor bigint not null default 0,
  driver text,
  expected_delivery_date date,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  hold_reason text,
  cancel_reason text,
  unique (slack_channel_id, slack_message_ts)
);
create index if not exists orders_stage_idx on orders (stage, created_at desc);
create index if not exists orders_created_idx on orders (created_at desc);
create index if not exists orders_customer_trgm on orders using gin (customer_name gin_trgm_ops);
create index if not exists orders_phone_idx on orders (phone);
create unique index if not exists orders_shopify_idx on orders (shopify_order_id) where shopify_order_id is not null;

drop trigger if exists orders_updated_at on orders;
create trigger orders_updated_at before update on orders for each row execute function set_updated_at();

create or replace function set_stage_changed_at()
returns trigger
language plpgsql
as $$
begin
  if new.stage is distinct from old.stage then
    new.stage_changed_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists orders_stage_changed on orders;
create trigger orders_stage_changed before update on orders for each row execute function set_stage_changed_at();

create table if not exists purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null,
  vendor text,
  sku text not null references products (sku),
  product_name text,
  qty_ordered integer not null check (qty_ordered > 0),
  qty_received integer not null default 0 check (qty_received >= 0),
  eta date,
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  created_at timestamptz not null default now(),
  unique (po_number, sku)
);
create index if not exists purchase_orders_open_idx on purchase_orders (sku) where status = 'open';

create table if not exists order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references orders (id) on delete cascade,
  line_no integer not null,
  sku text references products (sku),
  product_name text not null,
  qty integer not null default 1 check (qty > 0),
  list_price_minor bigint,
  offered_price_minor bigint not null check (offered_price_minor >= 0),
  accessories text,
  extended_warranty text,
  installation text,
  status text not null default 'pending' check (status in (
    'pending','reserved','awaiting_po','procuring','brand_direct','rejected','dispatched','cancelled')),
  po_id uuid references purchase_orders (id),
  procurement_id uuid,
  serial_no text,
  reject_reason text,
  unique (order_id, line_no)
);
create index if not exists order_lines_sku_idx on order_lines (sku, status);
create index if not exists order_lines_po_idx on order_lines (po_id) where status = 'awaiting_po';

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references orders (id) on delete cascade,
  amount_minor bigint not null check (amount_minor > 0),
  mode text not null,
  kind text not null check (kind in ('advance', 'full', 'balance', 'cod', 'finance')),
  reference text,
  status text not null default 'verified' check (status in ('verified', 'rejected')),
  recorded_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists payments_order_idx on payments (order_id);

create table if not exists stock_movements (
  id bigserial primary key,
  sku text not null references products (sku),
  qty integer not null check (qty <> 0),
  kind text not null check (kind in ('opening', 'inward', 'dispatch', 'return', 'rtv', 'adjust')),
  ref_type text,
  ref_id text,
  serial_no text,
  unit_cost_minor bigint,
  note text,
  actor text not null,
  created_at timestamptz not null default now()
);
create index if not exists stock_movements_sku_idx on stock_movements (sku, created_at desc);

create table if not exists reservations (
  id uuid primary key default gen_random_uuid(),
  order_line_id uuid not null references order_lines (id) on delete cascade,
  sku text not null references products (sku),
  qty integer not null check (qty > 0),
  status text not null default 'active' check (status in ('active', 'consumed', 'released')),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create unique index if not exists reservations_one_active on reservations (order_line_id) where status = 'active';
create index if not exists reservations_sku_active on reservations (sku) where status = 'active';

create table if not exists procurement_requests (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references orders (id) on delete cascade,
  line_id uuid not null references order_lines (id) on delete cascade,
  sku text references products (sku),
  product_name text not null,
  vendor text not null,
  cost_minor bigint,
  eta date,
  status text not null default 'requested' check (status in ('requested', 'ordered', 'received', 'cancelled')),
  po_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists procurement_open_idx on procurement_requests (status, eta);
drop trigger if exists procurement_updated_at on procurement_requests;
create trigger procurement_updated_at before update on procurement_requests for each row execute function set_updated_at();

create table if not exists installations (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references orders (id) on delete cascade,
  line_id uuid not null references order_lines (id) on delete cascade,
  sku text,
  product_name text not null,
  customer_name text not null,
  phone text,
  address text,
  status text not null default 'pending' check (status in ('pending', 'done', 'not_required')),
  due_date date not null,
  done_at timestamptz,
  technician text,
  note text,
  unique (line_id)
);
create index if not exists installations_status_idx on installations (status, due_date);

create table if not exists order_events (
  id bigserial primary key,
  order_id text not null references orders (id) on delete cascade,
  line_id uuid,
  type text not null,
  actor text not null,
  summary text not null,
  created_at timestamptz not null default now()
);
create index if not exists order_events_order_idx on order_events (order_id, created_at);
create index if not exists order_events_created_idx on order_events (created_at desc);

drop trigger if exists order_events_no_update on order_events;
create trigger order_events_no_update before update on order_events
for each row execute function prevent_audit_mutation();

-- Slack can deliver a button press twice. The first claim wins.
create table if not exists action_claims (
  key text primary key,
  created_at timestamptz not null default now()
);

create or replace view stock_levels
with (security_invoker = true) as
with moves as (
  select sku, sum(qty)::int as on_hand,
         (array_agg(unit_cost_minor order by created_at desc) filter (where unit_cost_minor is not null))[1] as unit_cost_minor
  from stock_movements group by sku
), held as (
  select sku, sum(qty)::int as reserved from reservations where status = 'active' group by sku
), incoming as (
  select sku, sum(qty_ordered - qty_received)::int as incoming, min(eta) as next_eta
  from purchase_orders where status = 'open' and qty_ordered > qty_received group by sku
)
select p.sku, p.name, p.brand, p.category, p.channel,
       coalesce(m.on_hand, 0) as on_hand,
       coalesce(h.reserved, 0) as reserved,
       coalesce(m.on_hand, 0) - coalesce(h.reserved, 0) as available,
       coalesce(i.incoming, 0) as incoming,
       i.next_eta,
       m.unit_cost_minor
from products p
left join moves m on m.sku = p.sku
left join held h on h.sku = p.sku
left join incoming i on i.sku = p.sku
where m.sku is not null or h.sku is not null or i.sku is not null;

-- Reserve one order line against free stock. Serialised per SKU so the last unit cannot go twice.
create or replace function ops_reserve_line(target uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  line order_lines%rowtype;
  free integer;
begin
  select * into line from order_lines where id = target for update;
  if not found then return 'missing'; end if;
  if line.sku is null then return 'no_sku'; end if;
  if exists (select 1 from reservations where order_line_id = target and status = 'active') then return 'already'; end if;
  perform pg_advisory_xact_lock(hashtext('stock:' || line.sku));
  select coalesce((select sum(qty) from stock_movements where sku = line.sku), 0)
       - coalesce((select sum(qty) from reservations where sku = line.sku and status = 'active'), 0)
    into free;
  if free < line.qty then return 'insufficient'; end if;
  insert into reservations (order_line_id, sku, qty) values (target, line.sku, line.qty);
  update order_lines set status = 'reserved', po_id = null where id = target;
  return 'ok';
end;
$$;

revoke all on function ops_reserve_line(uuid) from public, anon, authenticated;
grant execute on function ops_reserve_line(uuid) to service_role;

grant select, insert, update, delete on ops_people, products, orders, purchase_orders, order_lines, payments,
  stock_movements, reservations, procurement_requests, installations, order_events, action_claims to service_role;
grant usage, select on sequence order_number_seq to service_role;
grant usage, select on sequence stock_movements_id_seq, order_events_id_seq to service_role;
grant select on stock_levels to service_role;

alter table ops_people enable row level security;
alter table products enable row level security;
alter table orders enable row level security;
alter table purchase_orders enable row level security;
alter table order_lines enable row level security;
alter table payments enable row level security;
alter table stock_movements enable row level security;
alter table reservations enable row level security;
alter table procurement_requests enable row level security;
alter table installations enable row level security;
alter table order_events enable row level security;
alter table action_claims enable row level security;

revoke all on table ops_people, products, orders, purchase_orders, order_lines, payments, stock_movements,
  reservations, procurement_requests, installations, order_events, action_claims, stock_levels from anon, authenticated;

alter table orders replica identity full;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'orders') then
      alter publication supabase_realtime add table public.orders;
    end if;
  end if;
end $$;

-- Speeds up thread-reply lookups used by the older Slack inbox.
create index if not exists slack_messages_thread_idx on slack_messages (slack_channel_id, thread_ts) where thread_ts is not null;

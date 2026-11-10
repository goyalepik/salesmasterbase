-- Website sales: a CDE says "the customer will order on the website" (Slack short form).
-- When that website order arrives from Shopify, it is matched by phone and credited to the CDE.
-- Only adds a new table: existing data is untouched. Safe to run more than once.

create table if not exists web_sales (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  customer_name text not null,
  phone text not null,
  sku text,
  product_name text not null,
  poc text not null,
  sale_source text,
  notes text,
  slack_channel_id text,
  slack_message_ts text,
  created_by text,
  order_id text references orders (id) on delete set null,
  matched_at timestamptz,
  unique (slack_channel_id, slack_message_ts)
);

create index if not exists web_sales_open_phone on web_sales (phone, created_at) where order_id is null;

alter table web_sales enable row level security;

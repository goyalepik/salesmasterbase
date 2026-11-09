-- Marks which products are in the Shopify catalogue, so the Slack product list can show Shopify's products.
-- Only adds two empty columns: existing data is untouched. Safe to run more than once.

alter table products add column if not exists shopify_variant_id text;
alter table products add column if not exists shopify_status text;

create index if not exists products_shopify_idx on products (shopify_status, name) where shopify_variant_id is not null;

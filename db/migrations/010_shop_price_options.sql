-- Shop: pricing options (Alex, 2026-11-14). A product can be sold in several versions (기본 / VIP, 1명 / 2명…), each
-- with its own name, prices, crossed-out regular price, note and ActiveCampaign tag; the buyer picks one on the
-- checkout, right before the payment method. Instalment plans join the same picker in phase 3.
--
-- price_options: [] (sold at the product's own price) or 2–6 entries
--   { key, label, note, price_krw, price_usd, compare_krw, compare_usd, tag }
-- `key` never changes once saved (orders keep it). With options, the product's price_krw / price_usd are the first
-- option's (kept in step by the admin), so every list and check that reads them stays right.
ALTER TABLE shop_products ADD COLUMN price_options jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(price_options) = 'array');

-- The option an order was for, as sold: { key, label, tag } (null: the product has no options).
ALTER TABLE shop_orders ADD COLUMN price_option jsonb;

-- Shop: add-ons (an "order bump" offered on a product's checkout, in the manner of Marie Forleo's SamCart
-- checkouts; Alex, 2026-11-13). An add-on is a product of its own (its prices, tags and texts); a product lists the
-- add-ons its checkout offers. An order now holds items: its product, plus any add-ons the buyer ticked.

ALTER TABLE shop_products ADD COLUMN addon_ids   integer[] NOT NULL DEFAULT '{}';    -- add-ons offered on this product's checkout, in order
ALTER TABLE shop_products ADD COLUMN addon_only  boolean NOT NULL DEFAULT false;      -- sold only as an add-on (no checkout page of its own)
ALTER TABLE shop_products ADD COLUMN compare_krw integer CHECK (compare_krw >= 1000);  -- regular price, shown crossed out (won)
ALTER TABLE shop_products ADD COLUMN compare_usd integer CHECK (compare_usd >= 100);   -- regular price, shown crossed out (cents)

-- What one order bought, as sold. Amounts are in the order's currency, VAT included, and add up to the order's
-- total. vat_rule is fixed at the time of sale: the tax ledger lines of the order's payments are split by it.
CREATE TABLE shop_order_items (
  id         serial PRIMARY KEY,
  order_id   integer NOT NULL REFERENCES shop_orders(id),
  position   smallint NOT NULL CHECK (position >= 0),                 -- 0 = the product, then the add-ons in the order shown
  kind       text NOT NULL CHECK (kind IN ('main', 'addon')),
  product_id integer NOT NULL REFERENCES shop_products(id),
  name       text NOT NULL,                                           -- as sold
  amount     integer NOT NULL CHECK (amount >= 0),
  vat_rule   text NOT NULL CHECK (vat_rule IN ('taxable', 'zero')),
  UNIQUE (order_id, position)
);
CREATE INDEX shop_order_items_product ON shop_order_items (product_id);

-- Orders taken before add-ons existed: one item, their product.
INSERT INTO shop_order_items (order_id, position, kind, product_id, name, amount, vat_rule)
SELECT o.id, 0, 'main', o.product_id, o.product_name, o.total,
       CASE WHEN o.currency = 'USD' AND p.usd_vat = 'zero' THEN 'zero' ELSE 'taxable' END
  FROM shop_orders o JOIN shop_products p ON p.id = o.product_id
 WHERE NOT EXISTS (SELECT 1 FROM shop_order_items i WHERE i.order_id = o.id);

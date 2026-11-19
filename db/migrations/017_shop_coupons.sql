-- Coupons (phase 3; docs/commerce-plan.md 3.6 and section 12).
-- A campaign holds the discount rules (percent or a fixed amount per currency, products, dates, uses per person)
-- and the key of its ActiveCampaign tags (coupon_issued_<key>, coupon_used_<key>). Its codes are either shared
-- (anyone may type them, optionally a limited number of times) or individual (one person's email, used once).
-- Codes are never deleted once an order used them: they are disabled.

CREATE TABLE shop_coupon_campaigns (
  id              serial PRIMARY KEY,
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  key             text NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9]+(_[a-z0-9]+)*$' AND length(key) <= 40),
  kind            text NOT NULL CHECK (kind IN ('percent', 'amount')),
  percent         integer CHECK (percent BETWEEN 1 AND 99),
  amount_krw      integer CHECK (amount_krw > 0),            -- won
  amount_usd      integer CHECK (amount_usd > 0),            -- cents
  product_ids     integer[] NOT NULL DEFAULT '{}',           -- empty = every product
  link_product_id integer REFERENCES shop_products(id),      -- the checkout COUPON_LINK opens
  starts_at       timestamptz,
  ends_at         timestamptz,
  valid_days      integer CHECK (valid_days BETWEEN 1 AND 3650), -- individual codes: valid this many days from issue
  per_person      integer NOT NULL DEFAULT 1 CHECK (per_person BETWEEN 1 AND 100), -- paid orders per email, all codes
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  note            text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_coupon_campaigns_value CHECK (
    (kind = 'percent' AND percent IS NOT NULL AND amount_krw IS NULL AND amount_usd IS NULL)
    OR (kind = 'amount' AND percent IS NULL AND (amount_krw IS NOT NULL OR amount_usd IS NOT NULL))),
  CONSTRAINT shop_coupon_campaigns_dates CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE shop_coupons (
  id           serial PRIMARY KEY,
  campaign_id  integer NOT NULL REFERENCES shop_coupon_campaigns(id),
  code         text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{2,39}$'),
  owner_email  text CHECK (owner_email = lower(owner_email) AND owner_email LIKE '%@%'), -- NULL = shared code
  max_uses     integer CHECK (max_uses >= 1),               -- NULL = no limit
  expires_at   timestamptz,                                 -- individual codes; every code also ends with its campaign
  issued_by    text NOT NULL DEFAULT 'admin' CHECK (issued_by IN ('admin', 'ac')),
  disabled_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_coupons_individual CHECK (owner_email IS NULL OR max_uses = 1)
);
CREATE INDEX shop_coupons_campaign ON shop_coupons (campaign_id);
CREATE INDEX shop_coupons_owner ON shop_coupons (campaign_id, owner_email) WHERE owner_email IS NOT NULL;

ALTER TABLE shop_orders ADD COLUMN coupon_id integer REFERENCES shop_coupons(id);
ALTER TABLE shop_orders ADD COLUMN coupon_code text;
CREATE INDEX shop_orders_coupon ON shop_orders (coupon_id) WHERE coupon_id IS NOT NULL;

-- Unknown codes typed at the checkout, per network (HMAC, never the address): slows down guessing.
CREATE TABLE shop_coupon_misses (
  ip_hash  text NOT NULL,
  at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shop_coupon_misses_ip ON shop_coupon_misses (ip_hash, at);

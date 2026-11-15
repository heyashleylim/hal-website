-- Shop (e-commerce): products, customers, orders, payments, instalments and the tax ledger.
-- See docs/commerce-plan.md (section 4). Phase 1: foundations. Coupons, referrals and provider callbacks
-- get their own migrations in later phases.
--
-- Money is always a whole number in the currency's smallest unit: won for KRW, cents for USD.
-- Times are timestamptz (UTC in the database); the admin and the reports show Seoul time.

CREATE TABLE shop_products (
  id                 serial PRIMARY KEY,
  slug               text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),  -- /checkout/<slug>
  name               text NOT NULL,                                -- shown to customers (Korean)
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  sale_starts_at     timestamptz,                                  -- optional sale window (open products only)
  sale_ends_at       timestamptz,
  price_krw          integer CHECK (price_krw >= 1000),            -- won, VAT included (CiderPay minimum: 1,000)
  price_usd          integer CHECK (price_usd >= 100),             -- cents
  -- KRW instalment plan (CiderPay recurring): first payment today, then `count` monthly payments.
  instalment_first   integer CHECK (instalment_first >= 1000),
  instalment_monthly integer CHECK (instalment_monthly >= 1000),
  instalment_count   integer CHECK (instalment_count BETWEEN 1 AND 24),
  usd_vat            text NOT NULL DEFAULT 'taxable' CHECK (usd_vat IN ('taxable', 'zero')),  -- VAT treatment of USD sales
  purchase_tag       text NOT NULL DEFAULT '',                     -- ActiveCampaign tag added on purchase, e.g. purchased_eft
  extra_tags         text[] NOT NULL DEFAULT '{}',                 -- more AC tags added on purchase
  legacy_ids         integer[] NOT NULL DEFAULT '{}',              -- WooCommerce product ids (old ?product= links, import)
  content            jsonb NOT NULL DEFAULT '{}'::jsonb,           -- checkout texts: summary, included[], image, thanks
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (price_krw IS NOT NULL OR price_usd IS NOT NULL),
  CHECK (sale_starts_at IS NULL OR sale_ends_at IS NULL OR sale_starts_at < sale_ends_at),
  -- the plan is complete or absent, and needs a KRW price
  CHECK ((instalment_first IS NULL AND instalment_monthly IS NULL AND instalment_count IS NULL)
      OR (instalment_first IS NOT NULL AND instalment_monthly IS NOT NULL AND instalment_count IS NOT NULL AND price_krw IS NOT NULL))
);

CREATE TABLE shop_customers (
  id         serial PRIMARY KEY,
  email      text NOT NULL UNIQUE CHECK (email = lower(email)),
  name       text NOT NULL DEFAULT '',
  phone      text NOT NULL DEFAULT '',
  country    text NOT NULL DEFAULT '',     -- ISO code, 'KR' for KRW orders
  postcode   text NOT NULL DEFAULT '',
  address1   text NOT NULL DEFAULT '',
  address2   text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Order numbers start well above WooCommerce's ids, so an old and a new order can never share a number.
CREATE SEQUENCE shop_order_number START 100001;

CREATE TABLE shop_orders (
  id             serial PRIMARY KEY,
  number         integer NOT NULL UNIQUE DEFAULT nextval('shop_order_number'),
  token          text NOT NULL UNIQUE,                 -- random; the customer's order-status link
  customer_id    integer NOT NULL REFERENCES shop_customers(id),
  product_id     integer NOT NULL REFERENCES shop_products(id),
  product_name   text NOT NULL,                        -- as sold (the product can be renamed later)
  currency       text NOT NULL CHECK (currency IN ('KRW', 'USD')),
  plan           text NOT NULL DEFAULT 'full' CHECK (plan IN ('full', 'instalment')),
  subtotal       integer NOT NULL CHECK (subtotal >= 0),    -- price before discounts
  discount       integer NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total          integer NOT NULL CHECK (total >= 0),       -- what the customer pays in all (instalments included)
  paid_total     integer NOT NULL DEFAULT 0 CHECK (paid_total >= 0),
  refunded_total integer NOT NULL DEFAULT 0 CHECK (refunded_total >= 0),
  status         text NOT NULL DEFAULT 'created' CHECK (status IN
                   ('created', 'awaiting_payment', 'paid', 'refund_requested', 'partially_refunded', 'refunded', 'expired', 'cancelled')),
  plan_status    text CHECK (plan_status IN ('active', 'overdue', 'paused', 'completed', 'stopped')),  -- instalment orders only
  rp_token       text,                                 -- CiderPay recurring agreement (pause, stop)
  billing        jsonb NOT NULL DEFAULT '{}'::jsonb,   -- name, phone, address as given for this order
  source         jsonb NOT NULL DEFAULT '{}'::jsonb,   -- campaign values captured at checkout (utm…)
  origin         text NOT NULL DEFAULT 'site' CHECK (origin IN ('site', 'manual', 'imported')),
  legacy_id      integer UNIQUE,                       -- WooCommerce order id (imported orders)
  note           text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  paid_at        timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (total = subtotal - discount),
  CHECK ((plan = 'instalment') = (plan_status IS NOT NULL) OR status IN ('created', 'awaiting_payment', 'expired', 'cancelled'))
);
CREATE INDEX shop_orders_customer ON shop_orders (customer_id);
CREATE INDEX shop_orders_created ON shop_orders (created_at);
CREATE INDEX shop_orders_status ON shop_orders (status);

-- Every movement of money reported by a provider (or entered by hand).
CREATE TABLE shop_payments (
  id            serial PRIMARY KEY,
  order_id      integer NOT NULL REFERENCES shop_orders(id),
  provider      text NOT NULL CHECK (provider IN ('ciderpay', 'paypal', 'manual', 'imported')),
  kind          text NOT NULL CHECK (kind IN ('payment', 'refund')),
  currency      text NOT NULL CHECK (currency IN ('KRW', 'USD')),
  amount        integer NOT NULL CHECK (amount > 0),   -- always positive; `kind` says the direction
  fee           integer,                               -- provider fee when known (PayPal), same unit
  instalment_no integer,                               -- 1 = first payment of a plan
  provider_ref  text,                                  -- CiderPay orderNo / PayPal capture or refund id
  approval_no   text,                                  -- card approval number
  refund_token  text,                                  -- CiderPay feedbackToken (needed to refund)
  method        text NOT NULL DEFAULT '',              -- card company, 'paypal', 'bank transfer'…
  receipt_url   text,
  raw           jsonb NOT NULL DEFAULT '{}'::jsonb,    -- the provider's notice, as received
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shop_payments_order ON shop_payments (order_id);
-- A provider's notice is accepted once.
CREATE UNIQUE INDEX shop_payments_ref ON shop_payments (provider, kind, provider_ref) WHERE provider_ref IS NOT NULL;

CREATE TABLE shop_instalments (
  id         serial PRIMARY KEY,
  order_id   integer NOT NULL REFERENCES shop_orders(id),
  number     integer NOT NULL CHECK (number >= 1),      -- 1 = paid at checkout
  due_date   date NOT NULL,                             -- Seoul date
  amount     integer NOT NULL CHECK (amount > 0),
  status     text NOT NULL DEFAULT 'due' CHECK (status IN ('due', 'paid', 'failed', 'overdue', 'cancelled')),
  payment_id integer REFERENCES shop_payments(id),
  error      text NOT NULL DEFAULT '',                  -- the provider's message when a charge failed
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, number)
);
CREATE INDEX shop_instalments_due ON shop_instalments (due_date) WHERE status IN ('due', 'failed', 'overdue');

-- The tax ledger: one permanent line per movement of money. Sales are positive, refunds negative.
-- Lines are never changed or deleted (a correction is a new line); only the exchange-rate columns of a
-- USD line can be filled in or corrected afterwards. The trigger below enforces this.
CREATE TABLE shop_ledger (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL,                      -- when the money moved
  order_id    integer NOT NULL REFERENCES shop_orders(id),
  payment_id  integer REFERENCES shop_payments(id),
  kind        text NOT NULL CHECK (kind IN ('sale', 'instalment', 'refund')),
  provider    text NOT NULL,
  method      text NOT NULL DEFAULT '',
  currency    text NOT NULL CHECK (currency IN ('KRW', 'USD')),
  amount      integer NOT NULL,                          -- signed, VAT included
  supply      integer NOT NULL,                          -- 공급가액 (signed)
  vat         integer NOT NULL,                          -- 부가세 (signed); supply + vat = amount
  vat_rule    text NOT NULL CHECK (vat_rule IN ('taxable', 'zero')),
  fee         integer,                                   -- provider fee (signed like amount), when known
  fx_rate     numeric(12, 4),                            -- USD lines: won per dollar used
  fx_source   text,                                      -- where the rate came from
  amount_krw  integer,                                   -- USD lines: won value (signed)
  note        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (supply + vat = amount)
);
CREATE INDEX shop_ledger_at ON shop_ledger (at);
CREATE INDEX shop_ledger_order ON shop_ledger (order_id);

CREATE FUNCTION shop_ledger_keep() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'shop_ledger lines are permanent: add a correcting line instead';
  END IF;
  IF (NEW.id, NEW.at, NEW.order_id, NEW.payment_id, NEW.kind, NEW.provider, NEW.method, NEW.currency,
      NEW.amount, NEW.supply, NEW.vat, NEW.vat_rule, NEW.fee, NEW.note, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.at, OLD.order_id, OLD.payment_id, OLD.kind, OLD.provider, OLD.method, OLD.currency,
      OLD.amount, OLD.supply, OLD.vat, OLD.vat_rule, OLD.fee, OLD.note, OLD.created_at) THEN
    RAISE EXCEPTION 'shop_ledger lines are permanent: only the exchange-rate columns can change';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER shop_ledger_keep BEFORE UPDATE OR DELETE ON shop_ledger
  FOR EACH ROW EXECUTE FUNCTION shop_ledger_keep();

-- Shop settings edited in the admin (texts, switches). Secrets never go here: they stay in Vercel env vars.
CREATE TABLE shop_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

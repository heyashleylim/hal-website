-- Shop phase 2: checkout and payments (docs/commerce-plan.md).
-- Orders remember which provider was asked for payment, how much is due at checkout, and whether the
-- purchase was reported to analytics. New: every provider notice received (shop_callbacks) and the queue of
-- ActiveCampaign updates for customers (shop_outbox; the podcast's ac_outbox is tied to students).

ALTER TABLE shop_orders ADD COLUMN provider text CHECK (provider IN ('ciderpay', 'paypal'));
ALTER TABLE shop_orders ADD COLUMN provider_request text;          -- CiderPay payUniqueNo / PayPal order id
ALTER TABLE shop_orders ADD COLUMN due_today integer NOT NULL DEFAULT 0 CHECK (due_today >= 0);  -- charged at checkout
ALTER TABLE shop_orders ALTER COLUMN due_today DROP DEFAULT;
ALTER TABLE shop_orders ADD COLUMN ip_hash text;                   -- HMAC of the buyer's IP (rate limit), never the IP
ALTER TABLE shop_orders ADD COLUMN tracked_at timestamptz;         -- when the purchase event was sent to GTM
-- One order per provider request: a PayPal order id or CiderPay request can only ever belong to one order.
CREATE UNIQUE INDEX shop_orders_provider_request ON shop_orders (provider, provider_request) WHERE provider_request IS NOT NULL;
CREATE INDEX shop_orders_ip ON shop_orders (ip_hash, created_at) WHERE ip_hash IS NOT NULL;

ALTER TABLE shop_customers ADD COLUMN ac_contact_id text;          -- ActiveCampaign contact, once known

-- Every notice a payment provider sends us, accepted or not: the audit trail behind each payment.
CREATE TABLE shop_callbacks (
  id       bigserial PRIMARY KEY,
  at       timestamptz NOT NULL DEFAULT now(),
  provider text NOT NULL,                      -- 'ciderpay' | 'paypal'
  outcome  text NOT NULL,                      -- 'paid', 'duplicate', 'extra', 'rejected', 'ignored', 'error'
  reason   text NOT NULL DEFAULT '',           -- why it was rejected or ignored
  order_id integer REFERENCES shop_orders(id),
  payload  jsonb NOT NULL DEFAULT '{}'::jsonb  -- as received (card numbers arrive already masked)
);
CREATE INDEX shop_callbacks_at ON shop_callbacks (at);
CREATE INDEX shop_callbacks_order ON shop_callbacks (order_id);

-- ActiveCampaign updates for shop customers, sent after the payment is recorded and retried until they pass.
CREATE TABLE shop_outbox (
  id              bigserial PRIMARY KEY,
  customer_id     integer NOT NULL REFERENCES shop_customers(id),
  order_id        integer REFERENCES shop_orders(id),
  op              text NOT NULL CHECK (op IN ('contact', 'tag_add', 'tag_remove', 'fields')),
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key      text UNIQUE,                 -- the same fact is only ever queued once
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  done_at         timestamptz
);
CREATE INDEX shop_outbox_pending ON shop_outbox (next_attempt_at) WHERE status = 'pending';
CREATE INDEX shop_outbox_order ON shop_outbox (order_id);

-- Shop phase 3: refunds (docs/commerce-plan.md, 3.2 "Refund or cancellation: one click, everything follows").
--
-- A refund is asked for in the admin (the provider is called: CiderPay cancel / cancel request, PayPal refund), made
-- inside PayPal (its webhook tells us), or made in CiderPay's dashboard and recorded by a person. Each one is a row
-- here; once the money has gone back it also becomes a shop_payments row (kind 'refund') with its negative tax lines.
--
-- Money is never refunded twice: an order reserves the amount (refund_pending) before the provider is called, by a
-- single UPDATE that only succeeds while paid − refunded − pending covers it.

ALTER TABLE shop_orders ADD COLUMN refund_pending integer NOT NULL DEFAULT 0 CHECK (refund_pending >= 0);
ALTER TABLE shop_orders ADD CONSTRAINT shop_orders_refund_fits CHECK (refunded_total + refund_pending <= paid_total);

-- A refund payment points at the payment it gives back.
ALTER TABLE shop_payments ADD COLUMN refund_of integer REFERENCES shop_payments(id);

CREATE TABLE shop_refunds (
  id                serial PRIMARY KEY,
  order_id          integer NOT NULL REFERENCES shop_orders(id),
  payment_id        integer NOT NULL REFERENCES shop_payments(id),   -- the payment given back (all or part of it)
  provider          text NOT NULL CHECK (provider IN ('ciderpay', 'paypal', 'manual')),
  currency          text NOT NULL CHECK (currency IN ('KRW', 'USD')),
  amount            integer NOT NULL CHECK (amount > 0),
  reason            text NOT NULL DEFAULT '',
  by                text NOT NULL DEFAULT '',                         -- the admin who asked, or 'PayPal'
  -- admin:    asked in the admin, the provider was called
  -- provider: made inside PayPal, learnt from its webhook
  -- recorded: made at the provider (CiderPay's dashboard…), written down here by a person
  origin            text NOT NULL CHECK (origin IN ('admin', 'provider', 'recorded')),
  -- sending:   the provider is being called
  -- requested: CiderPay accepted a cancel request (after settlement): waits for its CANCEL notice
  -- check:     the call's answer never came: a person checks the provider's dashboard and says what happened
  -- done:      the money went back (payment + tax lines written)
  -- failed:    the provider refused; nothing was refunded
  status            text NOT NULL CHECK (status IN ('sending', 'requested', 'check', 'done', 'failed')),
  provider_ref      text,                                             -- PayPal refund id
  fee               integer,                                          -- PayPal fee given back, when known
  refund_payment_id integer REFERENCES shop_payments(id),
  error             text NOT NULL DEFAULT '',
  notice_at         timestamptz,                                      -- when the provider's own notice of it arrived
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  done_at           timestamptz
);
CREATE INDEX shop_refunds_order ON shop_refunds (order_id);
CREATE UNIQUE INDEX shop_refunds_ref ON shop_refunds (provider, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX shop_refunds_open ON shop_refunds (status) WHERE status IN ('sending', 'requested', 'check');

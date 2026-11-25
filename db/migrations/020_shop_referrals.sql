-- Referral program, first part (docs/commerce-plan.md 3.5 and section 17): personal links, the friend's discount,
-- who referred which order, and the referrer's rewards (pending → approved, or cancelled by a refund).
-- How rewards are paid out (cash or credit at checkout) waits for the accountant (O2): nothing here pays anything.
--
-- The friend's discount is a coupon campaign marked `referral` (one at most): its discount, products, dates and
-- uses per person are the coupon rules. Each referrer's code is a shared coupon of that campaign, tied to them.

CREATE TABLE shop_referrers (
  id           serial PRIMARY KEY,
  customer_id  integer NOT NULL UNIQUE REFERENCES shop_customers(id),
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'banned')),
  note         text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE shop_coupon_campaigns ADD COLUMN referral boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX shop_coupon_campaigns_one_referral ON shop_coupon_campaigns (referral) WHERE referral;

ALTER TABLE shop_coupons ADD COLUMN referrer_id integer REFERENCES shop_referrers(id);
CREATE UNIQUE INDEX shop_coupons_referrer ON shop_coupons (referrer_id) WHERE referrer_id IS NOT NULL;

-- The referrer's reward for a product: a percentage of the money received, or a fixed amount per order (per
-- currency). None = no reward for that product.
ALTER TABLE shop_products ADD COLUMN reward_kind text CHECK (reward_kind IN ('percent', 'amount'));
ALTER TABLE shop_products ADD COLUMN reward_percent integer CHECK (reward_percent BETWEEN 1 AND 50);
ALTER TABLE shop_products ADD COLUMN reward_krw integer CHECK (reward_krw > 0);
ALTER TABLE shop_products ADD COLUMN reward_usd integer CHECK (reward_usd > 0);   -- cents
ALTER TABLE shop_products ADD CONSTRAINT shop_products_reward CHECK (
  reward_kind IS NULL AND reward_percent IS NULL AND reward_krw IS NULL AND reward_usd IS NULL
  OR reward_kind = 'percent' AND reward_percent IS NOT NULL AND reward_krw IS NULL AND reward_usd IS NULL
  OR reward_kind = 'amount' AND reward_percent IS NULL AND (reward_krw IS NOT NULL OR reward_usd IS NOT NULL));

-- An order bought through a referral: the referrer, and the reward rule as it was when the order was made.
ALTER TABLE shop_orders ADD COLUMN referrer_id integer REFERENCES shop_referrers(id);
ALTER TABLE shop_orders ADD COLUMN referral_reward jsonb;   -- { kind, percent } | { kind, amount } (in the order's currency)
CREATE INDEX shop_orders_referrer ON shop_orders (referrer_id) WHERE referrer_id IS NOT NULL;

-- One reward per payment received on a referred order ("follows the money received"). pending until the refund
-- window has passed (approve_after), then approved; a refund lowers or cancels the pending ones.
CREATE TABLE shop_rewards (
  id             serial PRIMARY KEY,
  referrer_id    integer NOT NULL REFERENCES shop_referrers(id),
  order_id       integer NOT NULL REFERENCES shop_orders(id),
  payment_id     integer NOT NULL UNIQUE REFERENCES shop_payments(id),
  currency       text NOT NULL CHECK (currency IN ('KRW', 'USD')),
  amount         integer NOT NULL CHECK (amount >= 0),     -- what it is worth now (lowered by a refund)
  earned         integer NOT NULL CHECK (earned >= 0),     -- what the payment first earned
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'cancelled')),
  approve_after  timestamptz NOT NULL,
  approved_at    timestamptz,
  cancelled_at   timestamptz,
  note           text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shop_rewards_referrer ON shop_rewards (referrer_id, status);
CREATE INDEX shop_rewards_order ON shop_rewards (order_id);

-- Visits of /r/<code>, per referrer and Seoul day (no personal data).
CREATE TABLE shop_referral_clicks (
  referrer_id  integer NOT NULL REFERENCES shop_referrers(id),
  day          date NOT NULL,
  clicks       integer NOT NULL DEFAULT 0,
  PRIMARY KEY (referrer_id, day)
);

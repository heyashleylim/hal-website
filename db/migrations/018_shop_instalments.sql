-- Instalment plans (phase 3; docs/commerce-plan.md 3.2 and section 14).
-- The schedule (shop_instalments) and the plan's state (shop_orders.plan_status, rp_token) exist since 005.
-- New: what the CiderPay agreement looked like, when it was ended at CiderPay, and a guard against recording two
-- payments for one instalment.

ALTER TABLE shop_orders ADD COLUMN rp_card text;                 -- last 4 digits of the card the plan charges
ALTER TABLE shop_orders ADD COLUMN rp_closed_at timestamptz;     -- the agreement was ended at CiderPay (destroyMp)
ALTER TABLE shop_orders ADD COLUMN plan_terms jsonb;             -- { first, monthly, count, day } as sold

-- One payment per instalment (a second one for the same instalment is held for a person, never recorded).
CREATE UNIQUE INDEX shop_payments_instalment ON shop_payments (order_id, instalment_no)
  WHERE kind = 'payment' AND instalment_no IS NOT NULL;

-- When the missed-instalment alert went out (once per instalment), and how it was settled when not by CiderPay.
ALTER TABLE shop_instalments ADD COLUMN alerted_at timestamptz;
ALTER TABLE shop_instalments ADD COLUMN note text NOT NULL DEFAULT '';

CREATE INDEX shop_orders_plan_running ON shop_orders (plan_status) WHERE plan_status IN ('active', 'overdue', 'paused');

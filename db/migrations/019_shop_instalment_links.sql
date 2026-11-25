-- A payment link for one instalment (Alex, 2026-11-20): a missed instalment paid by card from a link the admin sends,
-- recorded by CiderPay's notice like any charge. The link works LINK_DAYS days from when it was made.
ALTER TABLE shop_instalments ADD COLUMN link_at timestamptz;

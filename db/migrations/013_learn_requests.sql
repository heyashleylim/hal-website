-- Student area: every sign-in code request, to limit requests per network (an email that isn't a purchaser
-- creates no code, but still costs an ActiveCampaign lookup). Only hashes; deleted after 30 days by the daily job.
CREATE TABLE learn_requests (
  id         bigserial PRIMARY KEY,
  ip_hash    text,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX learn_requests_ip ON learn_requests (ip_hash, at);

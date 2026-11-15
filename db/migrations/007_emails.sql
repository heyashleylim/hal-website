-- Emails section (/admin/emails): every email Ashley has sent, in one place, with its performance.
--
-- Two sources:
--   import  the spreadsheet of emails sent before/outside ActiveCampaign (uploaded in /admin/emails/sync)
--   ac      ActiveCampaign campaigns, read by api/_lib/emails/ac-sync.js (daily job + "Sync now")
-- The performance score is never stored: api/_lib/emails/score.js computes it from these numbers on every read,
-- so it always follows the latest stats.

CREATE TABLE emails (
  id             serial PRIMARY KEY,
  source         text NOT NULL CHECK (source IN ('import', 'ac')),
  source_ref     text NOT NULL,                       -- ac: the campaign id; import: a hash of send time + campaign name
  kind           text NOT NULL DEFAULT 'campaign' CHECK (kind IN ('campaign', 'automation')),  -- automation: sent one by one by an AC automation
  name           text NOT NULL,                       -- campaign name (internal)
  subject        text NOT NULL DEFAULT '',
  preheader      text NOT NULL DEFAULT '',
  body_text      text NOT NULL DEFAULT '',            -- what the admin shows and searches
  body_html      text,                                -- ac only: the designed version
  has_link       boolean,                             -- does the email have something to click? NULL = unknown (import)
  ac_message_id  text,                                -- ac only: the message holding subject and body
  body_synced_at timestamptz,                         -- ac only: NULL until subject and body have been fetched
  sent_at        timestamptz NOT NULL,                -- first send
  last_sent_at   timestamptz,                         -- ac only: latest send (automation emails keep going out)
  sent           integer NOT NULL DEFAULT 0 CHECK (sent >= 0),
  opened         integer NOT NULL DEFAULT 0 CHECK (opened >= 0),          -- people, not opens
  clicked        integer NOT NULL DEFAULT 0 CHECK (clicked >= 0),         -- people, not clicks
  unsubscribed   integer NOT NULL DEFAULT 0 CHECK (unsubscribed >= 0),
  bounced        integer NOT NULL DEFAULT 0 CHECK (bounced >= 0),
  stats_at       timestamptz,                         -- when the numbers were last refreshed
  resend         text NOT NULL DEFAULT '' CHECK (resend IN ('', 'yes', 'maybe', 'no', 'done')),  -- send it again? done = it was sent again
  note           text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_ref)
);
CREATE INDEX emails_sent_at ON emails (sent_at DESC);

-- One line per ActiveCampaign sync (daily job or "Sync now"), so the admin can show when stats were last refreshed.
CREATE TABLE email_sync_runs (
  id          serial PRIMARY KEY,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  trigger     text NOT NULL CHECK (trigger IN ('cron', 'admin')),
  ok          boolean,
  summary     jsonb NOT NULL DEFAULT '{}'::jsonb,
  error       text
);
CREATE INDEX email_sync_runs_started ON email_sync_runs (started_at DESC);

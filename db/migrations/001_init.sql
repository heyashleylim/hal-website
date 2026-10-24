-- Private podcast: core tables. See docs/podcast-plan.md (section 3).
-- Times are timestamptz (UTC in the database); dates and release times are interpreted in shows.timezone.

CREATE TABLE shows (
  id                 serial PRIMARY KEY,
  slug               text NOT NULL UNIQUE,                 -- 'nsmb'
  title              text NOT NULL,
  description        text NOT NULL DEFAULT '',
  author             text NOT NULL DEFAULT '',
  owner_email        text NOT NULL DEFAULT '',
  artwork_url        text,
  category           text NOT NULL DEFAULT 'Education',
  language           text NOT NULL DEFAULT 'ko',
  copyright          text NOT NULL DEFAULT '',
  timezone           text NOT NULL DEFAULT 'Asia/Seoul',
  release_time       text NOT NULL DEFAULT '09:00' CHECK (release_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  drip_interval_days integer NOT NULL DEFAULT 7 CHECK (drip_interval_days >= 0),
  access_days        integer NOT NULL DEFAULT 365 CHECK (access_days > 0),
  support_email      text NOT NULL DEFAULT '',
  page_intro         text NOT NULL DEFAULT '',
  ac_tag_prefix      text NOT NULL DEFAULT 'podcast-nsmb',     -- tags the site adds: <prefix>-subscribed, <prefix>-ep03-released…
  settings           jsonb NOT NULL DEFAULT '{}'::jsonb,       -- AC field names and other small options
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE episodes (
  id               serial PRIMARY KEY,
  show_id          integer NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  guid             uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,  -- stable RSS guid, never changes
  kind             text NOT NULL DEFAULT 'module' CHECK (kind IN ('module', 'bonus')),
  number           integer,                                         -- module number (1–12); null for bonus
  title            text NOT NULL,
  notes            text NOT NULL DEFAULT '',
  day_offset       integer NOT NULL DEFAULT 0 CHECK (day_offset >= 0),  -- days after the cohort start
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  blob_pathname    text,
  bytes            bigint,
  duration_seconds integer,
  mime_type        text NOT NULL DEFAULT 'audio/mpeg',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX episodes_module_number ON episodes (show_id, number) WHERE kind = 'module';

CREATE TABLE cohorts (
  id          serial PRIMARY KEY,
  show_id     integer NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  name        text NOT NULL,                       -- '1기'
  ac_tag      text NOT NULL,                       -- AC tag that puts a contact in this cohort, e.g. 'nsmb-1기'
  start_date  date NOT NULL,
  access_days integer CHECK (access_days > 0),     -- null = the show's default
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (show_id, name)
);
CREATE UNIQUE INDEX cohorts_ac_tag ON cohorts (show_id, lower(ac_tag));

-- Per-cohort release date for one episode (e.g. skip a holiday week).
CREATE TABLE cohort_episode_dates (
  cohort_id  integer NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  episode_id integer NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  release_at timestamptz NOT NULL,
  PRIMARY KEY (cohort_id, episode_id)
);

CREATE TABLE listeners (
  id               serial PRIMARY KEY,
  show_id          integer NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  cohort_id        integer REFERENCES cohorts(id) ON DELETE SET NULL,   -- null = "needs a cohort"
  email            text NOT NULL,
  name             text NOT NULL DEFAULT '',
  ac_contact_id    text,
  token            text NOT NULL UNIQUE,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  start_override   date,           -- own schedule instead of the cohort's
  expires_override timestamptz,    -- set by hand; null = cohort start + access days
  source           text NOT NULL DEFAULT 'manual' CHECK (source IN ('webhook', 'import', 'manual')),
  first_seen_at    timestamptz,    -- first podcast-app request (subscribed)
  last_seen_at     timestamptz,
  revoked_at       timestamptz,
  notes            text NOT NULL DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX listeners_email ON listeners (show_id, lower(email));
CREATE INDEX listeners_cohort ON listeners (cohort_id);

-- Raw requests from podcast apps (feed checks and audio downloads). Deleted after 13 months.
CREATE TABLE events (
  id          bigserial PRIMARY KEY,
  listener_id integer NOT NULL REFERENCES listeners(id) ON DELETE CASCADE,
  episode_id  integer REFERENCES episodes(id) ON DELETE SET NULL,
  kind        text NOT NULL CHECK (kind IN ('feed', 'download')),
  at          timestamptz NOT NULL DEFAULT now(),
  app         text,
  user_agent  text,
  ip_hash     text,
  country     text
);
CREATE INDEX events_listener_at ON events (listener_id, at);
CREATE INDEX events_episode_at ON events (episode_id, at) WHERE episode_id IS NOT NULL;

-- Pending ActiveCampaign operations, retried until done. dedupe_key makes each operation happen once.
CREATE TABLE ac_outbox (
  id              bigserial PRIMARY KEY,
  listener_id     integer REFERENCES listeners(id) ON DELETE CASCADE,
  op              text NOT NULL CHECK (op IN ('tag_add', 'tag_remove', 'fields')),
  payload         jsonb NOT NULL,
  dedupe_key      text UNIQUE,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  done_at         timestamptz
);
CREATE INDEX ac_outbox_pending ON ac_outbox (next_attempt_at) WHERE status = 'pending';

CREATE TABLE webhook_log (
  id      bigserial PRIMARY KEY,
  at      timestamptz NOT NULL DEFAULT now(),
  source  text NOT NULL,          -- 'ac'
  payload jsonb NOT NULL,
  result  text NOT NULL,          -- 'enrolled', 'revoked', 'no-cohort-tag', 'error: …'
  listener_id integer REFERENCES listeners(id) ON DELETE SET NULL
);

CREATE TABLE admin_log (
  id      bigserial PRIMARY KEY,
  at      timestamptz NOT NULL DEFAULT now(),
  admin   text NOT NULL,
  action  text NOT NULL,
  target  text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

INSERT INTO shows (slug, title, author) VALUES ('nsmb', '내성만방', '애슐리 림');

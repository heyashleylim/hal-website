-- Several shows, one student (person) with one personal link, enrolled in any number of cohorts
-- (of any show, including several cohorts of the same show). Replaces listeners (one row per show).
-- Existing listeners become students (same token, so their podcast apps keep working) with one enrolment.

CREATE TABLE students (
  id            serial PRIMARY KEY,
  email         text NOT NULL,
  name          text NOT NULL DEFAULT '',
  token         text NOT NULL UNIQUE,                 -- personal link: /podcast/<token>, feeds /f/<token>/<show>
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),  -- revoked = every show
  ac_contact_id text,
  notes         text NOT NULL DEFAULT '',
  first_seen_at timestamptz,                          -- first request from a podcast app (any show)
  last_seen_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX students_email ON students (lower(email));

CREATE TABLE enrollments (
  id               serial PRIMARY KEY,
  student_id       integer NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  cohort_id        integer NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  start_override   date,           -- own schedule instead of the cohort's
  expires_override timestamptz,    -- set by hand; null = cohort start + access days
  source           text NOT NULL DEFAULT 'manual' CHECK (source IN ('webhook', 'import', 'manual', 'ac-sync')),
  revoked_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, cohort_id)
);
CREATE INDEX enrollments_cohort ON enrollments (cohort_id);

INSERT INTO students (id, email, name, token, status, ac_contact_id, notes, first_seen_at, last_seen_at, revoked_at, created_at, updated_at)
SELECT DISTINCT ON (lower(email)) id, email, name, token, status, ac_contact_id, notes, first_seen_at, last_seen_at, revoked_at, created_at, updated_at
  FROM listeners ORDER BY lower(email), id;
SELECT setval('students_id_seq', GREATEST((SELECT max(id) FROM students), 1));

INSERT INTO enrollments (student_id, cohort_id, start_override, expires_override, source, created_at)
SELECT s.id, l.cohort_id, l.start_override, l.expires_override, l.source, l.created_at
  FROM listeners l JOIN students s ON lower(s.email) = lower(l.email)
 WHERE l.cohort_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Events and AC operations now point to the student; feed checks also record which show.
ALTER TABLE events ADD COLUMN student_id integer REFERENCES students(id) ON DELETE CASCADE;
ALTER TABLE events ADD COLUMN show_id integer REFERENCES shows(id) ON DELETE CASCADE;
UPDATE events e SET student_id = s.id, show_id = l.show_id
  FROM listeners l JOIN students s ON lower(s.email) = lower(l.email) WHERE e.listener_id = l.id;
ALTER TABLE events ALTER COLUMN student_id SET NOT NULL;
ALTER TABLE events DROP COLUMN listener_id;
CREATE INDEX events_student_at ON events (student_id, at);
CREATE INDEX events_show_at ON events (show_id, at);

ALTER TABLE ac_outbox ADD COLUMN student_id integer REFERENCES students(id) ON DELETE CASCADE;
UPDATE ac_outbox o SET student_id = s.id FROM listeners l JOIN students s ON lower(s.email) = lower(l.email) WHERE o.listener_id = l.id;
ALTER TABLE ac_outbox DROP COLUMN listener_id;

ALTER TABLE webhook_log ADD COLUMN student_id integer REFERENCES students(id) ON DELETE SET NULL;
UPDATE webhook_log w SET student_id = s.id FROM listeners l JOIN students s ON lower(s.email) = lower(l.email) WHERE w.listener_id = l.id;
ALTER TABLE webhook_log DROP COLUMN listener_id;

UPDATE admin_log SET target = replace(target, 'listener ', 'student ') WHERE target LIKE 'listener %';

DROP TABLE listeners;

-- A cohort's AC tag must be unique across all shows (the sync and the webhook find the cohort by tag).
DROP INDEX cohorts_ac_tag;
CREATE UNIQUE INDEX cohorts_ac_tag ON cohorts (lower(ac_tag));

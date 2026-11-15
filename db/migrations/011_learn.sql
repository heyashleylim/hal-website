-- Student area (docs/student-area-plan.md, step 1a): sign-in by email code, sessions, listening progress, chapters.

-- One-time sign-in codes (6 digits, 10 minutes). Only a hash is kept. A code is used once; 5 wrong tries end it.
CREATE TABLE learn_codes (
  id          bigserial PRIMARY KEY,
  student_id  integer NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    integer NOT NULL DEFAULT 0,
  used_at     timestamptz,
  ip_hash     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX learn_codes_student ON learn_codes (student_id, created_at);

-- Signed-in devices. The cookie holds a random token; only its hash is stored. Renewed on use (1 year from the last visit).
CREATE TABLE learn_sessions (
  id           bigserial PRIMARY KEY,
  student_id   integer NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  via          text NOT NULL CHECK (via IN ('code', 'link')),
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  ended_at     timestamptz
);
CREATE INDEX learn_sessions_student ON learn_sessions (student_id);

-- Where each student is in each episode (web player). Saved every few seconds while playing.
CREATE TABLE listening (
  student_id       integer NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  episode_id       integer NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  position_seconds integer NOT NULL DEFAULT 0 CHECK (position_seconds >= 0),
  furthest_seconds integer NOT NULL DEFAULT 0 CHECK (furthest_seconds >= 0),
  listened_seconds integer NOT NULL DEFAULT 0 CHECK (listened_seconds >= 0),  -- time actually played (any speed)
  completed_at     timestamptz,                                                -- reached 90% or the end
  started_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, episode_id)
);
CREATE INDEX listening_recent ON listening (student_id, updated_at DESC);

-- Chapters from the MP3's ID3 tag (Podcast Studio), editable in the admin: [{ "start": seconds, "title": "…" }].
ALTER TABLE episodes ADD COLUMN chapters jsonb NOT NULL DEFAULT '[]'::jsonb;

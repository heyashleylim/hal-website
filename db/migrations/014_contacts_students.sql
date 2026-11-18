-- Contacts and Students sections (/admin/contacts, /admin/students).
--
-- Contacts: a copy of every ActiveCampaign contact (read-only on the AC side: the site never deletes or changes a
-- contact in AC because of this section). api/_lib/contacts/ac-sync.js fills it. A contact that disappears from AC
-- stays here, with gone_from_ac_at set.
--
-- Students: what each program student said (sales call, onboarding questionnaire, testimonials), the analyses of it
-- and the snippets used for content. The texts are kept exactly as written: the database refuses any change to a
-- text's original words, and a snippet must be an exact passage of its text (checked by a trigger).
-- None of this is in the repository (it is public): it is imported from a spreadsheet kept outside it.

CREATE TABLE contacts (
  id               serial PRIMARY KEY,
  ac_id            text NOT NULL UNIQUE,                 -- ActiveCampaign contact id
  email            text NOT NULL DEFAULT '',             -- lower case
  first_name       text NOT NULL DEFAULT '',             -- Ashley's team keeps the full Korean name here
  last_name        text NOT NULL DEFAULT '',
  phone            text NOT NULL DEFAULT '',
  tags             text[] NOT NULL DEFAULT '{}',         -- tag names
  lists            jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ name, status }] status: subscribed, unsubscribed, …
  fields           jsonb NOT NULL DEFAULT '{}'::jsonb,   -- custom field title → value
  ac_created_at    timestamptz,
  ac_updated_at    timestamptz,
  details_at       timestamptz,                          -- when tags, lists and fields were last read (NULL = not yet)
  details_wanted   boolean NOT NULL DEFAULT true,        -- read tags, lists and fields again at the next sync
  seen_at          timestamptz,                          -- last time a sync saw it in AC
  gone_from_ac_at  timestamptz,                          -- no longer in ActiveCampaign (kept here anyway)
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contacts_email ON contacts (email);
CREATE INDEX contacts_first_name ON contacts (first_name);
CREATE INDEX contacts_details ON contacts (details_wanted, details_at);

-- One line per contacts sync (daily job or "Sync now"); `cursor` lets a long first sync carry on where it stopped.
CREATE TABLE contact_sync_runs (
  id          serial PRIMARY KEY,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  trigger     text NOT NULL CHECK (trigger IN ('cron', 'admin')),
  ok          boolean,
  summary     jsonb NOT NULL DEFAULT '{}'::jsonb,
  error       text
);
CREATE INDEX contact_sync_runs_started ON contact_sync_runs (started_at DESC);

-- The sync's progress between runs: { sweep_offset, sweep_started_at, updated_after, … }
CREATE TABLE contact_sync_state (
  id    integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  state jsonb NOT NULL DEFAULT '{}'::jsonb
);
INSERT INTO contact_sync_state (id) VALUES (1);

-- A student of a program cohort. One row per enrolment (a person who took the program twice has two rows,
-- linked by same_as). Linked to an ActiveCampaign contact when the admin (or the import) matched them.
CREATE TABLE program_students (
  id           serial PRIMARY KEY,
  program      text NOT NULL,                            -- e.g. 'nsmb'
  cohort       integer,
  sheet_row    integer,                                  -- the "#" of the source spreadsheet
  name         text NOT NULL,                            -- as written in the source (Korean)
  name_en      text NOT NULL DEFAULT '',                 -- romanised
  occupation   text NOT NULL DEFAULT '',
  occupation_en text NOT NULL DEFAULT '',
  age          text NOT NULL DEFAULT '',                 -- as given, e.g. 30대
  contact_id   integer REFERENCES contacts(id) ON DELETE SET NULL,
  same_as      integer REFERENCES program_students(id) ON DELETE SET NULL,  -- earlier enrolment of the same person
  -- the decision kept by the admin (the analyses below are inputs to it)
  persona      text,                                     -- P1…P6, NULL = not decided
  persona_alt  text,
  rating       integer CHECK (rating BETWEEN 1 AND 5),   -- testimonial usability, NULL = no testimonial / not decided
  decided_note text NOT NULL DEFAULT '',
  permission   text NOT NULL DEFAULT 'unknown' CHECK (permission IN ('unknown', 'ask', 'yes', 'no')),  -- may her words be used publicly?
  note         text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program, sheet_row)
);
CREATE INDEX program_students_contact ON program_students (contact_id);

-- Everything a student wrote or said, word for word, with its saved English translation.
CREATE TABLE student_texts (
  id            serial PRIMARY KEY,
  student_id    integer NOT NULL REFERENCES program_students(id),
  kind          text NOT NULL CHECK (kind IN ('sales_call_form', 'sales_call', 'onboarding', 'testimonial', 'video_testimonial')),
  text_ko       text NOT NULL,                           -- the original, never changed
  source        text NOT NULL DEFAULT '',                -- where it came from, e.g. "spreadsheet (2026-07-07)"
  text_en       text NOT NULL DEFAULT '',
  translated_of text,                                    -- md5 of the text translated
  translated_at timestamptz,
  superseded_by integer REFERENCES student_texts(id) DEFERRABLE INITIALLY DEFERRED,  -- a correction is a new text; the old one stays
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX student_texts_current ON student_texts (student_id, kind) WHERE superseded_by IS NULL;

-- Analyses of a student (persona, testimonial rating…), one per analysis round, kept side by side.
CREATE TABLE student_analyses (
  id             serial PRIMARY KEY,
  student_id     integer NOT NULL REFERENCES program_students(id),
  round          text NOT NULL,                          -- 'v2-2026-07' (the spreadsheet), 'reread-2026-11'…
  persona        text,
  persona_alt    text,
  confidence     text,                                   -- H, M, L
  why            text NOT NULL DEFAULT '',
  trigger_text   text NOT NULL DEFAULT '',
  outcomes       jsonb NOT NULL DEFAULT '[]'::jsonb,
  generational   boolean,
  rating         integer,
  scores         jsonb NOT NULL DEFAULT '{}'::jsonb,     -- specificity, outcome, quotability, persona_fit, completeness, depth, advocacy, return_signal
  rating_why     text NOT NULL DEFAULT '',
  top_line       text NOT NULL DEFAULT '',               -- the round's "top quotable line" as it wrote it
  top_line_exact boolean,                                -- is it word for word in the student's texts?
  suggested_use  text NOT NULL DEFAULT '',
  flags          jsonb NOT NULL DEFAULT '[]'::jsonb,     -- sensitive topics
  notes          text NOT NULL DEFAULT '',
  extra          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, round)
);

-- A passage of a student's text used (or usable) for content. `quote` must be exactly the text's characters
-- from `start` (1-based, in characters): a trigger refuses anything else, so a snippet can never be altered.
CREATE TABLE student_snippets (
  id          serial PRIMARY KEY,
  text_id     integer NOT NULL REFERENCES student_texts(id),
  start       integer NOT NULL CHECK (start >= 1),
  quote       text NOT NULL CHECK (quote <> ''),
  quote_en    text NOT NULL DEFAULT '',
  use_for     text NOT NULL DEFAULT '',
  origin      text NOT NULL DEFAULT 'admin',             -- the analysis round that picked it, or 'admin'
  starred     boolean NOT NULL DEFAULT false,
  sensitive   boolean NOT NULL DEFAULT false,            -- never for marketing
  hidden      boolean NOT NULL DEFAULT false,
  note        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (text_id, start, quote)
);

-- Reference material of a program's analysis (persona sheets, methodology…): each sheet as rows of cells,
-- each cell { ko, en } (en empty when the cell is already English).
CREATE TABLE student_reference (
  id          serial PRIMARY KEY,
  program     text NOT NULL,
  key         text NOT NULL,                             -- personas, merged_personas, distribution, ratings, methodology, ig…
  title       text NOT NULL,
  position    integer NOT NULL DEFAULT 0,
  rows        jsonb NOT NULL DEFAULT '[]'::jsonb,
  source      text NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program, key)
);

-- The original words of a text never change, and texts are never deleted.
CREATE FUNCTION student_texts_keep() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'student texts are never deleted (a correction is a new text)';
  END IF;
  IF NEW.text_ko IS DISTINCT FROM OLD.text_ko OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.student_id IS DISTINCT FROM OLD.student_id THEN
    RAISE EXCEPTION 'the original text of a student is never changed (a correction is a new text)';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER student_texts_keep BEFORE UPDATE OR DELETE ON student_texts FOR EACH ROW EXECUTE FUNCTION student_texts_keep();

-- A snippet is an exact passage of its text, and its passage can't be changed afterwards.
CREATE FUNCTION student_snippets_exact() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original text;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.quote IS DISTINCT FROM OLD.quote OR NEW.start IS DISTINCT FROM OLD.start OR NEW.text_id IS DISTINCT FROM OLD.text_id) THEN
    RAISE EXCEPTION 'a snippet''s words are never changed (add another snippet instead)';
  END IF;
  SELECT text_ko INTO original FROM student_texts WHERE id = NEW.text_id;
  IF original IS NULL OR substr(original, NEW.start, char_length(NEW.quote)) IS DISTINCT FROM NEW.quote THEN
    RAISE EXCEPTION 'a snippet must be an exact passage of the student''s text';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER student_snippets_exact BEFORE INSERT OR UPDATE ON student_snippets FOR EACH ROW EXECUTE FUNCTION student_snippets_exact();

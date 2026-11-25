-- Reviews from program students, starting with the Life Artist 2026 review form (Alex, 2026-11-25).
-- A review is saved as one text per question (kind 'review', question_key = the question), so each answer gets its
-- own English, its own snippets, and the same protection as every other student text (never changed or deleted).
-- The questions themselves are in code: api/_lib/students/forms.js.

-- The programs the Students section knows, in the order the admin lists them.
CREATE TABLE student_programs (
  key       text PRIMARY KEY,                  -- matches program_students.program
  name      text NOT NULL,                     -- English, for the admin
  name_ko   text NOT NULL,
  position  integer NOT NULL DEFAULT 0,
  personas  boolean NOT NULL DEFAULT false     -- does this program's analysis assign a persona (P1–P6)?
);
INSERT INTO student_programs (key, name, name_ko, position, personas) VALUES
  ('nsmb', 'NSMB', '내성만방', 1, true),
  ('lifeartist', 'Life Artist', '라이프 아티스트', 2, false);

-- The email she gave (review form, export): links her to her ActiveCampaign contact and her other enrolments.
ALTER TABLE program_students ADD COLUMN email text NOT NULL DEFAULT '';
CREATE INDEX program_students_email ON program_students (lower(email)) WHERE email <> '';
-- one enrolment per email in a program's cohort (a second review from her updates the first)
CREATE UNIQUE INDEX program_students_email_once ON program_students (program, cohort, lower(email)) WHERE email <> '';

ALTER TABLE student_texts DROP CONSTRAINT student_texts_kind_check;
ALTER TABLE student_texts ADD CONSTRAINT student_texts_kind_check
  CHECK (kind IN ('sales_call_form', 'sales_call', 'onboarding', 'testimonial', 'video_testimonial', 'review'));
ALTER TABLE student_texts ADD COLUMN question_key text NOT NULL DEFAULT '';   -- for kind 'review': which question
ALTER TABLE student_texts ADD COLUMN submitted_at timestamptz;                -- when she sent it (review form)

DROP INDEX student_texts_current;
CREATE UNIQUE INDEX student_texts_current ON student_texts (student_id, kind, question_key) WHERE superseded_by IS NULL;

CREATE OR REPLACE FUNCTION student_texts_keep() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'student texts are never deleted (a correction is a new text)';
  END IF;
  IF NEW.text_ko IS DISTINCT FROM OLD.text_ko OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.student_id IS DISTINCT FROM OLD.student_id
     OR NEW.question_key IS DISTINCT FROM OLD.question_key THEN
    RAISE EXCEPTION 'the original text of a student is never changed (a correction is a new text)';
  END IF;
  RETURN NEW;
END $$;

-- Review form submissions: a short rate limit per network (hashed), like learn_requests.
CREATE TABLE review_requests (
  id       bigserial PRIMARY KEY,
  at       timestamptz NOT NULL DEFAULT now(),
  ip_hash  text NOT NULL,
  form     text NOT NULL
);
CREATE INDEX review_requests_recent ON review_requests (ip_hash, at);

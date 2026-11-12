-- Emails: a saved English translation of each email (subject and body), so the admin can be read without Korean.
-- Translated once by api/_lib/emails/translate.js (daily job, after an import or a sync, or "Translate now"),
-- and again only if the Korean text changes.

ALTER TABLE emails
  ADD COLUMN subject_en      text NOT NULL DEFAULT '',
  ADD COLUMN body_en         text NOT NULL DEFAULT '',
  ADD COLUMN translated_of   text,                        -- md5 of the subject + body that was translated; differs → translate again
  ADD COLUMN translated_at   timestamptz,
  ADD COLUMN translate_tries integer NOT NULL DEFAULT 0,  -- failed attempts since the last success (5 → left alone until "Translate now")
  ADD COLUMN translate_error text;

-- "Send again?" marks that came from the spreadsheet's Resend column were based on its old Perf formula: removed.
-- The column now only holds choices made in the admin (the import no longer reads Resend).
UPDATE emails SET resend = '', updated_at = now() WHERE source = 'import' AND resend IN ('yes', 'maybe');

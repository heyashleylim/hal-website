-- "Good for" categories of a snippet (Alex, 2026-11-18): a short fixed list to filter the snippet library on,
-- next to the free-text use_for note. Keys are checked in api/_lib/admin/program-students.js (USE_CATS).
-- Filled from the notes by tools/students/categories.js; changed in the admin afterwards.
ALTER TABLE student_snippets ADD COLUMN use_cats text[] NOT NULL DEFAULT '{}';
CREATE INDEX student_snippets_use_cats ON student_snippets USING gin (use_cats);

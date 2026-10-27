-- One admin for every section (podcast today, e-commerce later): the activity log records the section.
ALTER TABLE admin_log ADD COLUMN section text NOT NULL DEFAULT 'podcast';
ALTER TABLE admin_log ALTER COLUMN section DROP DEFAULT;
CREATE INDEX admin_log_at ON admin_log (at);

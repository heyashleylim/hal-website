-- Phase 5: ActiveCampaign automation.
-- ac_outbox gains the program (for tag names) and a "re-add" operation (remove then add a tag, so an AC
-- automation started by "tag is added" runs again, e.g. to resend a welcome email).
ALTER TABLE ac_outbox ADD COLUMN show_id integer REFERENCES shows(id) ON DELETE CASCADE;
ALTER TABLE ac_outbox DROP CONSTRAINT ac_outbox_op_check;
ALTER TABLE ac_outbox ADD CONSTRAINT ac_outbox_op_check CHECK (op IN ('tag_add', 'tag_remove', 'tag_readd', 'fields'));
CREATE INDEX ac_outbox_student ON ac_outbox (student_id, created_at);

-- Small key/value store for the daily job (last run, results).
CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX webhook_log_at ON webhook_log (at);

-- Ashley's AC tags use underscores: podcast-nsmb → podcast_nsmb (tags become podcast_nsmb_enrolled, …).
ALTER TABLE shows ALTER COLUMN ac_tag_prefix DROP DEFAULT;
UPDATE shows SET ac_tag_prefix = replace(ac_tag_prefix, '-', '_');

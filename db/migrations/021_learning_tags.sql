-- Learning tags (Alex, 2026-11-26): the ActiveCampaign tags of the student area start with learning_ instead of
-- podcast_ (podcast_nsmb → learning_nsmb, so podcast_nsmb_enrolled becomes learning_nsmb_enrolled, …).
UPDATE shows SET ac_tag_prefix = 'learning_' || substr(ac_tag_prefix, 9), updated_at = now() WHERE ac_tag_prefix LIKE 'podcast\_%';

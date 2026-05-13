-- Keep submission_revisions message columns in sync for all install paths.
-- - revision_system.sql used clarification_message
-- - add_advanced_review_hold.sql used review_response_message
-- Run once in Supabase SQL Editor.

ALTER TABLE submission_revisions
  ADD COLUMN IF NOT EXISTS clarification_message TEXT;

ALTER TABLE submission_revisions
  ADD COLUMN IF NOT EXISTS review_response_message TEXT;

UPDATE submission_revisions
SET clarification_message = review_response_message
WHERE clarification_message IS NULL
  AND review_response_message IS NOT NULL;

UPDATE submission_revisions
SET review_response_message = clarification_message
WHERE review_response_message IS NULL
  AND clarification_message IS NOT NULL;

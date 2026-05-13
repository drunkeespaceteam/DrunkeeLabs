-- ============================================================
-- IMMUTABLE ARTIFACT ARCHITECTURE — DATABASE MIGRATION
-- ============================================================
-- Adds columns to support permanent artifact storage,
-- strict validation, and build/runtime log persistence.
-- Run this migration against Supabase SQL Editor.
-- ============================================================

-- Permanent artifact tracking
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS original_zip_url TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS original_zip_name TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS artifact_status TEXT DEFAULT 'pending';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS artifact_hash TEXT;

-- Strict validation tracking
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS validation_status TEXT DEFAULT 'pending';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS validation_errors JSONB DEFAULT '[]';

-- Build and runtime log persistence
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS build_logs TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS runtime_logs TEXT;

-- ============================================================
-- BACKFILL: Copy existing zip_url to original_zip_url
-- ============================================================
UPDATE submissions
SET original_zip_url = zip_url,
    artifact_status = CASE
      WHEN is_winner = true THEN 'locked'
      WHEN zip_url IS NOT NULL THEN 'stored'
      ELSE 'pending'
    END
WHERE original_zip_url IS NULL
  AND zip_url IS NOT NULL;

-- ============================================================
-- INDEX: Speed up queries for download and backfill
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_submissions_artifact_status
  ON submissions (artifact_status);

CREATE INDEX IF NOT EXISTS idx_submissions_original_zip_url
  ON submissions (original_zip_url)
  WHERE original_zip_url IS NOT NULL;

-- Snapshot System Migration
-- Run this in your Supabase SQL editor

-- Add snapshot columns (source_zip_url was already added in upgrade.sql)
ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS source_zip_url TEXT;

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS snapshot_status TEXT DEFAULT 'pending';

-- Update any existing submissions that already have a source_zip_url saved
UPDATE submissions
  SET snapshot_status = 'saved'
  WHERE source_zip_url IS NOT NULL
    AND (snapshot_status IS NULL OR snapshot_status = 'pending');

-- The submission-zips storage bucket was created automatically via the API.
-- If you ever need to recreate it manually, run in Supabase dashboard:
--   INSERT INTO storage.buckets (id, name, public)
--   VALUES ('submission-zips', 'submission-zips', true)
--   ON CONFLICT DO NOTHING;

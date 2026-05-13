-- Migration to support ZIP uploads and Docker Sandbox execution

ALTER TABLE submissions
ADD COLUMN IF NOT EXISTS zip_url TEXT,
ADD COLUMN IF NOT EXISTS preview_url TEXT,
ADD COLUMN IF NOT EXISTS build_status TEXT DEFAULT 'idle',
ADD COLUMN IF NOT EXISTS logs TEXT,
ADD COLUMN IF NOT EXISTS runtime_type TEXT;

-- Update existing rows to have a default build_status if they didn't have one
UPDATE submissions SET build_status = 'idle' WHERE build_status IS NULL;

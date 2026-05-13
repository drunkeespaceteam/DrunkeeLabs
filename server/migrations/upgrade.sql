-- NexusDev Production Upgrade Migration
-- Run this in your Supabase SQL editor

-- 1. Add profile columns to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS bio TEXT,
  ADD COLUMN IF NOT EXISTS skills TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS github_url TEXT,
  ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
  ADD COLUMN IF NOT EXISTS portfolio_url TEXT,
  ADD COLUMN IF NOT EXISTS experience TEXT DEFAULT 'beginner',
  ADD COLUMN IF NOT EXISTS username TEXT UNIQUE;

-- 2. Add snapshot/storage columns to submissions
ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS source_zip_url TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_locked BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS runtime_type TEXT;

-- 3. Create reviews table
CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  submission_id UUID REFERENCES submissions(id) ON DELETE SET NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(reviewer_id, task_id)
);

-- 4. Create profile-images storage bucket (run in Supabase dashboard or via API)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('profile-images', 'profile-images', true) ON CONFLICT DO NOTHING;

-- 5. RLS for reviews
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read reviews" ON reviews FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert reviews" ON reviews FOR INSERT WITH CHECK (auth.uid() = reviewer_id);
CREATE POLICY "Users can update own reviews" ON reviews FOR UPDATE USING (auth.uid() = reviewer_id);

-- 6. Index for fast review lookups
CREATE INDEX IF NOT EXISTS reviews_target_user_idx ON reviews(target_user_id);
CREATE INDEX IF NOT EXISTS reviews_task_idx ON reviews(task_id);

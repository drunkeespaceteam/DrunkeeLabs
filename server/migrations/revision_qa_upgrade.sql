-- ═══════════════════════════════════════════════════════════════
-- REVISION QA UPGRADE — Production Sandbox Review System
-- Run this in the Supabase SQL Editor BEFORE deploying new code.
-- ═══════════════════════════════════════════════════════════════

-- IMPROVEMENT 2: Revision Preview Metadata
-- Tracks sandbox state per-revision so mentors can see build status
ALTER TABLE submission_revisions
ADD COLUMN IF NOT EXISTS preview_url TEXT,
ADD COLUMN IF NOT EXISTS sandbox_status TEXT DEFAULT 'idle',
ADD COLUMN IF NOT EXISTS build_logs TEXT,
ADD COLUMN IF NOT EXISTS error_category TEXT,
ADD COLUMN IF NOT EXISTS error_suggestion TEXT;

-- IMPROVEMENT 3 (Phase 3): Classified errors on employee submissions (optional diagnostics)
ALTER TABLE submissions
ADD COLUMN IF NOT EXISTS error_category TEXT,
ADD COLUMN IF NOT EXISTS error_suggestion TEXT;

-- Latest written correction / feedback from mentor (shown to employee until delivery approved)
ALTER TABLE submissions
ADD COLUMN IF NOT EXISTS mentor_latest_correction TEXT,
ADD COLUMN IF NOT EXISTS mentor_latest_correction_at TIMESTAMPTZ;

-- IMPROVEMENT 5: Mentor Review Notes
-- Allows mentors to attach QA observations to each revision
CREATE TABLE IF NOT EXISTS revision_review_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    revision_id UUID REFERENCES submission_revisions(id) ON DELETE CASCADE,
    submission_id UUID REFERENCES submissions(id) ON DELETE CASCADE,
    mentor_id UUID NOT NULL,
    note TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookup by revision
CREATE INDEX IF NOT EXISTS idx_revision_notes_revision
ON revision_review_notes(revision_id);

-- Index for fast lookup by submission
CREATE INDEX IF NOT EXISTS idx_revision_notes_submission
ON revision_review_notes(submission_id);

-- Add advanced review hold and sandbox preservation columns to submissions
ALTER TABLE submissions
ADD COLUMN IF NOT EXISTS review_hold_status TEXT DEFAULT 'none',
ADD COLUMN IF NOT EXISTS review_hold_reason TEXT,
ADD COLUMN IF NOT EXISTS review_hold_category TEXT,
ADD COLUMN IF NOT EXISTS review_hold_started_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS review_hold_expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS review_hold_duration_hours INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS review_hold_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS auto_release_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS sandbox_preserved BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS current_artifact_url TEXT,
ADD COLUMN IF NOT EXISTS current_revision INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS runtime_type TEXT,
ADD COLUMN IF NOT EXISTS validation_report JSONB,
ADD COLUMN IF NOT EXISTS validation_passed BOOLEAN DEFAULT false;

-- Create submission_events table for audit logs and timelines
CREATE TABLE IF NOT EXISTS submission_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    submission_id UUID REFERENCES submissions(id) ON DELETE CASCADE,
    task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_type TEXT, -- 'mentor', 'employee', 'system'
    event_type TEXT, -- 'upload', 'review_paused', 'clarification_requested', 'clarification_submitted', 'payment_released', 'payment_auto_released', 'mentor_approved', 'sandbox_preserved', 'preview_expired'
    message TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create submission_revisions table for tracking iterative uploads during review
CREATE TABLE IF NOT EXISTS submission_revisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    submission_id UUID REFERENCES submissions(id) ON DELETE CASCADE,
    revision_number INTEGER,
    artifact_url TEXT NOT NULL,
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    review_response_message TEXT
);

-- Backfill original_zip_url to current_artifact_url for existing submissions
UPDATE submissions 
SET current_artifact_url = original_zip_url 
WHERE current_artifact_url IS NULL AND original_zip_url IS NOT NULL;

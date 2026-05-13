CREATE TABLE IF NOT EXISTS submission_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID REFERENCES submissions(id) ON DELETE CASCADE,
    revision_number INTEGER NOT NULL,
    artifact_url TEXT NOT NULL,
    uploaded_by UUID,
    clarification_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE submissions
ADD COLUMN IF NOT EXISTS current_revision INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS latest_artifact_url TEXT;

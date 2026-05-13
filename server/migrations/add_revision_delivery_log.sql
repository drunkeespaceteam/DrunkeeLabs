-- Append-only log of employee delivery ZIPs / messages (mentor reads via API + submissions row).
-- Run in Supabase SQL Editor once.

ALTER TABLE submissions
ADD COLUMN IF NOT EXISTS revision_delivery_log JSONB DEFAULT '[]'::jsonb;

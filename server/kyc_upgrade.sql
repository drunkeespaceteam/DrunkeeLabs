-- KYC Government Proof Upgrade

-- Create kyc_submissions table if not exists
CREATE TABLE IF NOT EXISTS kyc_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  pan_number TEXT,
  pan_last4 TEXT,
  pan_hash TEXT,
  bank_account TEXT NOT NULL,
  ifsc_code TEXT NOT NULL,
  government_proof_url TEXT,
  government_id_type TEXT DEFAULT 'aadhaar',
  status TEXT DEFAULT 'pending',
  submitted_at timestamptz DEFAULT now(),
  reviewed_at timestamptz,
  rejection_reason TEXT,
  UNIQUE(user_id)
);

-- Add government proof URL to KYC submissions if table already existed
ALTER TABLE IF EXISTS kyc_submissions
  ADD COLUMN IF NOT EXISTS government_proof_url TEXT,
  ADD COLUMN IF NOT EXISTS government_id_type TEXT DEFAULT 'aadhaar',
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Add kyc_status to users if not exists
ALTER TABLE IF EXISTS users
  ADD COLUMN IF NOT EXISTS kyc_status TEXT DEFAULT 'none';

-- Create index for faster KYC lookups
CREATE INDEX IF NOT EXISTS idx_kyc_submissions_status ON kyc_submissions (status);
CREATE INDEX IF NOT EXISTS idx_kyc_submissions_user_id ON kyc_submissions (user_id);

-- Refresh schema cache
NOTIFY pgrst, 'reload schema';

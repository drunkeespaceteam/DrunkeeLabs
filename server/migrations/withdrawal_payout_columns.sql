-- Optional: columns used by automatic Razorpay withdrawals (safe if already present)
ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS bank_details JSONB,
  ADD COLUMN IF NOT EXISTS requested_amount NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS fee_amount NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS final_amount NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS razorpay_payout_id TEXT,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER DEFAULT 0;

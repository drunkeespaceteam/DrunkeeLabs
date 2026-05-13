-- Run this script if you are getting "column locked_balance does not exist" errors
-- It safely adds the missing columns from the advanced wallet system to your existing wallets table.

ALTER TABLE wallets
ADD COLUMN IF NOT EXISTS available_balance NUMERIC(15,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS locked_balance NUMERIC(15,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS total_earned NUMERIC(15,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS total_withdrawn NUMERIC(15,2) DEFAULT 0.00;

-- Optionally, if your old system used a column named "balance", migrate it to available_balance:
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='wallets' AND column_name='balance') THEN
    UPDATE wallets SET available_balance = balance WHERE available_balance = 0.00 AND balance IS NOT NULL;
  END IF;
END $$;

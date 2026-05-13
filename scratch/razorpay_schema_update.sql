-- Withdrawals safety fields
ALTER TABLE public.withdrawals 
ADD COLUMN IF NOT EXISTS razorpay_payout_id text,
ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS processed_at timestamptz,
ADD COLUMN IF NOT EXISTS attempt_count integer DEFAULT 0;

-- Store Razorpay entities
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS razorpay_contact_id text,
ADD COLUMN IF NOT EXISTS razorpay_fund_account_id text;

-- Wallet Refund RPC (Atomic)
CREATE OR REPLACE FUNCTION public.increment_wallet_balance(
  user_id uuid,
  amount numeric
)
RETURNS void AS $$
BEGIN
  UPDATE public.wallets
  SET balance = balance + amount
  WHERE wallets.user_id = increment_wallet_balance.user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Refresh schema cache
NOTIFY pgrst, 'reload schema';

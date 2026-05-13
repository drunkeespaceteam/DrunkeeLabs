-- SaaS Platform Upgrade: Admin auth + Phase 1 monetization

ALTER TABLE IF EXISTS users
  ADD COLUMN IF NOT EXISTS role text DEFAULT 'user';

UPDATE users
SET role = 'user'
WHERE role IS NULL;

ALTER TABLE IF EXISTS tasks
  ADD COLUMN IF NOT EXISTS platform_fee numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_paid numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_featured boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS featured_until timestamptz NULL;

ALTER TABLE IF EXISTS pending_tasks
  ADD COLUMN IF NOT EXISTS platform_fee numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_paid numeric DEFAULT 0;

ALTER TABLE IF EXISTS withdrawals
  ADD COLUMN IF NOT EXISTS requested_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_amount numeric DEFAULT 0;

ALTER TABLE IF EXISTS payments
  ADD COLUMN IF NOT EXISTS total_paid numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_type text DEFAULT 'task';

CREATE TABLE IF NOT EXISTS revenue_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('task_fee', 'withdrawal_fee', 'featured_fee')),
  amount numeric NOT NULL DEFAULT 0,
  reference_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_revenue_logs_created_at ON revenue_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_revenue_logs_type ON revenue_logs (type);

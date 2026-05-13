-- WALLET SYSTEM UPGRADE
-- Creates real-money compatible wallet system with escrow and withdrawal tracking.

-- 1. Create WALLETS table
CREATE TABLE IF NOT EXISTS wallets (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    available_balance NUMERIC(15,2) DEFAULT 0.00,
    locked_balance NUMERIC(15,2) DEFAULT 0.00,
    total_earned NUMERIC(15,2) DEFAULT 0.00,
    total_withdrawn NUMERIC(15,2) DEFAULT 0.00,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Wallet Trigger to populate automatically
CREATE OR REPLACE FUNCTION initialize_wallet_for_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO wallets (user_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_initialize_wallet ON users;
CREATE TRIGGER trg_initialize_wallet
AFTER INSERT ON users
FOR EACH ROW EXECUTE FUNCTION initialize_wallet_for_new_user();

-- Initialize existing users
INSERT INTO wallets (user_id)
SELECT id FROM users
ON CONFLICT DO NOTHING;

-- 2. Create WALLET_TRANSACTIONS table
CREATE TABLE IF NOT EXISTS wallet_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id UUID REFERENCES wallets(user_id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('task_payment', 'escrow_locked', 'escrow_released', 'auto_release', 'withdrawal_requested', 'withdrawal_completed', 'withdrawal_rejected', 'refund', 'admin_adjustment', 'platform_fee')),
    amount NUMERIC(15,2) NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'reversed')),
    reference_type TEXT,
    reference_id TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_user ON wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_status ON wallet_transactions(status);

-- 3. Create WITHDRAWALS table
CREATE TABLE IF NOT EXISTS withdrawals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    amount NUMERIC(15,2) NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'under_review', 'approved', 'processing', 'completed', 'rejected', 'failed')),
    payment_method TEXT NOT NULL,
    payout_reference TEXT,
    admin_notes TEXT,
    rejection_reason TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    requested_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    processed_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);

-- 4. Audit Logs Table for production grade safety
CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_id UUID REFERENCES users(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    changes JSONB DEFAULT '{}'::jsonb,
    ip_address TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 5. FUNCTION: lock_escrow_funds (Winner selected)
CREATE OR REPLACE FUNCTION lock_escrow_funds(
    p_submission_id UUID,
    p_task_id UUID,
    p_user_id UUID,
    p_amount NUMERIC
) RETURNS JSONB AS $$
DECLARE
    v_wallet_id UUID;
    v_tx_id UUID;
BEGIN
    -- Ensure task isn't already locked or released
    IF EXISTS (SELECT 1 FROM wallet_transactions WHERE reference_type = 'submission' AND reference_id = p_submission_id::text AND transaction_type IN ('escrow_locked', 'escrow_released', 'auto_release') AND status = 'completed') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Funds already processed for this submission');
    END IF;

    -- Update Wallet
    UPDATE wallets
    SET locked_balance = locked_balance + p_amount,
        updated_at = now()
    WHERE user_id = p_user_id
    RETURNING user_id INTO v_wallet_id;

    IF v_wallet_id IS NULL THEN
        RAISE EXCEPTION 'Wallet not found for user %', p_user_id;
    END IF;

    -- Insert Transaction
    INSERT INTO wallet_transactions (wallet_id, user_id, transaction_type, amount, status, reference_type, reference_id, metadata)
    VALUES (p_user_id, p_user_id, 'escrow_locked', p_amount, 'completed', 'submission', p_submission_id::text, jsonb_build_object('task_id', p_task_id))
    RETURNING id INTO v_tx_id;

    RETURN jsonb_build_object('success', true, 'wallet_id', v_wallet_id, 'transaction_id', v_tx_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. FUNCTION: release_escrow_funds (Mentor approval or 48h limit)
CREATE OR REPLACE FUNCTION release_escrow_funds(
    p_submission_id UUID,
    p_user_id UUID,
    p_amount NUMERIC,
    p_tx_type TEXT -- 'escrow_released' or 'auto_release'
) RETURNS JSONB AS $$
DECLARE
    v_tx_id UUID;
    v_locked NUMERIC;
BEGIN
    -- Verify submission wasn't already released
    IF EXISTS (SELECT 1 FROM wallet_transactions WHERE reference_type = 'submission' AND reference_id = p_submission_id::text AND transaction_type IN ('escrow_released', 'auto_release') AND status = 'completed') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Funds already released');
    END IF;

    -- Check available locked balance to prevent negative
    SELECT locked_balance INTO v_locked FROM wallets WHERE user_id = p_user_id FOR UPDATE;
    IF v_locked < p_amount THEN
        RAISE EXCEPTION 'Insufficient locked balance. Expected %, found %', p_amount, v_locked;
    END IF;

    -- Update balances
    UPDATE wallets
    SET locked_balance = locked_balance - p_amount,
        available_balance = available_balance + p_amount,
        total_earned = total_earned + p_amount,
        updated_at = now()
    WHERE user_id = p_user_id;

    -- Insert completion transaction
    INSERT INTO wallet_transactions (wallet_id, user_id, transaction_type, amount, status, reference_type, reference_id)
    VALUES (p_user_id, p_user_id, p_tx_type, p_amount, 'completed', 'submission', p_submission_id::text)
    RETURNING id INTO v_tx_id;

    RETURN jsonb_build_object('success', true, 'transaction_id', v_tx_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 7. FUNCTION: request_withdrawal
CREATE OR REPLACE FUNCTION request_withdrawal(
    p_user_id UUID,
    p_amount NUMERIC,
    p_payment_method TEXT
) RETURNS JSONB AS $$
DECLARE
    v_locked NUMERIC;
    v_available NUMERIC;
    v_tx_id UUID;
    v_withdrawal_id UUID;
BEGIN
    SELECT available_balance INTO v_available FROM wallets WHERE user_id = p_user_id FOR UPDATE;
    
    IF v_available IS NULL THEN
        RAISE EXCEPTION 'Wallet not found';
    END IF;

    IF v_available < p_amount THEN
        RETURN jsonb_build_object('success', false, 'message', 'Insufficient available balance');
    END IF;

    -- Deduct
    UPDATE wallets
    SET available_balance = available_balance - p_amount,
        updated_at = now()
    WHERE user_id = p_user_id;

    -- Create withdrawal
    INSERT INTO withdrawals (user_id, amount, status, payment_method)
    VALUES (p_user_id, p_amount, 'pending', p_payment_method)
    RETURNING id INTO v_withdrawal_id;

    -- Insert Wallet TX
    INSERT INTO wallet_transactions (wallet_id, user_id, transaction_type, amount, status, reference_type, reference_id)
    VALUES (p_user_id, p_user_id, 'withdrawal_requested', p_amount, 'pending', 'withdrawal', v_withdrawal_id::text)
    RETURNING id INTO v_tx_id;

    RETURN jsonb_build_object('success', true, 'withdrawal_id', v_withdrawal_id, 'transaction_id', v_tx_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. FUNCTION: complete_withdrawal
CREATE OR REPLACE FUNCTION complete_withdrawal(
    p_withdrawal_id UUID,
    p_payout_ref TEXT
) RETURNS JSONB AS $$
DECLARE
    v_user_id UUID;
    v_amount NUMERIC;
    v_status TEXT;
BEGIN
    SELECT user_id, amount, status INTO v_user_id, v_amount, v_status FROM withdrawals WHERE id = p_withdrawal_id FOR UPDATE;

    IF v_status IN ('completed', 'rejected', 'failed') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Withdrawal already processed');
    END IF;

    UPDATE withdrawals
    SET status = 'completed', payout_reference = p_payout_ref, processed_at = now(), updated_at = now()
    WHERE id = p_withdrawal_id;

    -- Update total withdrawn
    UPDATE wallets
    SET total_withdrawn = total_withdrawn + v_amount,
        updated_at = now()
    WHERE user_id = v_user_id;

    -- Mark TX completed
    UPDATE wallet_transactions
    SET status = 'completed'
    WHERE reference_type = 'withdrawal' AND reference_id = p_withdrawal_id::text AND transaction_type = 'withdrawal_requested';

    -- Also insert 'withdrawal_completed' tx
    INSERT INTO wallet_transactions (wallet_id, user_id, transaction_type, amount, status, reference_type, reference_id)
    VALUES (v_user_id, v_user_id, 'withdrawal_completed', v_amount, 'completed', 'withdrawal', p_withdrawal_id::text);

    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. FUNCTION: reject_withdrawal (Refund)
CREATE OR REPLACE FUNCTION reject_withdrawal(
    p_withdrawal_id UUID,
    p_reason TEXT
) RETURNS JSONB AS $$
DECLARE
    v_user_id UUID;
    v_amount NUMERIC;
    v_status TEXT;
BEGIN
    SELECT user_id, amount, status INTO v_user_id, v_amount, v_status FROM withdrawals WHERE id = p_withdrawal_id FOR UPDATE;

    IF v_status IN ('completed', 'rejected', 'failed') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Withdrawal already processed');
    END IF;

    UPDATE withdrawals
    SET status = 'rejected', rejection_reason = p_reason, processed_at = now(), updated_at = now()
    WHERE id = p_withdrawal_id;

    -- Restore available balance
    UPDATE wallets
    SET available_balance = available_balance + v_amount,
        updated_at = now()
    WHERE user_id = v_user_id;

    -- Mark requested tx as failed
    UPDATE wallet_transactions
    SET status = 'failed'
    WHERE reference_type = 'withdrawal' AND reference_id = p_withdrawal_id::text AND transaction_type = 'withdrawal_requested';

    -- Insert Refund Tx
    INSERT INTO wallet_transactions (wallet_id, user_id, transaction_type, amount, status, reference_type, reference_id, metadata)
    VALUES (v_user_id, v_user_id, 'refund', v_amount, 'completed', 'withdrawal', p_withdrawal_id::text, jsonb_build_object('reason', p_reason));

    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

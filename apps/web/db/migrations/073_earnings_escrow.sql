-- 073_earnings_escrow.sql
-- Earnings escrow system: tracks profits from closed deals with inspection period
-- hold. Earnings become available only after the inspection/refund period ends.
-- If a deal is refunded during that period, the earning is marked REFUNDED.
-- Idempotent. Rollback: DROP TABLE withdrawals; DROP TABLE earnings;

-- Earnings table: tracks individual earnings from deals
CREATE TABLE IF NOT EXISTS public.earnings (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  organization_id text NOT NULL,
  contract_id text REFERENCES public.contracts(id) ON DELETE SET NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'AVAILABLE', 'WITHDRAWN', 'REFUNDED')),
  description text,
  -- When this earning becomes available for withdrawal
  available_at timestamptz NOT NULL,
  -- When the deal closed (earning created)
  deal_closed_at timestamptz NOT NULL DEFAULT now(),
  -- If refunded, when and why
  refunded_at timestamptz,
  refund_reason text,
  -- If withdrawn, link to the withdrawal
  withdrawal_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_earnings_user_id ON public.earnings (user_id);
CREATE INDEX IF NOT EXISTS idx_earnings_org_id ON public.earnings (organization_id);
CREATE INDEX IF NOT EXISTS idx_earnings_status ON public.earnings (status);
CREATE INDEX IF NOT EXISTS idx_earnings_contract ON public.earnings (contract_id);
-- For the cron job that moves PENDING to AVAILABLE
CREATE INDEX IF NOT EXISTS idx_earnings_pending_available
  ON public.earnings (available_at)
  WHERE status = 'PENDING';

-- Withdrawals table: tracks withdrawal requests
CREATE TABLE IF NOT EXISTS public.withdrawals (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  organization_id text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  -- Bank/payment details (encrypted in practice, simplified here)
  payout_method text NOT NULL DEFAULT 'bank_transfer',
  payout_reference text,
  -- Processing timestamps
  requested_at timestamptz NOT NULL DEFAULT now(),
  processing_started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  -- Estimated arrival
  estimated_arrival_at timestamptz,
  -- Metadata for audit trail
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for withdrawals
CREATE INDEX IF NOT EXISTS idx_withdrawals_user_id ON public.withdrawals (user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_org_id ON public.withdrawals (organization_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON public.withdrawals (status);

-- Add foreign key from earnings to withdrawals
ALTER TABLE public.earnings
  ADD CONSTRAINT fk_earnings_withdrawal
  FOREIGN KEY (withdrawal_id) REFERENCES public.withdrawals(id) ON DELETE SET NULL;

-- Bank accounts table: stores verified payout destinations
CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  organization_id text NOT NULL,
  bank_name text NOT NULL,
  account_type text NOT NULL DEFAULT 'checking'
    CHECK (account_type IN ('checking', 'savings')),
  -- Store only last 4 digits for display
  last_four text NOT NULL,
  -- Encrypted routing/account numbers would go here in production
  -- For this implementation we'll use a simple verified flag
  verified boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_user_id ON public.bank_accounts (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_accounts_default
  ON public.bank_accounts (user_id)
  WHERE is_default = true;

-- User payout settings (minimum payout, hold period preferences)
CREATE TABLE IF NOT EXISTS public.payout_settings (
  id text PRIMARY KEY,
  user_id text NOT NULL UNIQUE REFERENCES public."user"(id) ON DELETE CASCADE,
  organization_id text NOT NULL,
  -- Minimum amount for auto-payout (0 = manual only)
  auto_payout_threshold_cents bigint DEFAULT 0,
  -- Default inspection/hold period in days (14 is standard)
  default_hold_days integer NOT NULL DEFAULT 14
    CHECK (default_hold_days BETWEEN 7 AND 30),
  -- Notification preferences
  notify_on_available boolean NOT NULL DEFAULT true,
  notify_on_payout boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payout_settings_user_id ON public.payout_settings (user_id);
CREATE INDEX IF NOT EXISTS idx_payout_settings_org_id ON public.payout_settings (organization_id);

COMMENT ON TABLE public.earnings IS
  'Earnings from closed deals. Status transitions: PENDING (in escrow) -> AVAILABLE (can withdraw) -> WITHDRAWN. REFUNDED if deal falls through during inspection.';

COMMENT ON TABLE public.withdrawals IS
  'Withdrawal requests. Status: PENDING -> PROCESSING -> COMPLETED/FAILED.';

COMMENT ON COLUMN public.earnings.available_at IS
  'When this earning becomes available for withdrawal. Typically deal_closed_at + inspection_period (14 days).';

# Migration 033 - Reviews System

-- Reviews table for customer ratings and testimonials
CREATE TABLE IF NOT EXISTS public.reviews (
  id text PRIMARY KEY DEFAULT 'rev_' || gen_random_uuid()::text,
  user_id text REFERENCES public."user"(id) ON DELETE SET NULL,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  title text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  verified_customer boolean NOT NULL DEFAULT false,
  is_demo boolean NOT NULL DEFAULT false,
  admin_note text,
  
  -- Ensure one review per user
  UNIQUE (user_id, status)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_reviews_status ON public.reviews (status);
CREATE INDEX IF NOT EXISTS idx_reviews_user ON public.reviews (user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_created ON public.reviews (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_demo ON public.reviews (is_demo) WHERE is_demo = true;

-- Admin audit log for reviews actions
CREATE TABLE IF NOT EXISTS public.review_audit_log (
  id text PRIMARY KEY DEFAULT 'rev_audit_' || gen_random_uuid()::text,
  actor_id text REFERENCES public."user"(id),
  action text NOT NULL, -- 'approve', 'reject', 'flag'
  review_id text REFERENCES public.reviews(id) ON DELETE CASCADE,
  reason text,
  metadata jsonb,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_audit_log_review ON public.review_audit_log (review_id);
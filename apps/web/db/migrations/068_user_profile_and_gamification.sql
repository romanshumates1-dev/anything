-- Migration: User profile fields, leaderboard stats, and achievements system
-- Created: 2026-08-29

-- Add profile fields to user table
ALTER TABLE public."user"
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/New_York',
  ADD COLUMN IF NOT EXISTS credits_balance integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subscription_tier text NOT NULL DEFAULT 'free';

-- Create index for subscription tier filtering
CREATE INDEX IF NOT EXISTS idx_user_subscription_tier ON public."user"(subscription_tier);

-- Create leaderboard/user stats tracking table
CREATE TABLE IF NOT EXISTS public.user_stats (
  user_id text PRIMARY KEY REFERENCES public."user"(id) ON DELETE CASCADE,
  points integer NOT NULL DEFAULT 0,
  deals_count integer NOT NULL DEFAULT 0,
  total_revenue numeric(12,2) NOT NULL DEFAULT 0,
  response_rate numeric(5,2) NOT NULL DEFAULT 0,
  current_streak integer NOT NULL DEFAULT 0,
  longest_streak integer NOT NULL DEFAULT 0,
  last_activity_date date,
  rank_change integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index for leaderboard queries (sorted by points descending)
CREATE INDEX IF NOT EXISTS idx_user_stats_points ON public.user_stats(points DESC);
CREATE INDEX IF NOT EXISTS idx_user_stats_updated ON public.user_stats(updated_at);

-- Create achievements definition table (admin-managed)
CREATE TABLE IF NOT EXISTS public.achievements (
  id serial PRIMARY KEY,
  key text UNIQUE NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  category text NOT NULL,
  rarity text NOT NULL DEFAULT 'common' CHECK (rarity IN ('common', 'uncommon', 'rare', 'epic', 'legendary')),
  points integer NOT NULL DEFAULT 0,
  icon text NOT NULL DEFAULT 'award',
  max_progress integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create user achievements tracking table
CREATE TABLE IF NOT EXISTS public.user_achievements (
  id serial PRIMARY KEY,
  user_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  achievement_id integer NOT NULL REFERENCES public.achievements(id) ON DELETE CASCADE,
  progress integer NOT NULL DEFAULT 0,
  unlocked boolean NOT NULL DEFAULT false,
  unlocked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, achievement_id)
);

-- Indexes for achievement queries
CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON public.user_achievements(user_id);
CREATE INDEX IF NOT EXISTS idx_user_achievements_unlocked ON public.user_achievements(user_id) WHERE unlocked = true;

-- Seed default achievements
INSERT INTO public.achievements (key, name, description, category, rarity, points, icon, max_progress) VALUES
  -- Getting Started
  ('first_steps', 'First Steps', 'Complete your profile setup', 'Getting Started', 'common', 50, 'star', NULL),
  ('hello_world', 'Hello World', 'Send your first campaign message', 'Getting Started', 'common', 100, 'message', NULL),
  ('contact_collector', 'Contact Collector', 'Import your first 100 contacts', 'Getting Started', 'common', 75, 'users', 100),

  -- Campaign Master
  ('campaign_creator', 'Campaign Creator', 'Launch 5 campaigns', 'Campaign Master', 'uncommon', 150, 'rocket', 5),
  ('message_maven', 'Message Maven', 'Send 1,000 messages', 'Campaign Master', 'uncommon', 200, 'message', 1000),
  ('response_magnet', 'Response Magnet', 'Get 100 responses', 'Campaign Master', 'rare', 250, 'zap', 100),
  ('engagement_expert', 'Engagement Expert', 'Achieve 30% response rate on a campaign', 'Campaign Master', 'rare', 300, 'target', NULL),

  -- Deal Closer
  ('first_blood', 'First Blood', 'Close your first deal', 'Deal Closer', 'uncommon', 500, 'trophy', NULL),
  ('dealmaker', 'Dealmaker', 'Close 10 deals', 'Deal Closer', 'rare', 1000, 'trophy', 10),
  ('whale_hunter', 'Whale Hunter', 'Close a deal over $50,000', 'Deal Closer', 'epic', 750, 'dollar', NULL),
  ('revenue_machine', 'Revenue Machine', 'Generate $100,000 in total revenue', 'Deal Closer', 'epic', 1500, 'dollar', 100000),

  -- Networking Pro
  ('network_builder', 'Network Builder', 'Add 500 contacts', 'Networking Pro', 'uncommon', 200, 'users', 500),
  ('conversation_starter', 'Conversation Starter', 'Have 50 active conversations', 'Networking Pro', 'rare', 300, 'message', 50),
  ('relationship_master', 'Relationship Master', 'Convert 25 leads to deals', 'Networking Pro', 'epic', 600, 'users', 25),

  -- Power User
  ('daily_driver', 'Daily Driver', 'Log in 30 consecutive days', 'Power User', 'rare', 400, 'flame', 30),
  ('automation_expert', 'Automation Expert', 'Set up 10 automated sequences', 'Power User', 'uncommon', 350, 'zap', 10),
  ('data_analyst', 'Data Analyst', 'Export 50 analytics reports', 'Power User', 'uncommon', 200, 'target', 50),

  -- Rare & Legendary
  ('platinum_club', 'Platinum Club', 'Generate $500,000 in total revenue', 'Rare & Legendary', 'legendary', 2000, 'crown', 500000),
  ('legend', 'Legend', 'Reach #1 on the leaderboard', 'Rare & Legendary', 'legendary', 1500, 'crown', NULL),
  ('perfectionist', 'Perfectionist', 'Achieve 50% response rate on 5 campaigns', 'Rare & Legendary', 'legendary', 2500, 'sparkles', 5)
ON CONFLICT (key) DO NOTHING;

-- Function to update user stats updated_at timestamp
CREATE OR REPLACE FUNCTION update_user_stats_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for user_stats updated_at
DROP TRIGGER IF EXISTS user_stats_updated_at ON public.user_stats;
CREATE TRIGGER user_stats_updated_at
  BEFORE UPDATE ON public.user_stats
  FOR EACH ROW
  EXECUTE FUNCTION update_user_stats_updated_at();

-- Function to update user_achievements updated_at timestamp
CREATE OR REPLACE FUNCTION update_user_achievements_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for user_achievements updated_at
DROP TRIGGER IF EXISTS user_achievements_updated_at ON public.user_achievements;
CREATE TRIGGER user_achievements_updated_at
  BEFORE UPDATE ON public.user_achievements
  FOR EACH ROW
  EXECUTE FUNCTION update_user_achievements_updated_at();

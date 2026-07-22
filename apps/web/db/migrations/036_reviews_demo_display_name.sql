-- Migration 036 — demo_display_name for reviews
--
-- Demo-seeded reviews (is_demo=true) have no real user_id, so the public API's
-- `LEFT JOIN "user"` produces a NULL name and the page has nothing to render
-- for the reviewer. Rather than fabricate a user_id (which would make a demo
-- row indistinguishable from a real account), this column holds a plainly
-- synthetic display name ONLY for demo rows — real reviews always resolve
-- their name through the user join and never touch this column.
-- ============================================================================

ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS demo_display_name text;

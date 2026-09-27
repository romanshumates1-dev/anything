-- 092: contracts.metadata
--
-- WHY (defect #33)
-- ----------------
-- Three read paths select `contracts.metadata`:
--   src/app/api/contracts/route.ts
--   src/app/api/contracts/[id]/route.ts
--   src/app/api/earnings/route.ts   (exposed to the UI as contract_metadata)
-- but no baseline file and no earlier migration ever created that column, so
-- all three failed with `column c.metadata does not exist` — a 500 on the
-- Contracts list, the contract detail, and the Earnings list for every signed-in
-- user. Verified against both the live database and a from-scratch build of this
-- repository's migrations, so it is code/schema drift, not a missing deploy.
--
-- SHAPE
-- -----
-- `jsonb NOT NULL DEFAULT '{}'`: the UI reads `contract_metadata.property_address`
-- optionally, so an empty object is a valid "nothing recorded yet" and keeps the
-- key present in every row. Additive, nullable in effect, no data rewritten.
--
-- Re-runnable: IF NOT EXISTS, so applying it twice is a no-op.

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.contracts.metadata IS
  'Free-form contract metadata (e.g. property_address) surfaced to the UI as contract_metadata.';

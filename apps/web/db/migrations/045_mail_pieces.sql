-- ============================================================================
-- 045 — mail_pieces: per-piece tracking for direct mail.
--
-- WHY THIS TABLE EXISTS
-- Direct mail is the registration-free seller channel, but it is also the only
-- channel with NO automatic delivery receipt and NO reply-to. An email bounce
-- tells you it failed; an SMS status callback tells you it landed. A postcard
-- tells you nothing at all. Without a per-piece record you cannot answer the
-- only question that matters after a run: which piece produced this call?
--
-- So attribution has to be MANUFACTURED into the artwork itself — a unique
-- code per piece, printed on it, quoted back by the prospect (or embedded in a
-- per-campaign short URL / keyword). This table is the other half of that
-- handshake.
--
-- tracking_code is the natural key and is UNIQUE globally, not per campaign:
-- a prospect reads it off a postcard months later with no campaign context, so
-- the lookup must succeed from the code alone.
--
-- Cost is stored PER PIECE rather than derived from a campaign-level rate:
-- postage and vendor pricing change between runs, and a cost-per-contract
-- figure computed from today's rate applied to last quarter's mail is wrong in
-- a way nobody notices. Recording what was actually paid keeps the ledger
-- honest.
--
-- status is deliberately coarse. A mail vendor's lifecycle (queued/printed/
-- in_transit/delivered) is vendor-specific and mostly unobservable to us;
-- pretending otherwise invents precision we do not have.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.mail_pieces (
  id serial PRIMARY KEY,
  organization_id text NOT NULL REFERENCES public.organizations(id),
  tracking_code text NOT NULL UNIQUE,
  lead_id integer,
  campaign_id text,
  -- Snapshot of where it was actually sent. The lead's address may change or
  -- the lead may be deleted; the piece was still mailed to THIS address, and
  -- an audit needs that to remain true.
  mailing_address text NOT NULL,
  recipient_name text,
  unit_cost_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'exported',
  provider_id text,
  exported_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  created_by text,
  CONSTRAINT mail_pieces_status_check
    CHECK (status IN ('exported', 'sent', 'responded', 'failed'))
);

-- Attribution lookup: a prospect quotes the code, we find the piece. This is
-- the hot path for inbound response handling.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_pieces_code
  ON public.mail_pieces (tracking_code);

CREATE INDEX IF NOT EXISTS idx_mail_pieces_campaign
  ON public.mail_pieces (organization_id, campaign_id);

CREATE INDEX IF NOT EXISTS idx_mail_pieces_lead
  ON public.mail_pieces (lead_id);

COMMENT ON TABLE public.mail_pieces IS
  'One row per printed direct-mail piece. Direct mail has no delivery receipt and no reply-to, so attribution is manufactured via a unique tracking_code printed on the artwork and quoted back by the prospect.';

COMMENT ON COLUMN public.mail_pieces.unit_cost_cents IS
  'What this piece actually cost, not a rate applied later. Postage/vendor pricing drifts between runs; deriving historical cost from a current rate silently corrupts cost-per-contract.';

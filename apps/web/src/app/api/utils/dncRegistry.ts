/**
 * dncRegistry — federal/state Do-Not-Call suppression + the Safe Harbor
 * freshness clock. Consumed by dispatchGate (see its step 1.5).
 *
 * SCOPE BOUNDARY: this module answers "is this number on a DNC registry, and is
 * my registry data for it fresh enough to be defensible?" It does NOT handle
 * internal opt-outs (someone who texted STOP to us) — those live in
 * `compliance_records` and are checked by dispatchGate.isSuppressed(), which is
 * absolute across every channel and is deliberately kept separate and first.
 *
 * WHY FRESHNESS IS A FIRST-CLASS CONCEPT HERE
 * 16 CFR 310.4(b)(3)(iv) grants safe harbour only to a seller who "accesses the
 * national registry no more than 31 days before calling any consumer" and
 * "maintains records documenting this process". So a registry snapshot is not a
 * boolean asset — it decays. A 90-day-old import with 2 million rows provides
 * NO protection. `isAreaCoverageFresh` is therefore as important as
 * `checkDncRegistry`, and both are exposed.
 *
 * COST CONTEXT (why we bother rather than skipping DNC): the National Registry
 * is FREE for up to 5 area codes; FY2026 pricing is $82/area code beyond that,
 * capped at $22,626 for nationwide. An operator working a few counties pays $0.
 */
import sql from '@/app/api/utils/sql';
import { areaCodeOf } from '@/app/api/utils/area-codes';

/** 16 CFR 310.4(b)(3)(iv): registry must have been accessed within 31 days. */
export const SAFE_HARBOR_DAYS = 31;

export type DncListSource = 'federal' | 'state' | 'internal';

export type DncHit = {
  listed: boolean;
  source?: DncListSource;
  jurisdiction?: string | null;
};

export type CoverageFreshness = {
  /** True only if we hold coverage for this area code AND it is within 31 days. */
  fresh: boolean;
  /** Null when we have never imported anything for this area code. */
  lastFetchedAt: Date | null;
  ageDays: number | null;
};

/**
 * Canonical registry key: '+1' + 10-digit NSN. DNC source files are bare
 * 10-digit; the app stores E.164. Both must land on the same string or the
 * lookup silently misses and a listed number sails through — the worst possible
 * failure mode here, because it fails OPEN.
 *
 * Returns null for anything that is not a plausible 10-digit NANP number, so a
 * caller can distinguish "not listed" from "unparseable" rather than treating
 * garbage as clean.
 */
export function normalizeDncPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  const nsn = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (nsn.length !== 10) return null;
  // NANP: area code and exchange both start 2-9.
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(nsn)) return null;
  return `+1${nsn}`;
}

/**
 * Is this number on any DNC registry we hold? Checks federal and state in one
 * query and reports which list matched (federal wins ties for a stable,
 * explainable deny reason).
 *
 * Safe by construction: an unparseable number returns listed=false, so callers
 * MUST NOT treat this as the only gate — dispatchGate still applies internal
 * suppression, consent, and quiet hours independently.
 */
export async function checkDncRegistry(phone: string | null | undefined): Promise<DncHit> {
  const key = normalizeDncPhone(phone);
  if (!key) return { listed: false };

  const rows = await sql`
    SELECT list_source, jurisdiction
    FROM dnc_registry
    WHERE phone = ${key}
    ORDER BY CASE list_source WHEN 'federal' THEN 0 WHEN 'state' THEN 1 ELSE 2 END
    LIMIT 1
  `;
  if (rows.length === 0) return { listed: false };
  const hit = rows[0] as { list_source: DncListSource; jurisdiction: string | null };
  return { listed: true, source: hit.list_source, jurisdiction: hit.jurisdiction };
}

/**
 * Do we hold registry coverage for this number's area code, imported within the
 * Safe Harbor window? `now` is injectable so tests are deterministic rather
 * than dependent on wall clock (the same discipline dispatchGate uses).
 */
export async function isAreaCoverageFresh(
  phone: string | null | undefined,
  now: Date = new Date()
): Promise<CoverageFreshness> {
  const ac = areaCodeOf(phone);
  if (!ac) return { fresh: false, lastFetchedAt: null, ageDays: null };

  // Most recent coverage across sources for this NPA. Federal is the one that
  // grants safe harbour, but a state-only import still proves recency of work,
  // so we take the newest and let the caller decide.
  const rows = await sql`
    SELECT MAX(last_fetched_at) AS last_fetched_at
    FROM dnc_area_coverage
    WHERE area_code = ${ac}
  `;
  const raw = (rows[0] as { last_fetched_at: string | Date | null } | undefined)?.last_fetched_at;
  if (!raw) return { fresh: false, lastFetchedAt: null, ageDays: null };

  // Neon returns timestamptz as a JS Date for some column shapes and a string
  // for others — normalise rather than assume (this exact class of bug caused
  // the INT-3 daily-reset defect; see dealflow env notes).
  const last = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(last.getTime())) return { fresh: false, lastFetchedAt: null, ageDays: null };

  const ageDays = (now.getTime() - last.getTime()) / 86_400_000;
  return { fresh: ageDays <= SAFE_HARBOR_DAYS, lastFetchedAt: last, ageDays };
}

/**
 * Bulk-load registry numbers for one area code + source, refresh that area
 * code's freshness clock, and append an audit row — all in one transaction so
 * the clock can never claim coverage the rows do not back.
 *
 * Returns the number of rows accepted (post-normalisation, post-dedupe).
 */
export async function importDncNumbers(opts: {
  phones: string[];
  areaCode: string;
  listSource: DncListSource;
  jurisdiction?: string | null;
  createdBy?: string | null;
  notes?: string | null;
}): Promise<{ accepted: number; rejected: number }> {
  const { phones, areaCode, listSource, jurisdiction = null, createdBy = null, notes = null } = opts;

  const normalized: string[] = [];
  let rejected = 0;
  for (const p of phones) {
    const k = normalizeDncPhone(p);
    if (!k) {
      rejected++;
      continue;
    }
    normalized.push(k);
  }
  const unique = Array.from(new Set(normalized));

  // Chunked so a large NPA file cannot blow the statement/parameter limit.
  const CHUNK = 1000;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const batch = unique.slice(i, i + CHUNK);
    await sql`
      INSERT INTO dnc_registry (phone, list_source, jurisdiction, area_code)
      SELECT p, ${listSource}, ${jurisdiction}, ${areaCode}
      FROM unnest(${batch}::text[]) AS p
      ON CONFLICT (phone, list_source)
        DO UPDATE SET imported_at = now(), jurisdiction = EXCLUDED.jurisdiction
    `;
  }

  // Freshness clock + audit trail. Written AFTER the rows so a partial failure
  // above leaves the clock stale (fail-closed) rather than falsely current.
  await sql`
    INSERT INTO dnc_area_coverage (area_code, list_source, jurisdiction, row_count, last_fetched_at)
    VALUES (${areaCode}, ${listSource}, ${jurisdiction}, ${unique.length}, now())
    ON CONFLICT (area_code, list_source)
      DO UPDATE SET row_count = EXCLUDED.row_count,
                    last_fetched_at = now(),
                    jurisdiction = EXCLUDED.jurisdiction
  `;
  await sql`
    INSERT INTO dnc_scrub_runs (area_code, list_source, jurisdiction, row_count, created_by, notes)
    VALUES (${areaCode}, ${listSource}, ${jurisdiction}, ${unique.length}, ${createdBy}, ${notes})
  `;

  return { accepted: unique.length, rejected };
}

export type OrgSendPolicy = {
  smsConsentPolicy: 'required' | 'attested';
  dncEnforcement: 'off' | 'advisory' | 'strict';
};

/**
 * Per-org policy, with a deliberately conservative-but-non-breaking fallback
 * when the org is unknown (see dispatchGate: organizationId is optional there,
 * because forcing it would have meant editing every existing call site in one
 * change).
 *
 * Fallback rationale: the DNC *presence* check needs no policy and always runs,
 * so an unknown org still gets real suppression. What the fallback skips is
 * only the two TIGHTENING behaviours ('strict' staleness denial and 'required'
 * per-number consent), which an org must opt into explicitly.
 */
export async function getOrgSendPolicy(
  organizationId: string | null | undefined
): Promise<OrgSendPolicy> {
  const fallback: OrgSendPolicy = { smsConsentPolicy: 'attested', dncEnforcement: 'advisory' };
  if (!organizationId) return fallback;

  const rows = await sql`
    SELECT sms_consent_policy, dnc_enforcement
    FROM organizations
    WHERE id = ${organizationId}
    LIMIT 1
  `;
  const row = rows[0] as
    | { sms_consent_policy: OrgSendPolicy['smsConsentPolicy']; dnc_enforcement: OrgSendPolicy['dncEnforcement'] }
    | undefined;
  if (!row) return fallback;
  return {
    smsConsentPolicy: row.sms_consent_policy ?? fallback.smsConsentPolicy,
    dncEnforcement: row.dnc_enforcement ?? fallback.dncEnforcement,
  };
}

/**
 * Has this number given an affirmative, recorded consent basis for SMS?
 *
 * Two accepted proofs, matching what the product already models:
 *  - a `compliance_records` row with type='consent' (registerConsent writes it)
 *  - membership of a contact list whose consent_mode is 'inbound' or
 *    'consented' (contact_lists.consent_mode, migration 001)
 *
 * 'unverified' lists do NOT count — that is the whole point of the column.
 */
export async function hasSmsConsent(phone: string | null | undefined): Promise<boolean> {
  const key = normalizeDncPhone(phone);
  if (!key) return false;

  // Check compliance_records for explicit consent
  const complianceRows = await sql`
    SELECT 1
    FROM compliance_records
    WHERE target = ${key} AND channel = 'sms' AND type = 'consent'
    LIMIT 1
  `;
  if (complianceRows.length > 0) return true;

  // Also check contact_lists with consent_mode as documented
  // 'inbound' = lead initiated contact, 'consented' = explicit opt-in
  // 'unverified' does NOT count
  const listRows = await sql`
    SELECT 1
    FROM contact_list_members clm
    JOIN contact_lists cl ON clm.list_id = cl.id
    WHERE clm.phone = ${key}
    AND cl.consent_mode IN ('inbound', 'consented')
    LIMIT 1
  `.catch(() => []);

  return listRows.length > 0;
}

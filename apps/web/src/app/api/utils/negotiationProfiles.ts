/**
 * Phase N — negotiation profile store (thin DB I/O around the pure engine).
 * The valuation math lives in valuationEngine.ts (no DB, unit-tested); this
 * file just loads/saves profiles and maps a DB row to the engine's params.
 */
import sql from '@/app/api/utils/sql';
import type { NegotiationProfileParams } from './valuationEngine';

export interface NegotiationProfile extends NegotiationProfileParams {
  id: string;
  name: string;
  segment: string | null;
  active: boolean;
  tone: 'direct-respectful' | 'consultative' | 'white-glove';
  cadenceOverrides: Record<string, unknown>;
  allowsColdOutbound: boolean;
  doubleCloseAdvisory: boolean;
}

type Row = Record<string, any>;

function toProfile(r: Row): NegotiationProfile {
  return {
    id: r.id,
    name: r.name,
    segment: r.segment,
    active: r.active,
    arvMultiplier: Number(r.arv_multiplier),
    repairLightPsf: Number(r.repair_light_psf),
    repairModeratePsf: Number(r.repair_moderate_psf),
    repairHeavyPsf: Number(r.repair_heavy_psf),
    bigTicketAdders: r.big_ticket_adders ?? {},
    minFee: Number(r.min_fee),
    feeTargetMax: Number(r.fee_target_max),
    openerPctOfMax: Number(r.opener_pct_of_max),
    tone: r.tone,
    cadenceOverrides: r.cadence_overrides ?? {},
    allowsColdOutbound: r.allows_cold_outbound,
    requiresManualComps: r.requires_manual_comps,
    doubleCloseAdvisory: r.double_close_advisory,
  };
}

export async function listProfiles(): Promise<NegotiationProfile[]> {
  const rows = (await sql`SELECT * FROM negotiation_profiles ORDER BY min_fee`) as Row[];
  return rows.map(toProfile);
}

export async function getProfile(id: string): Promise<NegotiationProfile | null> {
  const [row] = (await sql`SELECT * FROM negotiation_profiles WHERE id = ${id}`) as Row[];
  return row ? toProfile(row) : null;
}

/** The profile that applies to a campaign (its assigned profile, else the
 *  standard free-list default). Used by the send path to read allows_cold_outbound. */
export async function profileForCampaign(campaignId: string): Promise<NegotiationProfile | null> {
  const [row] = (await sql`
    SELECT np.* FROM outreach_campaigns oc
    LEFT JOIN negotiation_profiles np ON np.id = oc.negotiation_profile_id
    WHERE oc.id = ${campaignId}
  `) as Row[];
  if (row?.id) return toProfile(row);
  const [def] = (await sql`SELECT * FROM negotiation_profiles WHERE id = 'standard_distressed'`) as Row[];
  return def ? toProfile(def) : null;
}

const NUM_FIELDS: Record<string, string> = {
  arvMultiplier: 'arv_multiplier',
  repairLightPsf: 'repair_light_psf',
  repairModeratePsf: 'repair_moderate_psf',
  repairHeavyPsf: 'repair_heavy_psf',
  minFee: 'min_fee',
  feeTargetMax: 'fee_target_max',
  openerPctOfMax: 'opener_pct_of_max',
};

export interface ProfileInput {
  name: string;
  segment?: string | null;
  arvMultiplier: number;
  repairLightPsf?: number;
  repairModeratePsf?: number;
  repairHeavyPsf?: number;
  bigTicketAdders?: Record<string, number | 'ESCALATE'>;
  minFee: number;
  feeTargetMax: number;
  openerPctOfMax: number;
  tone?: string;
  cadenceOverrides?: Record<string, unknown>;
  allowsColdOutbound?: boolean;
  requiresManualComps?: boolean;
  doubleCloseAdvisory?: boolean;
}

/** Validate a profile payload. Returns an error string or null. */
export function validateProfileInput(p: Partial<ProfileInput>): string | null {
  if (!p.name || typeof p.name !== 'string') return 'name is required';
  for (const [k] of Object.entries(NUM_FIELDS)) {
    const v = (p as any)[k];
    if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) return `${k} must be a non-negative number`;
  }
  if (p.arvMultiplier !== undefined && (p.arvMultiplier <= 0 || p.arvMultiplier > 1)) return 'arvMultiplier must be in (0, 1]';
  if (p.openerPctOfMax !== undefined && (p.openerPctOfMax <= 0 || p.openerPctOfMax > 1)) return 'openerPctOfMax must be in (0, 1]';
  if (p.tone !== undefined && !['direct-respectful', 'consultative', 'white-glove'].includes(p.tone)) return 'invalid tone';
  return null;
}

export async function createProfile(p: ProfileInput): Promise<NegotiationProfile> {
  const id = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `profile_${Date.now()}`;
  const [row] = (await sql`
    INSERT INTO negotiation_profiles
      (id, name, segment, arv_multiplier, repair_light_psf, repair_moderate_psf, repair_heavy_psf,
       big_ticket_adders, min_fee, fee_target_max, opener_pct_of_max, tone, cadence_overrides,
       allows_cold_outbound, requires_manual_comps, double_close_advisory)
    VALUES (${id}, ${p.name}, ${p.segment ?? null}, ${p.arvMultiplier},
       ${p.repairLightPsf ?? 0}, ${p.repairModeratePsf ?? 0}, ${p.repairHeavyPsf ?? 0},
       ${JSON.stringify(p.bigTicketAdders ?? {})}::jsonb, ${p.minFee}, ${p.feeTargetMax}, ${p.openerPctOfMax},
       ${p.tone ?? 'direct-respectful'}, ${JSON.stringify(p.cadenceOverrides ?? {})}::jsonb,
       ${p.allowsColdOutbound ?? true}, ${p.requiresManualComps ?? false}, ${p.doubleCloseAdvisory ?? false})
    RETURNING *
  `) as Row[];
  return toProfile(row);
}

export async function updateProfile(id: string, patch: Partial<ProfileInput>): Promise<NegotiationProfile | null> {
  // Read-modify-write keeps this simple and avoids dynamic SQL assembly.
  const existing = await getProfile(id);
  if (!existing) return null;
  const merged: ProfileInput = {
    name: patch.name ?? existing.name,
    segment: patch.segment ?? existing.segment,
    arvMultiplier: patch.arvMultiplier ?? existing.arvMultiplier,
    repairLightPsf: patch.repairLightPsf ?? existing.repairLightPsf,
    repairModeratePsf: patch.repairModeratePsf ?? existing.repairModeratePsf,
    repairHeavyPsf: patch.repairHeavyPsf ?? existing.repairHeavyPsf,
    bigTicketAdders: patch.bigTicketAdders ?? existing.bigTicketAdders,
    minFee: patch.minFee ?? existing.minFee,
    feeTargetMax: patch.feeTargetMax ?? existing.feeTargetMax,
    openerPctOfMax: patch.openerPctOfMax ?? existing.openerPctOfMax,
    tone: patch.tone ?? existing.tone,
    cadenceOverrides: patch.cadenceOverrides ?? existing.cadenceOverrides,
    allowsColdOutbound: patch.allowsColdOutbound ?? existing.allowsColdOutbound,
    requiresManualComps: patch.requiresManualComps ?? existing.requiresManualComps,
    doubleCloseAdvisory: patch.doubleCloseAdvisory ?? existing.doubleCloseAdvisory,
  };
  const [row] = (await sql`
    UPDATE negotiation_profiles SET
      name = ${merged.name}, segment = ${merged.segment ?? null}, arv_multiplier = ${merged.arvMultiplier},
      repair_light_psf = ${merged.repairLightPsf}, repair_moderate_psf = ${merged.repairModeratePsf},
      repair_heavy_psf = ${merged.repairHeavyPsf}, big_ticket_adders = ${JSON.stringify(merged.bigTicketAdders)}::jsonb,
      min_fee = ${merged.minFee}, fee_target_max = ${merged.feeTargetMax}, opener_pct_of_max = ${merged.openerPctOfMax},
      tone = ${merged.tone}, cadence_overrides = ${JSON.stringify(merged.cadenceOverrides)}::jsonb,
      allows_cold_outbound = ${merged.allowsColdOutbound}, requires_manual_comps = ${merged.requiresManualComps},
      double_close_advisory = ${merged.doubleCloseAdvisory}, updated_at = now()
    WHERE id = ${id} RETURNING *
  `) as Row[];
  return row ? toProfile(row) : null;
}

export async function getProfileVersions(profileId: string): Promise<Array<{ version: number; snapshot: NegotiationProfile; changedBy: string | null; changeReason: string | null; createdAt: Date }>> {
  const rows = (await sql`
    SELECT version, snapshot, changed_by, change_reason, created_at
      FROM negotiation_profile_versions
     WHERE profile_id = ${profileId}
     ORDER BY version DESC
  `) as Array<Record<string, any>>;
  return rows.map((r) => ({
    version: Number(r.version),
    snapshot: r.snapshot as NegotiationProfile,
    changedBy: r.changed_by,
    changeReason: r.change_reason,
    createdAt: new Date(r.created_at),
  }));
}

export async function rollbackProfileToVersion(profileId: string, targetVersion: number): Promise<NegotiationProfile | null> {
  const [row] = (await sql`
    SELECT public.rollback_negotiation_profile(${profileId}, ${targetVersion}) AS profile
  `) as Array<Record<string, any>>;
  if (!row?.profile) return null;
  return toProfile(row.profile as Row);
}

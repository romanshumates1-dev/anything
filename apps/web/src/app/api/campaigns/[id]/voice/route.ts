/**
 * GET  /api/campaigns/[id]/voice — REQUIREMENT SET T: read + explain the voice.
 * POST /api/campaigns/[id]/voice — set the mode, and for `manual` the voice.
 *
 * GET returns the catalogue, the campaign's current mode/voice, and a live
 * `resolution` explaining what Auto WOULD choose right now. The `stale` flag
 * compares the persisted context fingerprint against the current one, so an
 * operator can see at a glance whether the deployed voice still matches the
 * campaign as configured today.
 *
 * AUTHORIZATION
 * -------------
 * Session required, then the campaign is loaded by BOTH id and organization_id.
 * A campaign id from another tenant returns 404, not 403: a 403 would confirm
 * the id exists, which is itself a cross-tenant information leak.
 */
import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { getOrganization } from '@/lib/organization-context';
import sql from '@/app/api/utils/sql';
import {
  AUTO_VOICE_CATALOG,
  resolveVoiceSelection,
  type VoiceSelectionContext,
  type VoiceSelectionMode,
} from '@/app/api/utils/voiceSelection';

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface CampaignRow {
  objective_type?: string | null;
  channels?: string[] | null;
  market?: string | null;
  voice_selection_mode?: string | null;
  voice_id?: string | null;
  voice_resolved_from?: string | null;
  ai_tone?: string | null;
  automation_level?: string | null;
}

/** Map a campaign/settings row to the context the recommender reads. */
function toVoiceContext(row: CampaignRow): VoiceSelectionContext {
  return {
    aiTone: row.ai_tone ?? undefined,
    automationLevel: row.automation_level ?? undefined,
    market: row.market ?? undefined,
    channels: row.channels ?? undefined,
    objectiveType: row.objective_type ?? undefined,
  };
}

/** Session + tenant resolution shared by both verbs. */
async function authorize() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const organization = await getOrganization();
  if (!organization) {
    return {
      response: NextResponse.json({ error: 'No organization found' }, { status: 403 }),
    };
  }
  return { session, organization };
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const authz = await authorize();
  if (authz.response) return authz.response;
  const { organization } = authz as { organization: { id: string } };

  const { id: campaignId } = await params;

  const [campaign] = (await sql`
    SELECT oc.id,
           oc.objective_type,
           oc.channels,
           oc.market,
           cs.voice_selection_mode,
           cs.voice_id,
           cs.voice_resolved_from,
           cs.ai_tone,
           cs.automation_level
    FROM outreach_campaigns oc
    LEFT JOIN campaign_settings cs ON cs.campaign_id = oc.id
    WHERE oc.id = ${campaignId} AND oc.organization_id = ${organization.id}
    LIMIT 1
  `) as CampaignRow[];

  if (!campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  const mode: VoiceSelectionMode =
    campaign.voice_selection_mode === 'manual' ? 'manual' : 'auto';

  const resolution = resolveVoiceSelection({
    mode,
    selectedVoiceId: campaign.voice_id,
    context: toVoiceContext(campaign),
    previouslyResolvedVoiceId: campaign.voice_id,
  });

  return NextResponse.json({
    campaignId,
    mode,
    currentVoiceId: campaign.voice_id ?? null,
    catalog: AUTO_VOICE_CATALOG,
    resolution,
    /**
     * True when the persisted voice was derived from a different context than
     * the campaign has today — something material changed after the voice was
     * resolved. Manual mode is never stale by definition: the operator's choice
     * does not depend on context.
     */
    stale:
      mode === 'auto' &&
      campaign.voice_resolved_from != null &&
      campaign.voice_resolved_from !== resolution.contextFingerprint,
  });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const authz = await authorize();
  if (authz.response) return authz.response;
  const { organization } = authz as { organization: { id: string } };

  const { id: campaignId } = await params;

  let body: { mode?: string; voiceId?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (body.mode !== 'auto' && body.mode !== 'manual') {
    return NextResponse.json(
      { error: "mode must be 'auto' or 'manual'" },
      { status: 400 },
    );
  }

  const [campaign] = (await sql`
    SELECT oc.id, oc.objective_type, oc.channels, oc.market,
           cs.voice_id, cs.ai_tone, cs.automation_level
    FROM outreach_campaigns oc
    LEFT JOIN campaign_settings cs ON cs.campaign_id = oc.id
    WHERE oc.id = ${campaignId} AND oc.organization_id = ${organization.id}
    LIMIT 1
  `) as CampaignRow[];

  if (!campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  const resolution = resolveVoiceSelection({
    mode: body.mode,
    selectedVoiceId: body.voiceId ?? campaign.voice_id,
    context: toVoiceContext(campaign),
    previouslyResolvedVoiceId: campaign.voice_id,
  });

  // A manual save naming a voice that does not exist must be REJECTED, not
  // silently downgraded to auto — otherwise the operator's explicit choice is
  // discarded and they are shown a recommendation they never asked for.
  if (body.mode === 'manual' && resolution.error === 'UNKNOWN_MANUAL_VOICE') {
    return NextResponse.json(
      { error: 'Unknown voice', detail: 'voiceId is not in the voice catalogue' },
      { status: 400 },
    );
  }

  // UPDATE ... WHERE both ids: a campaign without a settings row yet simply
  // matches nothing. The INSERT-if-missing path lives in saveCampaignSettings;
  // this endpoint only ever changes an EXISTING selection, so it must not
  // create a settings row that would omit every other column's default.
  const updated = await sql`
    UPDATE campaign_settings
    SET voice_selection_mode = ${body.mode},
        voice_id = ${resolution.voiceId},
        voice_resolved_from = ${resolution.contextFingerprint},
        voice_resolved_at = NOW(),
        updated_at = NOW()
    WHERE campaign_id = ${campaignId} AND organization_id = ${organization.id}
    RETURNING campaign_id
  `;

  if (updated.length === 0) {
    return NextResponse.json(
      { error: 'Campaign has no settings row to update' },
      { status: 409 },
    );
  }

  return NextResponse.json({
    campaignId,
    mode: body.mode,
    voiceId: resolution.voiceId,
    resolution,
  });
}

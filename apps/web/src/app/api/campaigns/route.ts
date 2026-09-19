import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { logEvent } from '../utils/logger';
import { getOrganization } from '@/lib/organization-context';
import { checkLimit, recordMetricUsage } from '@/app/api/services/tierLimits';
import {
  type CampaignConfig,
  validateCampaignConfig,
  estimateCampaignCost,
  mergeWithDefaults,
  toEngineSettings,
} from '@/app/api/utils/campaignBuilder';

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Tenant-isolation fix (legacy campaigns/campaign_leads had no
  // organization_id at all — see migration 042): every campaign must be
  // stamped with its creator's organization from the moment it's created.
  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization found' }, { status: 403 });
  }

  try {
    const body = await request.json();

    // Support both legacy (name + message_template) and new builder config
    const isBuilderConfig = body.config && typeof body.config === 'object';

    if (isBuilderConfig) {
      // New 10-step builder flow
      const partialConfig = body.config as Partial<CampaignConfig>;
      const config = mergeWithDefaults(partialConfig);

      // Validate the complete configuration
      const validation = validateCampaignConfig(config);
      if (!validation.valid) {
        return Response.json({
          error: 'validation_failed',
          errors: validation.errors,
          warnings: validation.warnings,
        }, { status: 400 });
      }

      // Check tier limits before creating campaign
      const limitCheck = await checkLimit(organization.id, 'campaign');
      if (!limitCheck.allowed) {
        return Response.json({
          error: 'limit_exceeded',
          message: limitCheck.message,
          upgradeReason: limitCheck.upgradeReason,
          current: limitCheck.current,
          limit: limitCheck.limit,
          isFreeTier: limitCheck.isFreeTier,
        }, { status: 402 });
      }

      // Estimate campaign cost
      const leadCount = config.leadSource.count || 100; // Default estimate
      const costEstimate = estimateCampaignCost(config, leadCount);

      // Check if estimated cost exceeds budget
      if (config.budget.maxCredits > 0 && costEstimate.credits > config.budget.maxCredits) {
        return Response.json({
          error: 'budget_exceeded',
          message: `Estimated cost (${costEstimate.credits} credits) exceeds budget (${config.budget.maxCredits} credits)`,
          estimate: costEstimate,
        }, { status: 400 });
      }

      // Convert to engine settings for storage
      const engineSettings = toEngineSettings(config);

      // Extract first template from sequence if available
      const firstPhase = config.sequence.find((p) => p.enabled);
      const messageTemplate = firstPhase?.template || '';

      const [campaign] = await sql`
        INSERT INTO campaigns (
          name,
          message_template,
          organization_id,
          config,
          settings
        )
        VALUES (
          ${config.name || 'Untitled Campaign'},
          ${messageTemplate},
          ${organization.id},
          ${JSON.stringify(config)},
          ${JSON.stringify(engineSettings)}
        )
        RETURNING *
      `;

      await logEvent(
        'campaign_created',
        'campaign',
        campaign.id.toString(),
        {
          name: config.name,
          objective: config.objective.type,
          channels: Object.entries(config.channels).filter(([, v]) => v).map(([k]) => k),
          phaseCount: config.sequence.filter((p) => p.enabled).length,
          estimatedCost: costEstimate.credits,
        },
        session.user.id
      );

      // Record usage for tier tracking
      await recordMetricUsage(organization.id, 'campaign');

      return Response.json({
        ...campaign,
        costEstimate,
        validation: { warnings: validation.warnings },
      });
    }

    // Legacy flow: simple name + message_template
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const template = typeof body.message_template === 'string' ? body.message_template.trim() : '';

    if (!name || !template) {
      return Response.json({ error: 'Name and message_template are required' }, { status: 400 });
    }

    // Check tier limits before creating campaign
    const limitCheck = await checkLimit(organization.id, 'campaign');
    if (!limitCheck.allowed) {
      return Response.json({
        error: 'limit_exceeded',
        message: limitCheck.message,
        upgradeReason: limitCheck.upgradeReason,
        current: limitCheck.current,
        limit: limitCheck.limit,
        isFreeTier: limitCheck.isFreeTier,
      }, { status: 402 }); // 402 Payment Required
    }

    const [campaign] = await sql`
      INSERT INTO campaigns (name, message_template, organization_id)
      VALUES (${name}, ${template}, ${organization.id})
      RETURNING *
    `;

    await logEvent(
      'campaign_created',
      'campaign',
      campaign.id.toString(),
      { name },
      session.user.id
    );

    // Record usage for tier tracking
    await recordMetricUsage(organization.id, 'campaign');

    return Response.json(campaign);
  } catch (error: any) {
    console.error('POST /api/campaigns error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Tenant-isolation fix: this route previously returned every org's
  // campaigns with no filtering at all.
  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization found' }, { status: 403 });
  }

  try {
    const campaigns = await sql`
      SELECT
        c.*,
        COUNT(cl.id) AS member_count,
        COUNT(cl.id) FILTER (WHERE cl.status = 'sent') AS sent_count
      FROM campaigns c
      LEFT JOIN campaign_leads cl ON cl.campaign_id = c.id
      WHERE c.organization_id = ${organization.id}
      GROUP BY c.id
      ORDER BY c.created_at DESC
      LIMIT 100
    `;
    return Response.json(campaigns);
  } catch (error: any) {
    console.error('GET /api/campaigns error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

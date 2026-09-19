/**
 * Campaign Automation API
 *
 * GET  - Get automation dashboard data (metrics, status, attention items)
 * POST - Enable/disable automation, update settings
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getOrganization } from '@/lib/organization-context';
import { headers } from 'next/headers';
import {
  getCampaignMetrics,
  getCampaignStatus,
  getHumanAttentionItems,
  enableCampaignAutomation,
  disableCampaignAutomation,
  saveCampaignSettings,
  type CampaignSettings,
} from '@/app/api/utils/campaignEngine';
import { logEvent } from '@/app/api/utils/logger';
import sql from '@/app/api/utils/sql';

/**
 * GET /api/campaigns/automation
 *
 * Query params:
 * - campaignId: Get specific campaign data
 * - view: 'dashboard' | 'attention' | 'metrics' | 'status'
 */
export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization found' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const campaignId = searchParams.get('campaignId');
  const view = searchParams.get('view') || 'dashboard';

  try {
    if (view === 'attention') {
      // Get items needing human attention
      const items = await getHumanAttentionItems(organization.id);
      return NextResponse.json({ items });
    }

    if (campaignId) {
      // Get specific campaign data
      if (view === 'metrics') {
        const metrics = await getCampaignMetrics(campaignId);
        return NextResponse.json({ metrics });
      }

      if (view === 'status') {
        const status = await getCampaignStatus(campaignId);
        return NextResponse.json({ status });
      }

      // Default: full dashboard for campaign
      const [metrics, status] = await Promise.all([
        getCampaignMetrics(campaignId),
        getCampaignStatus(campaignId),
      ]);

      // Get settings
      const [settings] = await sql`
        SELECT * FROM campaign_settings WHERE campaign_id = ${campaignId}
      `;

      return NextResponse.json({
        campaignId,
        metrics,
        status,
        settings: settings ? {
          regions: settings.target_regions || [],
          propertyTypes: settings.target_property_types || [],
          priceRange: {
            min: settings.target_price_min,
            max: settings.target_price_max,
          },
          sendWindow: {
            start: settings.send_window_start,
            end: settings.send_window_end,
          },
          sendDays: settings.send_days,
          touchDelays: settings.touch_delays,
          automationLevel: settings.automation_level,
          autoSendEnabled: settings.auto_send_enabled,
          autoNegotiateEnabled: settings.auto_negotiate_enabled,
          autoContractEnabled: settings.auto_contract_enabled,
          humanReviewThreshold: settings.human_review_threshold,
          maxAutoCounters: settings.max_auto_counters,
          responseTimeoutHours: settings.response_timeout_hours,
          maxTouches: settings.max_touches,
          aiTone: settings.ai_tone,
          aiPersonalizationLevel: settings.ai_personalization_level,
          abTestingEnabled: settings.ab_testing_enabled,
        } : null,
      });
    }

    // Dashboard overview: all campaigns with automation
    const campaigns = await sql`
      SELECT
        oc.id,
        oc.name,
        oc.direction,
        oc.status,
        oc.automation_enabled,
        oc.last_automation_run,
        oc.automation_paused_reason,
        (SELECT COUNT(*) FROM campaign_contacts cc WHERE cc.campaign_id = oc.id) as total_contacts,
        (SELECT COUNT(*) FROM campaign_automation_state cas WHERE cas.campaign_id = oc.id AND cas.routed_to_human = true AND cas.outcome IS NULL) as pending_human_review,
        (SELECT COUNT(*) FROM campaign_automation_state cas WHERE cas.campaign_id = oc.id AND cas.routed_to_negotiation = true AND cas.outcome IS NULL) as in_negotiation,
        (SELECT COUNT(*) FROM campaign_automation_state cas WHERE cas.campaign_id = oc.id AND cas.outcome = 'contract') as contracts_signed
      FROM outreach_campaigns oc
      WHERE oc.organization_id = ${organization.id}
        AND oc.status IN ('ACTIVE', 'PAUSED')
      ORDER BY oc.updated_at DESC
      LIMIT 50
    `;

    const attentionItems = await getHumanAttentionItems(organization.id);

    return NextResponse.json({
      campaigns,
      attentionItems: attentionItems.slice(0, 10),
      summary: {
        totalActiveCampaigns: campaigns.filter((c: any) => c.status === 'ACTIVE').length,
        totalAutomationEnabled: campaigns.filter((c: any) => c.automation_enabled).length,
        totalPendingHumanReview: attentionItems.length,
        totalInNegotiation: campaigns.reduce((sum: number, c: any) => sum + Number(c.in_negotiation || 0), 0),
      },
    });
  } catch (error: any) {
    console.error('GET /api/campaigns/automation error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * POST /api/campaigns/automation
 *
 * Actions:
 * - enable: Enable automation for a campaign
 * - disable: Disable automation for a campaign
 * - settings: Update campaign settings
 */
export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization found' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { action, campaignId, settings, reason } = body as {
      action: 'enable' | 'disable' | 'settings';
      campaignId: string;
      settings?: Partial<CampaignSettings>;
      reason?: string;
    };

    if (!campaignId) {
      return NextResponse.json({ error: 'campaignId is required' }, { status: 400 });
    }

    // Verify campaign belongs to org
    const [campaign] = await sql`
      SELECT id FROM outreach_campaigns
      WHERE id = ${campaignId} AND organization_id = ${organization.id}
    `;

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    switch (action) {
      case 'enable': {
        const result = await enableCampaignAutomation(campaignId, organization.id);
        if (!result.success) {
          return NextResponse.json({ error: result.error }, { status: 400 });
        }
        return NextResponse.json({ success: true, message: 'Automation enabled' });
      }

      case 'disable': {
        const result = await disableCampaignAutomation(campaignId, organization.id, reason);
        if (!result.success) {
          return NextResponse.json({ error: result.error }, { status: 400 });
        }
        return NextResponse.json({ success: true, message: 'Automation disabled' });
      }

      case 'settings': {
        if (!settings) {
          return NextResponse.json({ error: 'settings is required for settings action' }, { status: 400 });
        }

        // Validate settings
        if (settings.maxTouches !== undefined && (settings.maxTouches < 1 || settings.maxTouches > 10)) {
          return NextResponse.json({ error: 'maxTouches must be between 1 and 10' }, { status: 400 });
        }

        if (settings.maxAutoCounters !== undefined && (settings.maxAutoCounters < 1 || settings.maxAutoCounters > 10)) {
          return NextResponse.json({ error: 'maxAutoCounters must be between 1 and 10' }, { status: 400 });
        }

        if (settings.responseTimeoutHours !== undefined && (settings.responseTimeoutHours < 24 || settings.responseTimeoutHours > 336)) {
          return NextResponse.json({ error: 'responseTimeoutHours must be between 24 and 336 (2 weeks)' }, { status: 400 });
        }

        const result = await saveCampaignSettings(campaignId, organization.id, settings);
        if (!result.success) {
          return NextResponse.json({ error: result.error }, { status: 400 });
        }

        await logEvent('campaign_settings_updated', 'campaign', campaignId, {
          settings: Object.keys(settings),
        }, session.user.id);

        return NextResponse.json({ success: true, message: 'Settings saved' });
      }

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error: any) {
    console.error('POST /api/campaigns/automation error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

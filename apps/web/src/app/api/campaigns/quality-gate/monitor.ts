/**
 * Campaign Quality Gate Monitor
 * Monitors campaign metrics and auto-pauses if quality gates are breached.
 */

import sql from '@/app/api/utils/sql';
import { alertComplianceBlock } from '@/app/api/alerts/notification-engine';
import {
  checkQualityGates,
  CampaignMetrics,
  QualityGateResult,
  HIGH_VOLUME_CONFIG,
} from '../config/high-volume';

export interface MonitorResult {
  campaignId: string;
  metrics: CampaignMetrics;
  gateResult: QualityGateResult;
  action: 'continue' | 'paused' | 'warning';
  timestamp: string;
}

/**
 * Fetch current metrics for a campaign.
 */
async function getCampaignMetrics(
  campaignId: string,
  organizationId: string
): Promise<CampaignMetrics> {
  const [stats] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE status != 'QUEUED') as sent,
      COUNT(*) FILTER (WHERE status IN ('SENT', 'ENGAGED', 'NEGOTIATING', 'DEAL_AGREED', 'CONTRACT_SENT', 'CONTRACT_SIGNED')) as delivered,
      COUNT(*) FILTER (WHERE status = 'INVALID_NUMBER') as bounced,
      COUNT(*) FILTER (WHERE status = 'OPTED_OUT') as unsubscribes
    FROM campaign_contacts
    WHERE campaign_id = ${campaignId}
    AND organization_id = ${organizationId}
  `;

  return {
    sent: parseInt(stats?.sent || '0'),
    delivered: parseInt(stats?.delivered || '0'),
    bounced: parseInt(stats?.bounced || '0'),
    complaints: 0, // Would come from SES webhook
    unsubscribes: parseInt(stats?.unsubscribes || '0'),
    opens: 0, // Would come from tracking
    clicks: 0, // Would come from tracking
  };
}

/**
 * Pause a campaign.
 */
async function pauseCampaign(
  campaignId: string,
  organizationId: string,
  reason: string
): Promise<void> {
  await sql`
    UPDATE outreach_campaigns
    SET status = 'PAUSED', updated_at = NOW()
    WHERE id = ${campaignId}
    AND organization_id = ${organizationId}
  `;

  console.log(`[QUALITY-GATE] Campaign ${campaignId} PAUSED: ${reason}`);
}

/**
 * Monitor a campaign's quality gates.
 */
export async function monitorCampaign(
  campaignId: string,
  organizationId: string
): Promise<MonitorResult> {
  const metrics = await getCampaignMetrics(campaignId, organizationId);
  const gateResult = checkQualityGates(metrics);

  let action: MonitorResult['action'] = 'continue';

  if (gateResult.shouldPause) {
    // Pause campaign
    await pauseCampaign(campaignId, organizationId, gateResult.violations.join('; '));

    // Alert admin
    await alertComplianceBlock(
      campaignId,
      `Quality gate breached: ${gateResult.violations.join(', ')}`,
      metrics.bounced + metrics.complaints
    );

    action = 'paused';
  } else if (gateResult.violations.length > 0) {
    // Near threshold - warning only
    action = 'warning';
  }

  return {
    campaignId,
    metrics,
    gateResult,
    action,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Check if a campaign should continue sending based on quality.
 */
export async function shouldContinueSending(
  campaignId: string,
  organizationId: string
): Promise<{ canSend: boolean; reason?: string }> {
  const metrics = await getCampaignMetrics(campaignId, organizationId);
  const gateResult = checkQualityGates(metrics);

  if (gateResult.shouldPause) {
    return {
      canSend: false,
      reason: gateResult.violations.join('; '),
    };
  }

  return { canSend: true };
}

/**
 * Get quality report for a campaign.
 */
export async function getQualityReport(
  campaignId: string,
  organizationId: string
): Promise<{
  metrics: CampaignMetrics;
  rates: {
    bounceRate: string;
    complaintRate: string;
    unsubscribeRate: string;
    deliverabilityRate: string;
  };
  thresholds: {
    maxBounceRate: string;
    maxComplaintRate: string;
    maxUnsubscribeRate: string;
  };
  status: 'healthy' | 'warning' | 'critical';
}> {
  const metrics = await getCampaignMetrics(campaignId, organizationId);
  const gateResult = checkQualityGates(metrics);
  const gates = HIGH_VOLUME_CONFIG.qualityGates;

  const deliverabilityRate = metrics.sent > 0 ? (metrics.delivered / metrics.sent) : 1;

  let status: 'healthy' | 'warning' | 'critical' = 'healthy';
  if (gateResult.shouldPause) {
    status = 'critical';
  } else if (
    gateResult.bounceRate > gates.maxBounceRate * 0.8 ||
    gateResult.complaintRate > gates.maxComplaintRate * 0.8 ||
    gateResult.unsubscribeRate > gates.maxUnsubscribeRate * 0.8
  ) {
    status = 'warning';
  }

  return {
    metrics,
    rates: {
      bounceRate: (gateResult.bounceRate * 100).toFixed(2) + '%',
      complaintRate: (gateResult.complaintRate * 100).toFixed(3) + '%',
      unsubscribeRate: (gateResult.unsubscribeRate * 100).toFixed(2) + '%',
      deliverabilityRate: (deliverabilityRate * 100).toFixed(2) + '%',
    },
    thresholds: {
      maxBounceRate: (gates.maxBounceRate * 100).toFixed(1) + '%',
      maxComplaintRate: (gates.maxComplaintRate * 100).toFixed(2) + '%',
      maxUnsubscribeRate: (gates.maxUnsubscribeRate * 100).toFixed(1) + '%',
    },
    status,
  };
}

import sql from '@/app/api/utils/sql';
import { buildWhere, safeIdentifier } from '@/app/api/utils/sqlFragments';
import { logEvent } from './logger';

export interface ComplianceAuditRecord {
  id?: number;
  organizationId: string;
  campaignId?: string;
  userId?: string;
  action: 'DNC_SCRUB_DISABLED' | 'DNC_SCRUB_ENABLED' | 'LITIGATOR_SCRUB_DISABLED' | 'LITIGATOR_SCRUB_ENABLED';
  metadata: {
    confirmationText?: string;
    ip?: string;
    userAgent?: string;
    timestamp: string;
  };
}

export async function recordComplianceAction(record: ComplianceAuditRecord): Promise<void> {
  await sql`
    INSERT INTO compliance_audit (organization_id, campaign_id, user_id, action, metadata)
    VALUES (${record.organizationId}, ${record.campaignId || null}, ${record.userId || null}, ${record.action}, ${JSON.stringify(record.metadata)})
  `;

  await logEvent('compliance_audit', 'campaign', record.campaignId || 'system', {
    action: record.action,
    organizationId: record.organizationId,
    userId: record.userId,
    metadata: record.metadata,
  }, record.userId);
}

export async function getCampaignComplianceAudit(
  organizationId: string,
  campaignId?: string
): Promise<ComplianceAuditRecord[]> {
  // Defect #32, eighth wave: `AND ${...}` is a boolean-position fragment, so this
  // 500'd whenever a campaign filter was supplied. Thrown here (unlike the route
  // copy) so a compliance failure surfaces instead of returning a blank audit.
  const scope = buildWhere()
    .eq('organization_id', organizationId)
    .when(campaignId, (w) => w.eq('campaign_id', campaignId))
    .raw(campaignId ? 'TRUE' : 'campaign_id IS NULL')
    .build();

  const rows = await sql(
    `SELECT * FROM compliance_audit
     WHERE ${scope.text}
     ORDER BY created_at DESC
     LIMIT 100`,
    scope.params as never[]
  );
  return rows as ComplianceAuditRecord[];
}
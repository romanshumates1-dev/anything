import sql from '@/app/api/utils/sql';
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
  const query = sql`
    SELECT * FROM compliance_audit
    WHERE organization_id = ${organizationId}
    ${campaignId ? sql`AND campaign_id = ${campaignId}` : sql`AND campaign_id IS NULL`}
    ORDER BY created_at DESC
    LIMIT 100
  `;
  const rows = await query;
  return rows as ComplianceAuditRecord[];
}